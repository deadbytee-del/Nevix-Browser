'use strict';
// One registry for every browser command. The palette, the keyboard handler, the address bar and the shortcut
// settings all read from here — nothing else hard-codes a key binding.
const { clipboard } = require('electron');
const { stripTracking } = require('./privacy');
const { hostOf } = require('./domain');

const IS_MAC = process.platform === 'darwin';

// ---- accelerators ---------------------------------------------------------------------------------------------
/** 'Mod+Shift+P' -> canonical string for this platform ('Mod' = Cmd on macOS, Ctrl elsewhere). */
function normalizeAccel(accel) {
  const parts = String(accel).split('+');
  let key = parts.pop();
  if (key === '' && parts.length) key = '+';             // 'Mod++'
  const f = { mod: false, ctrl: false, alt: false, shift: false };
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'mod' || l === 'cmdorctrl') f.mod = true;
    else if (l === 'ctrl' || l === 'control') { if (IS_MAC) f.ctrl = true; else f.mod = true; }
    else if (l === 'alt' || l === 'option') f.alt = true;
    else if (l === 'shift') f.shift = true;
    else if (l === 'cmd' || l === 'meta' || l === 'super') { if (IS_MAC) f.mod = true; }
  }
  return canon(f, key);
}
function canon(f, key) {
  const k = key.length === 1 ? key.toUpperCase() : key;
  const printable = k.length === 1 && !/[A-Z0-9]/.test(k);   // shift only produces the symbol itself
  return (f.mod ? 'Mod+' : '') + (f.ctrl ? 'Ctrl+' : '') + (f.alt ? 'Alt+' : '') + (f.shift && !printable ? 'Shift+' : '') + k;
}
/** Electron before-input-event -> canonical string. */
function fromInput(input) {
  const f = {
    mod: IS_MAC ? input.meta : input.control, ctrl: IS_MAC ? input.control : false, alt: input.alt, shift: input.shift,
  };
  let key = input.key;
  if (key === ' ') key = 'Space';
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(key)) return '';
  return canon(f, key);
}
/** Canonical string -> label for the user's platform. */
function display(accel) {
  const parts = normalizeAccel(accel).split('+');
  let key = parts.pop();
  if (key === '') key = '+';
  const names = IS_MAC
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  const keyNames = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Delete: IS_MAC ? '⌫' : 'Del', Space: 'Space' };
  const label = parts.map((p) => names[p]);
  label.push(keyNames[key] || key);
  return IS_MAC ? label.join('') : label.join('+');
}

// ---- command table --------------------------------------------------------------------------------------------
const PAGE_TITLES = {
  settings: 'Settings', privacy: 'Privacy dashboard', performance: 'Performance center', downloads: 'Downloads',
  extensions: 'Extensions', workspaces: 'Workspaces', snapshots: 'Snapshots', permissions: 'Site permissions',
  network: 'Network & filters', diagnostics: 'Diagnostics', flags: 'Experimental flags', about: 'About Nevix',
  history: 'History', bookmarks: 'Bookmarks',
};

