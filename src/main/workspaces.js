'use strict';
// Workspaces (a named set of tabs, groups and pins), snapshots (every window at a moment in time) and saved tab
// groups. All stored locally in workspaces.json. Private windows are never saved.
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./store');

const MAX_WORKSPACES = 100;
const MAX_SNAPSHOTS = 50;
const newId = () => crypto.randomBytes(5).toString('hex');

class Workspaces {
  constructor(app) {
    this.app = app;
    this.store = new Store(path.join(app.userData, 'workspaces.json'), { workspaces: [], snapshots: [], groups: [] });
  }

  flush() { this.store.flush(); }
  changed() { this.app.broadcastData('workspaces'); this.app.broadcastData('snapshots'); }

  // ---- workspaces -----------------------------------------------------------------------------------------
  listWorkspaces() { return this.store.get('workspaces').map(({ id, name, time, tabs, groups }) => ({ id, name, time, tabs: tabs.map((t) => ({ url: t.url, title: t.title, pinned: t.pinned, group: t.group })), groups })); }

  saveWorkspace(win, name) {
    name = String(name || '').trim().slice(0, 80);
    if (!win || !name) return null;
    if (win.isPrivate) { win.send('toast', { text: 'Private windows can’t be saved', danger: true }); return null; }
    const s = win.snapshot();
    const tabs = s.tabs.filter((t) => /^https?:|^file:/.test(t.url)).map((t) => ({ url: t.url, title: t.title, pinned: t.pinned, group: t.group }));
    if (!tabs.length) { win.send('toast', { text: 'Nothing to save — no web tabs open', danger: true }); return null; }
    const list = this.store.get('workspaces').slice();
    const existing = list.find((w) => w.name.toLowerCase() === name.toLowerCase());
    const rec = { id: existing ? existing.id : newId(), name, time: Date.now(), tabs, groups: s.groups };
    if (existing) list[list.indexOf(existing)] = rec; else list.unshift(rec);
    this.store.set('workspaces', list.slice(0, MAX_WORKSPACES));
    this.changed();
    return rec.id;
  }

  /** mode: 'append' (default) adds to the window, 'window' opens a new one, 'replace' swaps the window's tabs. */
  restoreWorkspace(id, win, mode = 'append') {
    const ws = this.store.get('workspaces').find((w) => w.id === id);
    if (!ws) return false;
    const snap = { tabs: ws.tabs.map((t) => ({ ...t, nav: null })), groups: ws.groups, active: 0 };
    if (mode === 'window' || !win || win.isPrivate) { this.app.createWindow({ tabs: snap.tabs, groups: snap.groups, active: 0 }); return true; }
    if (mode === 'replace') {
      const old = win.tabs.map((t) => t.id);
      win.restoreInto(snap);
      for (const i of old) win.closeTab(i);
      return true;
    }
    const before = win.tabs.length;
    win.restoreInto({ ...snap, active: 0 });
    void before;
    return true;
  }

  deleteWorkspace(id) { this.store.set('workspaces', this.store.get('workspaces').filter((w) => w.id !== id)); this.changed(); return true; }
  renameWorkspace(id, name) {
    const list = this.store.get('workspaces').map((w) => (w.id === id ? { ...w, name: String(name).slice(0, 80) || w.name } : w));
    this.store.set('workspaces', list); this.changed(); return true;
  }

  // ---- snapshots ------------------------------------------------------------------------------------------
  listSnapshots() {
    return this.store.get('snapshots').map((s) => ({ id: s.id, name: s.name, time: s.time, windows: s.windows.length, tabs: s.windows.reduce((n, w) => n + w.tabs.length, 0), preview: s.windows.flatMap((w) => w.tabs).slice(0, 6).map((t) => t.title || t.url) }));
  }

  saveSnapshot(name) {
    name = String(name || '').trim().slice(0, 80);
    const windows = [...this.app.windows].filter((w) => !w.isPrivate && w.alive).map((w) => w.snapshot()).filter((s) => s.tabs.length);
    if (!name || !windows.length) return null;
    const rec = { id: newId(), name, time: Date.now(), windows };
    this.store.set('snapshots', [rec, ...this.store.get('snapshots')].slice(0, MAX_SNAPSHOTS));
    this.changed();
    return rec.id;
  }

  /** Opens the snapshot's windows alongside the current ones (nothing is closed). */
  restoreSnapshot(id) {
    const s = this.store.get('snapshots').find((x) => x.id === id);
    if (!s) return false;
    for (const w of s.windows) this.app.createWindow({ tabs: w.tabs, groups: w.groups, active: w.active, bounds: w.bounds });
    return true;
  }
  deleteSnapshot(id) { this.store.set('snapshots', this.store.get('snapshots').filter((s) => s.id !== id)); this.changed(); return true; }
  renameSnapshot(id, name) {
    this.store.set('snapshots', this.store.get('snapshots').map((s) => (s.id === id ? { ...s, name: String(name).slice(0, 80) || s.name } : s)));
    this.changed(); return true;
  }

  // ---- saved tab groups -----------------------------------------------------------------------------------
  listSavedGroups() { return this.store.get('groups'); }

  saveGroup(win, groupId) {
    const g = win.groups.find((x) => x.id === groupId);
    if (!g || win.isPrivate) return null;
    const tabs = win.tabs.filter((t) => t.groupId === groupId && /^https?:/.test(t.url)).map((t) => ({ url: t.errorFor || t.url, title: t.title }));
    if (!tabs.length) return null;
    const rec = { id: newId(), name: g.name || 'Group', color: g.color, tabs, time: Date.now() };
    this.store.set('groups', [rec, ...this.store.get('groups')].slice(0, 100));
    this.changed();
    win.send('toast', `Group “${rec.name}” saved`);
    return rec.id;
  }

  openSavedGroup(id, win) {
    const g = this.store.get('groups').find((x) => x.id === id);
    if (!g || !win) return false;
    const tabs = g.tabs.map((t, i) => win.newTab({ url: t.url, title: t.title, background: i > 0, noGroup: true }));
    win.createGroup(tabs.map((t) => t.id), g.name, g.color);
    return true;
  }

  deleteSavedGroup(id) { this.store.set('groups', this.store.get('groups').filter((g) => g.id !== id)); this.changed(); return true; }
}

module.exports = { Workspaces };
