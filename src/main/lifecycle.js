'use strict';
// Tab lifecycle: Active → Idle → Frozen → Suspended → Discarded.
//
//   Active     visible, or recently used
//   Idle       background; Chromium already throttles timers and rendering
//   Frozen     page JavaScript and timers stopped (CDP Page.setWebLifecycleState); memory kept, resume is instant
//   Suspended  renderer process released; URL, back/forward history and scroll position kept
//   Discarded  everything released except URL and title            (only automatic with the tab-discarding flag)
//
// There is no polling: a single timeout is armed for the *next* transition across all background tabs and re-armed
// whenever something changes (tab switched, created, audio started, settings edited).
const os = require('os');
const { makeView } = require('./window');

const ORDER = ['active', 'idle', 'frozen', 'suspended', 'discarded'];
const rank = (s) => ORDER.indexOf(s);
const MIN = 60000;

class Lifecycle {
  constructor(app) {
    this.app = app;
    this.timer = null;
    this.memTimer = null;
    this.pending = false;
    this.spare = null;
    this.spareTimer = null;
  }

  // ---- configuration --------------------------------------------------------------------------------------
  thresholds() {
    const p = this.app.settings.get('performance');
    const aggressive = this.app.flags.on('nevix-enable-aggressive-tab-freezing');
    const f = (m) => (m > 0 ? (aggressive ? Math.max(0.25, m / 4) : m) : 0);
    return {
      idle: f(+p.idleAfterMinutes), freeze: f(+p.freezeAfterMinutes), suspend: f(+p.suspendAfterMinutes),
      discard: this.app.flags.on('nevix-enable-experimental-tab-discarding') ? f(+p.discardAfterMinutes) : 0,
      temporary: +this.app.settings.get('tabs.temporaryMinutes') || 0,
    };
  }

  /** May this tab be throttled at all? */
  eligible(win, tab) {
    if (tab.id === win.activeId) return false;
    if (tab.audible || tab.loading || tab.usesMedia) return false;
    const wc = tab.wc;
    if (wc && wc.isDevToolsOpened()) return false;
    return true;
  }

  targetStage(tab, t, now) {
    const age = (now - tab.lastActive) / MIN;
    const internal = /^nevix:/.test(tab.url);
    let s = 'active';
    if (t.idle > 0 && age >= t.idle) s = 'idle';
    if (t.freeze > 0 && age >= t.freeze) s = 'frozen';
    if (!internal && t.suspend > 0 && age >= t.suspend) s = 'suspended';
    if (!internal && !tab.pinned && t.discard > 0 && age >= t.discard) s = 'discarded';
    return s;
  }

  // ---- scheduling -----------------------------------------------------------------------------------------
  /** Something relevant changed: re-evaluate soon (coalesced). */
  touch() {
    if (this.pending) return;
    this.pending = true;
    setImmediate(() => { this.pending = false; this.reschedule(); });
  }

  /** Arm one timer for the earliest upcoming transition. */
  reschedule() {
    clearTimeout(this.timer); this.timer = null;
    clearTimeout(this.memTimer); this.memTimer = null;
    const t = this.thresholds();
    const now = Date.now();
    let next = Infinity;
    let anyBackground = false;
    for (const win of this.app.windows) {
      for (const tab of win.tabs) {
        if (!this.eligible(win, tab)) continue;
        anyBackground = true;
        const due = this.nextDue(tab, t, now);
        if (due < next) next = due;
      }
    }
    if (next < Infinity) {
      this.timer = setTimeout(() => this.tick(), Math.max(500, Math.min(next - now, 2 ** 30)));
      this.timer.unref && this.timer.unref();
    }
    // Memory-pressure checks run only while the flag is on and there is something that could be reclaimed.
    if (anyBackground && this.app.flags.on('nevix-enable-memory-pressure-manager')) {
      this.memTimer = setTimeout(() => this.memoryCheck(), 15000);
      this.memTimer.unref && this.memTimer.unref();
    }
    this.ensurePrewarm();
  }

  nextDue(tab, t, now) {
    let next = Infinity;
    const stages = [[t.idle, 'idle'], [t.freeze, 'frozen'], [t.suspend, 'suspended'], [t.discard, 'discarded']];
    for (const [m, st] of stages) {
      if (m > 0 && rank(tab.stage) < rank(st)) { const at = tab.lastActive + m * MIN; if (at > now) next = Math.min(next, at); else return now + 500; }
    }
    if (tab.temporary && t.temporary > 0) { const at = tab.lastActive + t.temporary * MIN; next = Math.min(next, Math.max(at, now + 500)); }
    return next;
  }