function define() {
  const C = [];
  const add = (id, title, category, shortcut, run, extra = {}) => C.push({ id, title, category, shortcut: shortcut ? [].concat(shortcut) : [], run, ...extra });
  const active = (w) => w.active;
  const wc = (w) => w.active && w.active.wc;

  // Tabs
  add('newTab', 'New tab', 'Tabs', 'Mod+T', (w) => w.newTab({ url: 'nevix://newtab' }));
  add('newWindow', 'New window', 'Window', 'Mod+N', (w, _a, app) => app.createWindow({ url: 'nevix://newtab' }));
  add('privateWindow', 'New private window', 'Window', 'Mod+Shift+N', (w, _a, app) => app.createWindow({ private: true, url: 'nevix://newtab' }));
  add('isolatedTab', 'New isolated tab (separate cookies & storage)', 'Tabs', 'Mod+Alt+N', (w) => w.newTab({ url: 'nevix://newtab', isolated: true }));
  add('temporaryTab', 'New temporary tab (closes itself when idle)', 'Tabs', 'Mod+Alt+T', (w) => w.newTab({ url: 'nevix://newtab', temporary: true }));
  add('closeTab', 'Close tab', 'Tabs', 'Mod+W', (w, a) => { const ids = w.selectedIds(); if (a) w.closeTab(a); else if (ids.length > 1) ids.forEach((i) => w.closeTab(i)); else if (w.active) w.closeTab(w.active.id); });
  add('closeOtherTabs', 'Close other tabs', 'Tabs', null, (w) => { for (const t of [...w.tabs]) if (t.id !== w.activeId && !t.pinned) w.closeTab(t.id); });
  add('closeTabsRight', 'Close tabs to the right', 'Tabs', null, (w) => { const i = w.tabs.findIndex((t) => t.id === w.activeId); for (const t of w.tabs.slice(i + 1)) if (!t.pinned) w.closeTab(t.id); });
  add('reopenTab', 'Reopen closed tab', 'Tabs', 'Mod+Shift+T', (w) => w.reopenClosed());
  add('recentlyClosed', 'Recently closed tabs…', 'Tabs', null, null, { pick: 'closed' });
  add('duplicateTab', 'Duplicate tab', 'Tabs', null, (w, a) => w.duplicateTab(a || w.activeId));
  add('pinTab', 'Pin / unpin tab', 'Tabs', null, (w, a) => w.togglePin(a || w.activeId));
  add('muteTab', 'Mute / unmute tab', 'Tabs', 'Mod+Shift+M', (w, a) => w.muteTab(a || w.activeId));
  add('nextTab', 'Next tab', 'Tabs', ['Ctrl+Tab', 'Mod+PageDown'], (w) => w.cycle(1), { palette: false });
  add('prevTab', 'Previous tab', 'Tabs', ['Ctrl+Shift+Tab', 'Mod+PageUp'], (w) => w.cycle(-1), { palette: false });
  for (let i = 1; i <= 9; i++) add('gotoTab' + i, i === 9 ? 'Go to last tab' : `Go to tab ${i}`, 'Tabs', 'Mod+' + i, (w) => { const idx = i === 9 ? w.tabs.length - 1 : i - 1; if (w.tabs[idx]) w.activate(w.tabs[idx].id); }, { palette: false });
  add('gotoTab', 'Go to tab…', 'Tabs', null, (w, a) => { const t = w.tabs[(a | 0) - 1]; if (t) w.activate(t.id); }, { palette: false });
  add('searchTabs', 'Search tabs…', 'Tabs', 'Mod+Shift+A', null, { pick: 'tabs' });
  add('freezeTab', 'Freeze tab (stop its CPU use, keep it in memory)', 'Tabs', null, (w, a) => w.app.life.freezeTab(w, a || w.activeId));
  add('suspendTab', 'Suspend tab (free its memory, keep history & scroll)', 'Tabs', null, (w, a) => w.app.life.suspendTab(w, a || w.activeId));
  add('discardTab', 'Discard tab (free everything, reload when opened)', 'Tabs', null, (w, a) => w.app.life.discardTab(w, a || w.activeId), { flag: 'nevix-enable-experimental-tab-discarding' });
  add('sleepOthers', 'Suspend all other tabs', 'Tabs', 'Mod+Alt+S', (w) => { for (const t of w.tabs) if (t.id !== w.activeId && !t.pinned) w.app.life.suspendTab(w, t.id); });
  add('moveTabToWindow', 'Move tab to window…', 'Tabs', null, null, { pick: 'windows' });
  add('groupTab', 'Add tab to new group…', 'Tabs', null, (w, a) => w.groupSelected(a));
  add('ungroupTab', 'Remove tab from group', 'Tabs', null, (w, a) => w.ungroup(a || w.activeId));
  add('saveGroup', 'Save tab group…', 'Tabs', null, null, { pick: 'groups-save' });
  add('openSavedGroup', 'Open saved tab group…', 'Tabs', null, null, { pick: 'groups-saved' });
  add('switchTab', 'Switch to tab', 'Tabs', null, (w, a, app) => { const t = [...app.windows].find((x) => x.id === a.win) || w; t.activate(a.tab); t.win.focus(); }, { palette: false });
  add('copyText', 'Copy text', 'App', null, (w, a) => { if (typeof a === 'string') { clipboard.writeText(a.slice(0, 2000)); w.send('toast', 'Copied'); } }, { palette: false });
  add('findNext', 'Find next', 'Page', ['F3', 'Mod+G'], (w) => w.send('find-next', { forward: true }), { palette: false });
  add('findPrev', 'Find previous', 'Page', ['Shift+F3', 'Mod+Shift+G'], (w) => w.send('find-next', { forward: false }), { palette: false });
  // Navigation
  add('focusOmnibox', 'Focus address bar', 'Navigation', ['Mod+L', 'F6', 'Mod+Alt+L'], (w) => { w.ui.webContents.focus(); w.send('focus-omnibox', {}); }, { palette: false });
  add('reload', 'Reload page', 'Navigation', ['Mod+R', 'F5'], (w) => { const a = active(w); if (!a) return; if (a.sleeping) a.wake(); else if (a.errorFor) a.load(a.errorFor); else if (a.wc) a.wc.reload(); });
  add('hardReload', 'Hard reload (bypass cache)', 'Navigation', ['Mod+Shift+R', 'Ctrl+F5'], (w) => { const c = wc(w); if (c) c.reloadIgnoringCache(); });
  add('stop', 'Stop loading', 'Navigation', null, (w) => { const c = wc(w); if (c) c.stop(); }, { palette: false });
  add('back', 'Back', 'Navigation', IS_MAC ? 'Mod+[' : ['Alt+ArrowLeft', 'Mod+['], (w) => { const c = wc(w); if (c && c.navigationHistory.canGoBack()) c.navigationHistory.goBack(); });
  add('forward', 'Forward', 'Navigation', IS_MAC ? 'Mod+]' : ['Alt+ArrowRight', 'Mod+]'], (w) => { const c = wc(w); if (c && c.navigationHistory.canGoForward()) c.navigationHistory.goForward(); });
  add('home', 'Go to homepage', 'Navigation', null, (w, _a, app) => w.navigate(app.settings.get('general.homepage')));
  // Page
  add('find', 'Find in page', 'Page', 'Mod+F', (w) => { w.setInfobar(true); w.send('open-find', {}); });
  add('print', 'Print…', 'Page', 'Mod+P', (w) => { const c = wc(w); if (c) c.print(); });
  add('savePdf', 'Save page as PDF…', 'Page', null, (w) => w.savePdf());
  add('reader', 'Reader mode', 'Page', 'Mod+Alt+R', (w) => w.toggleReader());
  add('capture', 'Take screenshot', 'Page', 'Mod+Shift+S', (w) => w.capture());
  add('zoomIn', 'Zoom in', 'Page', ['Mod+=', 'Mod++'], (w) => w.zoom(+0.5));
  add('zoomOut', 'Zoom out', 'Page', 'Mod+-', (w) => w.zoom(-0.5));
  add('zoomReset', 'Reset zoom', 'Page', 'Mod+0', (w) => w.zoom(0, true));
  add('viewSource', 'View page source', 'Page', 'Mod+U', (w) => { const a = active(w); if (a && /^https?:/.test(a.url)) w.newTab({ url: 'view-source:' + a.url, after: a }); });
  add('devtools', 'Developer tools', 'Developer', ['F12', 'Mod+Shift+I', 'Mod+Alt+I'], (w) => { const c = wc(w); if (c) c.isDevToolsOpened() ? c.closeDevTools() : c.openDevTools({ mode: 'right' }); });
  add('copyCleanUrl', 'Copy clean link (no tracking parameters)', 'Page', 'Mod+Shift+C', (w) => { const a = active(w); if (a) { clipboard.writeText(stripTracking(a.displayUrl)); w.send('toast', 'Clean link copied'); } });
  add('clearSiteData', 'Clear site data for this site', 'Privacy', null, (w) => w.resetSiteData(), { danger: true });
  add('toggleShields', 'Toggle shields for this site', 'Privacy', null, (w, _a, app) => w.toggleShieldsForSite());
  add('bookmark', 'Bookmark this page', 'Bookmarks', 'Mod+D', (w) => w.toggleBookmark());
  add('bookmarkAll', 'Bookmark all open tabs', 'Bookmarks', 'Mod+Shift+D', (w, _a, app) => { for (const t of w.tabs) if (/^https?:/.test(t.url)) app.bookmarks.add(t.url, t.title); app.broadcastData('bookmarks'); });
  add('fullscreen', 'Toggle full screen', 'Window', 'F11', (w) => w.win.setFullScreen(!w.win.isFullScreen()));
  // Interface
  add('toggleBookmarksBar', 'Toggle bookmarks bar', 'Interface', 'Mod+Shift+B', (w, _a, app) => { app.settings.set('general.bookmarksBar', !app.settings.get('general.bookmarksBar')); app.settingsChanged('general.bookmarksBar'); });
  add('toggleVertical', 'Toggle vertical tabs', 'Interface', 'Mod+Shift+E', (w, _a, app) => { app.settings.set('general.verticalTabs', !app.settings.get('general.verticalTabs')); app.settingsChanged('general.verticalTabs'); }, { flag: 'nevix-enable-vertical-tabs' });
  add('toggleSidebar', 'Collapse / expand tab sidebar', 'Interface', null, (w, _a, app) => { app.settings.set('general.sidebarCollapsed', !app.settings.get('general.sidebarCollapsed')); app.settingsChanged('general.sidebarCollapsed'); }, { flag: 'nevix-enable-vertical-tabs' });
  add('palette', 'Command palette', 'Interface', ['Mod+Shift+P', 'Mod+K'], (w) => w.send('palette', {}), { palette: false, flag: 'nevix-enable-command-palette' });
  // Workspaces & snapshots
  add('saveWorkspace', 'Save workspace…', 'Workspaces', null, async (w, _a, app) => { const name = await w.prompt('Save workspace', 'Workspace name', w.suggestWorkspaceName()); if (name) { app.spaces.saveWorkspace(w, name); w.send('toast', `Workspace “${name}” saved`); } }, { flag: 'nevix-enable-workspaces' });
  add('restoreWorkspace', 'Restore workspace…', 'Workspaces', null, null, { pick: 'workspaces', flag: 'nevix-enable-workspaces' });
  add('saveSnapshot', 'Save snapshot…', 'Workspaces', null, async (w, _a, app) => { const name = await w.prompt('Save snapshot', 'Snapshot name', 'Snapshot ' + new Date().toLocaleString()); if (name) { app.spaces.saveSnapshot(name); w.send('toast', `Snapshot “${name}” saved`); } }, { flag: 'nevix-enable-snapshots' });
  add('restoreSnapshot', 'Restore snapshot…', 'Workspaces', null, null, { pick: 'snapshots', flag: 'nevix-enable-snapshots' });
  // Pages
  add('openPage', 'Open internal page', 'Pages', null, (w, a) => w.newTabOrReuse('nevix://' + a), { palette: false });
  const pageShortcuts = { history: IS_MAC ? 'Mod+Y' : 'Mod+H', downloads: 'Mod+J', bookmarks: 'Mod+Shift+O', settings: 'Mod+,' };
  for (const [page, title] of Object.entries(PAGE_TITLES)) {
    add('open' + page[0].toUpperCase() + page.slice(1), 'Open ' + title.toLowerCase().replace(/^./, (c) => c), 'Pages', pageShortcuts[page] || null, (w) => w.newTabOrReuse('nevix://' + page));
  }
  add('clearData', 'Clear browsing data…', 'Privacy', 'Mod+Shift+Delete', (w) => w.newTabOrReuse('nevix://settings#privacy'), { danger: true });
  add('quit', 'Quit Nevix', 'App', null, (w, _a, app) => require('electron').app.quit());
  return C;
}

