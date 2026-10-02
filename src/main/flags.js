'use strict';
// Experimental-feature registry (nevix://flags). Every flag here corresponds to real behaviour in the code
// base — grep for `flags.on('<id>')`. Flags have stable ids, a default, and a restart requirement.
//
// States are tri-state like Chromium's: 'default' | 'enabled' | 'disabled'.
// Safety: the file is parsed defensively, unknown ids are dropped, and in safe mode (or after repeated
// crashes, see recovery.js) every flag evaluates to its default.
const fs = require('fs');
const path = require('path');

const FLAGS = [
  // ---- Performance
  { id: 'nevix-enable-aggressive-tab-freezing', category: 'Performance', name: 'Aggressive tab freezing',
    description: 'Moves background tabs through the idle → frozen → suspended stages four times faster than the configured thresholds (never faster than 15 seconds per stage).',
    default: false, experimental: true, restart: false },
  { id: 'nevix-enable-memory-pressure-manager', category: 'Performance', name: 'Memory-pressure manager',
    description: 'While system memory is low, Nevix freezes, suspends and discards the least recently used background tabs until memory recovers. Checks run only while this flag is on and background tabs exist.',
    default: false, experimental: true, restart: false },
  { id: 'nevix-enable-startup-lazy-init', category: 'Performance', name: 'Lazy startup initialisation',
    description: 'Defers the extension system, optional filter-list compilation, metrics collection and import scanning until first use, so the first window appears sooner. Turn off to initialise everything eagerly.',
    default: true, experimental: false, restart: true },
  { id: 'nevix-enable-renderer-prewarm', category: 'Performance', name: 'Renderer prewarm',
    description: 'Keeps one hidden, already-loaded new-tab renderer ready so that opening a new tab is near-instant. Costs roughly one idle tab of memory.',
    default: false, experimental: true, restart: false },
  // ---- Privacy
  { id: 'nevix-enable-strict-tracker-blocking', category: 'Privacy', name: 'Strict tracker blocking',
    description: 'Also blocks third-party tracking pixels and beacons (image, ping and XHR requests carrying tracking identifiers) and every request type of known tracker domains. May break embedded widgets.',
    default: false, experimental: true, restart: false },
  { id: 'nevix-enable-strict-fingerprinting-protection', category: 'Privacy', name: 'Strict fingerprinting protection',
    description: 'Stronger mitigations: standardised screen and window metrics, 100 ms timer resolution, empty plugin/MIME lists, no speech voices, restricted font-probing APIs and heavier text-measurement noise. Some sites that depend on those APIs may misbehave.',
    default: false, experimental: true, restart: false },
  { id: 'nevix-enable-bounce-tracking-protection', category: 'Privacy', name: 'Bounce-tracking protection',
    description: 'Detects navigations that bounce through an intermediary site you never visited and deletes that site\'s cookies and storage afterwards.',
    default: true, experimental: false, restart: false },
  // ---- UI
  { id: 'nevix-enable-vertical-tabs', category: 'UI', name: 'Vertical tabs',
    description: 'Makes the vertical tab sidebar available (setting, menu entry and shortcut).',
    default: true, experimental: false, restart: false },
  { id: 'nevix-enable-command-palette', category: 'UI', name: 'Command palette',
    description: 'Enables the searchable command palette (Ctrl+Shift+P).',
    default: true, experimental: false, restart: false },
  { id: 'nevix-enable-workspaces', category: 'UI', name: 'Workspaces',
    description: 'Enables saving and restoring named sets of tabs, groups and pins (nevix://workspaces).',
    default: true, experimental: false, restart: false },
  { id: 'nevix-enable-snapshots', category: 'UI', name: 'Snapshots',
    description: 'Enables whole-browser snapshots — every window, tab and group — that can be restored later (nevix://snapshots).',
    default: true, experimental: false, restart: false },
  // ---- Experimental
  { id: 'nevix-enable-experimental-http3', category: 'Experimental', name: 'Prefer HTTP/3 (QUIC)',
    description: 'Attempts QUIC on every origin instead of waiting for Alt-Svc discovery. Can be slower on networks that drop UDP.',
    default: false, experimental: true, restart: true },
  { id: 'nevix-enable-experimental-gpu-path', category: 'Experimental', name: 'Forced GPU rasterisation',
    description: 'Forces GPU rasterisation and zero-copy uploads and ignores the driver blocklist. Faster scrolling on supported hardware; can cause glitches or crashes on buggy drivers.',
    default: false, experimental: true, restart: true },
  { id: 'nevix-enable-experimental-tab-discarding', category: 'Experimental', name: 'Automatic tab discarding',
    description: 'Lets the tab lifecycle take the final step: very old background tabs are discarded entirely (only URL and title are kept) and reload when opened.',
    default: false, experimental: true, restart: false },
  { id: 'nevix-enable-experimental-reader', category: 'Experimental', name: 'Reader mode v2',
    description: 'Uses link-density article extraction, lazy-loaded image recovery and byline/date detection instead of the basic extractor.',
    default: false, experimental: true, restart: false },
];