  async tick() {
    this.timer = null;
    const t = this.thresholds();
    const now = Date.now();
    for (const win of [...this.app.windows]) {
      for (const tab of [...win.tabs]) {
        if (!this.eligible(win, tab)) continue;
        if (tab.temporary && t.temporary > 0 && now - tab.lastActive >= t.temporary * MIN) { win.closeTab(tab.id); continue; }
        await this.advance(win, tab, this.targetStage(tab, t, now));
      }
    }
    this.reschedule();
  }

  /** Move a tab forward to `target` (never backwards). */
  async advance(win, tab, target) {
    if (rank(target) <= rank(tab.stage)) return;
    if (target === 'idle') { tab.stage = 'idle'; win.scheduleState(); return; }
    if (target === 'frozen') { await tab.freeze(); win.scheduleState(); return; }
    if (target === 'suspended') { await tab.suspend(); win.scheduleState(); return; }
    if (target === 'discarded') { tab.discard(); win.scheduleState(); }
  }

  async memoryCheck() {
    this.memTimer = null;
    const free = os.freemem() / os.totalmem();
    if (free < 0.12) {
      const now = Date.now();
      const victims = [];
      for (const win of this.app.windows) for (const tab of win.tabs) if (this.eligible(win, tab) && !tab.sleeping && now - tab.lastActive > 30000) victims.push([win, tab]);
      victims.sort((a, b) => a[1].lastActive - b[1].lastActive);
      for (const [win, tab] of victims.slice(0, 3)) {
        const next = ORDER[Math.min(rank(tab.stage) + 1, this.app.flags.on('nevix-enable-experimental-tab-discarding') ? 4 : 3)];
        await this.advance(win, tab, rank(next) < 2 ? 'frozen' : next);
      }
    }
    this.reschedule();
  }

  // ---- manual actions -------------------------------------------------------------------------------------
  find(win, id) { return win.tabs.find((t) => t.id === id); }
  async freezeTab(win, id) { const t = this.find(win, id); if (!t || id === win.activeId) return false; const ok = await t.freeze(); win.scheduleState(); return ok; }
  async suspendTab(win, id) { const t = this.find(win, id); if (!t || id === win.activeId) return false; const ok = await t.suspend(); win.scheduleState(); this.touch(); return ok; }
  discardTab(win, id) { const t = this.find(win, id); if (!t || id === win.activeId) return false; const ok = t.discard(); win.scheduleState(); return ok; }

  /** Tabs by stage across all windows (performance center). */
  counts() {
    const c = { active: 0, idle: 0, frozen: 0, suspended: 0, discarded: 0, total: 0 };
    for (const win of this.app.windows) for (const t of win.tabs) { c[t.stage] = (c[t.stage] || 0) + 1; c.total++; }
    return c;
  }

  // ---- renderer prewarm -----------------------------------------------------------------------------------
  ensurePrewarm() {
    const on = this.app.flags.on('nevix-enable-renderer-prewarm');
    if (!on) { this.dropSpare(); return; }
    if (this.spare || this.spareTimer || !this.app.windows.size) return;
    this.spareTimer = setTimeout(() => {
      this.spareTimer = null;
      if (this.spare || !this.app.flags.on('nevix-enable-renderer-prewarm')) return;
      try {
        const { session } = require('electron');
        this.app.privacy.harden(session.fromPartition('persist:nevix'));
        const view = makeView(this.app, 'persist:nevix');
        view.__loaded = 'nevix://newtab';
        view.webContents.loadURL('nevix://newtab').catch(() => {});
        this.spare = view;
      } catch { this.spare = null; }
    }, 800);
    this.spareTimer.unref && this.spareTimer.unref();
  }

  takePrewarmed() {
    if (!this.app.flags.on('nevix-enable-renderer-prewarm') || !this.spare) return null;
    const v = this.spare; this.spare = null;
    if (v.webContents.isDestroyed()) return null;
    this.touch();                                      // schedules the next spare
    return v;
  }

  dropSpare() {
    if (this.spareTimer) { clearTimeout(this.spareTimer); this.spareTimer = null; }
    if (this.spare) { try { this.spare.webContents.close({ waitForBeforeUnload: false }); } catch {} this.spare = null; }
  }

  flush() { this.dropSpare(); clearTimeout(this.timer); clearTimeout(this.memTimer); }
}

module.exports = { Lifecycle, ORDER };