class Commands {
  constructor(app) {
    this.app = app;
    this.list = define();
    this.byId = new Map(this.list.map((c) => [c.id, c]));
    this.rebuild();
  }

  /** (Re)build the key lookup from defaults + the user's overrides. */
  rebuild() {
    const overrides = this.app.settings.get('shortcuts') || {};
    this.keys = new Map();
    for (const c of this.list) {
      const accels = overrides[c.id] !== undefined ? overrides[c.id] : c.shortcut;
      c.accels = (accels || []).map(normalizeAccel);
      for (const a of c.accels) if (!this.keys.has(a)) this.keys.set(a, c.id);
    }
  }

  enabled(c) { return !c.flag || this.app.flags.on(c.flag); }

  /** Run a command against a window. Unknown or disabled commands are ignored. */
  run(id, win, arg) {
    const c = this.byId.get(id);
    if (!c || !c.run || !this.enabled(c)) return false;
    try { const r = c.run(win, arg, this.app); if (r && r.catch) r.catch(() => {}); } catch (e) { /* a failing command must never take the UI down */ }
    return true;
  }

  /** Key event -> command id (or null). */
  match(input) {
    if (input.type !== 'keyDown') return null;
    const k = fromInput(input);
    if (!k) return null;
    const id = this.keys.get(k);
    if (!id) return null;
    const c = this.byId.get(id);
    return c && this.enabled(c) ? id : null;
  }