const BY_ID = new Map(FLAGS.map((f) => [f.id, f]));

class Flags {
  /**
   * @param {string} file absolute path of flags.json
   * @param {{safeMode?: boolean}} opts
   */
  constructor(file, opts = {}) {
    this.file = file;
    this.safeMode = !!opts.safeMode;
    this.states = {};            // id -> 'enabled' | 'disabled' (absent = default)
    this.recoveredIds = [];      // experimental flags reset by crash recovery
    this.load();
    this.bootEffective = this.snapshot(); // what this process actually started with (for "restart required")
  }

  load() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch { return; }
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') throw new Error('not an object');
      const src = data.states && typeof data.states === 'object' ? data.states : {};
      for (const [id, v] of Object.entries(src)) {
        if (BY_ID.has(id) && (v === 'enabled' || v === 'disabled')) this.states[id] = v;
      }
      if (Array.isArray(data.recoveredIds)) this.recoveredIds = data.recoveredIds.filter((id) => BY_ID.has(id));
    } catch {
      // Malformed config must never brick the browser: keep a copy for inspection and start from defaults.
      try { fs.renameSync(this.file, this.file + '.corrupt'); } catch {}
      this.states = {};
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, states: this.states, recoveredIds: this.recoveredIds }));
      fs.renameSync(tmp, this.file);
    } catch {}
  }

  def(id) { const f = BY_ID.get(id); return f ? f.default : false; }

  /** The effective on/off value used by the code base. */
  on(id) {
    const f = BY_ID.get(id);
    if (!f) return false;
    if (this.safeMode) return f.default;
    const s = this.states[id];
    return s === undefined ? f.default : s === 'enabled';
  }

  state(id) { return this.states[id] || 'default'; }

  set(id, state) {
    if (!BY_ID.has(id)) throw new Error('unknown flag');
    if (state === 'default') delete this.states[id];
    else if (state === 'enabled' || state === 'disabled') this.states[id] = state;
    else throw new Error('bad state');
    this.recoveredIds = this.recoveredIds.filter((x) => x !== id);
    this.save();
  }

  reset(id) { this.set(id, 'default'); }
  resetAll() { this.states = {}; this.recoveredIds = []; this.save(); }

  snapshot() { const o = {}; for (const f of FLAGS) o[f.id] = this.on(f.id); return o; }

  /** Used by crash recovery: revert every experimental flag to its default and remember which ones. */
  disableExperimental() {
    const hit = [];
    for (const f of FLAGS) {
      if (f.experimental && this.states[f.id] !== undefined) { delete this.states[f.id]; hit.push(f.id); }
    }
    if (hit.length) { this.recoveredIds = [...new Set([...this.recoveredIds, ...hit])]; this.save(); }
    return hit;
  }

  list() {
    return FLAGS.map((f) => ({
      ...f,
      state: this.state(f.id),
      effective: this.on(f.id),
      restartPending: f.restart && this.on(f.id) !== this.bootEffective[f.id],
      ignored: this.safeMode && this.states[f.id] !== undefined,
    }));
  }

  /** Chromium command-line switches implied by the flags (must be applied before app ready). */
  switches() {
    const out = [];
    if (this.on('nevix-enable-experimental-http3')) out.push(['origin-to-force-quic-on', '*']);
    if (this.on('nevix-enable-experimental-gpu-path')) {
      out.push(['enable-gpu-rasterization'], ['enable-zero-copy'], ['ignore-gpu-blocklist']);
    }
    return out;
  }
}

module.exports = { Flags, FLAGS };