  /** Commands for the palette / settings. */
  describe({ forPalette = false } = {}) {
    return this.list.filter((c) => (!forPalette || c.palette !== false) && this.enabled(c)).map((c) => ({
      id: c.id, title: c.title, category: c.category, pick: c.pick || null, danger: !!c.danger,
      shortcuts: c.accels.map(display), defaults: c.shortcut.map(display), custom: (this.app.settings.get('shortcuts') || {})[c.id] !== undefined,
    }));
  }

  /** Rebind a command. Returns {ok} or {error, conflict}. */
  setShortcuts(id, accels) {
    const c = this.byId.get(id);
    if (!c) return { error: 'Unknown command' };
    const norm = accels.map(normalizeAccel).filter(Boolean);
    for (const a of norm) {
      if (/^(Mod\+)?(Shift\+)?[A-Za-z]$/.test(a) && !/Mod\+/.test(a)) return { error: 'Shortcuts need Ctrl/⌘ or Alt (a bare letter would stop you typing)' };
      const owner = this.keys.get(a);
      if (owner && owner !== id) return { error: `Already used by “${this.byId.get(owner).title}”`, conflict: owner };
    }
    const o = { ...(this.app.settings.get('shortcuts') || {}) };
    o[id] = norm;
    this.app.settings.set('shortcuts', o);
    this.rebuild();
    return { ok: true };
  }

  resetShortcut(id) {
    const o = { ...(this.app.settings.get('shortcuts') || {}) };
    delete o[id];
    this.app.settings.set('shortcuts', o);
    this.rebuild();
  }
  resetAllShortcuts() { this.app.settings.set('shortcuts', {}); this.rebuild(); }

  /** Items for a "pick" command (second palette level). */
  items(kind, win) {
    const app = this.app;
    switch (kind) {
      case 'tabs': {
        const out = [];
        for (const w of app.windows) for (const t of w.tabs) out.push({ label: t.title || t.displayUrl || 'New Tab', sub: hostOf(t.displayUrl) || '', arg: { win: w.id, tab: t.id }, run: 'switchTab' });
        return out;
      }
      case 'windows': {
        const out = [{ label: 'New window', sub: '', arg: { to: 'new' } }];
        for (const w of app.windows) if (w !== win && w.isPrivate === win.isPrivate) out.push({ label: `Window ${w.id}`, sub: (w.active && w.active.title) || '', arg: { to: w.id } });
        return out;
      }
      case 'closed': return win.closed.slice().reverse().map((c, i) => ({ label: c.title || c.url, sub: hostOf(c.url), arg: { index: win.closed.length - 1 - i } }));
      case 'workspaces': return app.spaces.listWorkspaces().map((s) => ({ label: s.name, sub: `${s.tabs.length} tabs`, arg: { id: s.id } }));
      case 'snapshots': return app.spaces.listSnapshots().map((s) => ({ label: s.name, sub: new Date(s.time).toLocaleString(), arg: { id: s.id } }));
      case 'groups-saved': return app.spaces.listSavedGroups().map((g) => ({ label: g.name, sub: `${g.tabs.length} tabs`, arg: { id: g.id } }));
      case 'groups-save': return win.groups.map((g) => ({ label: g.name || 'Unnamed group', sub: `${win.tabs.filter((t) => t.groupId === g.id).length} tabs`, arg: { id: g.id } }));
      default: return [];
    }
  }

  /** Run a picked item. */
  runPick(commandId, arg, win) {
    const app = this.app;
    switch (commandId) {
      case 'searchTabs': { const w = [...app.windows].find((x) => x.id === arg.win) || win; w.activate(arg.tab); w.win.focus(); return; }
      case 'moveTabToWindow': return win.moveActiveTabToWindow(arg.to);
      case 'recentlyClosed': return win.reopenClosed(arg.index);
      case 'restoreWorkspace': return app.spaces.restoreWorkspace(arg.id, win);
      case 'restoreSnapshot': return app.spaces.restoreSnapshot(arg.id);
      case 'openSavedGroup': return app.spaces.openSavedGroup(arg.id, win);
      case 'saveGroup': return app.spaces.saveGroup(win, arg.id);
      default:
    }
  }
}

module.exports = { Commands, normalizeAccel, fromInput, display };
