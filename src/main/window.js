'use strict';
const path = require('path');
const fs = require('fs');
const { BrowserWindow, WebContentsView, Menu, MenuItem, clipboard, shell, dialog, nativeTheme } = require('electron');
const { resolveInput, engineUrl } = require('./omnibox');
const { registrable, hostOf } = require('./domain');
const { stripTracking } = require('./privacy');
const { SEARCH_ENGINES } = require('./defaults');
const { DARK, LIGHT, PRIVATE } = require('./theme');

const IS_MAC = process.platform === 'darwin';
const TOOLBAR_H = 44;
const TABSTRIP_H = 38;
const BMBAR_H = 30;
const INFOBAR_H = 42;
const SIDEBAR_W = 240;
const SIDEBAR_W_COLLAPSED = 58;
const PAD = 5;
const ALLOWED_SCHEMES = /^(https?|file|nevix|view-source|about|data|blob|chrome-extension|devtools):/i;
const GROUP_COLORS = ['primary', 'warning', 'success', 'danger', 'neutral'];
const MAX_HISTORY_ENTRIES = 12;

const THEME = {
  dark: { bg: DARK['color-background'], symbol: DARK['color-text'] },
  light: { bg: LIGHT['color-background'], symbol: LIGHT['color-text'] },
  private: { bg: PRIVATE['color-background'], symbol: DARK['color-text'] },
};

/** Chromium normalises nevix://settings to nevix://settings/ — show and compare the clean form. */
const tidy = (u) => (u || '').replace(/^(nevix:\/\/[^/#?]+)\/(?=[#?]|$)/, '$1');
const safeOrigin = (url) => { try { return new URL(url).origin; } catch { return ''; } };

/** Keep at most MAX_HISTORY_ENTRIES entries centred on the current one. */
function trimNav(entries, index) {
  if (entries.length <= MAX_HISTORY_ENTRIES) return { entries, index };
  const start = Math.max(0, Math.min(index - Math.floor(MAX_HISTORY_ENTRIES / 2), entries.length - MAX_HISTORY_ENTRIES));
  return { entries: entries.slice(start, start + MAX_HISTORY_ENTRIES), index: index - start };
}

let tabSeq = 0;
let winSeq = 0;

/** One place that knows how a tab's web contents are configured. Also used to prewarm spare tabs. */
function makeView(nx, partition) {
  return new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      preload: path.join(__dirname, '..', 'preload', 'page.js'),
      spellcheck: !!nx.settings.get('general.spellcheck'),
      safeDialogs: true,
      safeDialogsMessage: 'Prevent this page from showing more dialogs',
      enableWebSQL: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: true,
      autoplayPolicy: 'no-user-gesture-required',     // enforced per site by the page preload
    },
  });
}

class Tab {
  constructor(win, opts = {}) {
    this.win = win;
    this.id = ++tabSeq;
    this.key = 't' + this.id;
    this.partition = opts.partition || win.partition;
    this.isolated = !!opts.isolated;
    this.temporary = !!opts.temporary;
    this.groupId = opts.groupId || 0;
    this.url = opts.url || '';
    this.topUrl = this.url;
    this.title = opts.title || '';
    this.favicon = opts.favicon || '';
    this.pinned = !!opts.pinned;
    this.muted = false;
    this.audible = false;
    this.loading = false;
    this.stage = opts.stage || 'active';      // active | idle | frozen | suspended | discarded
    this.restore = opts.restore || null;      // { entries, index, scroll } kept while suspended
    this.lastActive = Date.now();
    this.counters = { ads: 0, trackers: 0, cookies: 0, upgrades: 0 };
    this.errorFor = '';
    this.canBack = false;
    this.canForward = false;
    this.zoom = 0;
    this.view = null;
    this.lastPopup = 0;
    this.usesMedia = false;
    this.notify = () => this.win.scheduleState();
    if (!this.sleeping) this.create(opts.url, opts.view);
  }

  get sleeping() { return this.stage === 'suspended' || this.stage === 'discarded'; }
  get wc() { return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null; }

  get displayUrl() {
    if (this.errorFor) return this.errorFor;
    if (/^nevix:\/\/newtab/.test(this.url)) return '';
    return tidy(this.url);
  }

  create(url, preView) {
    const nx = this.win.app;
    const view = preView || makeView(nx, this.partition);
    this.view = view;
    this.stage = 'active';
    this.paintBackground(url);
    try { view.setBorderRadius(6); } catch {}
    const wc = view.webContents;
    nx.registerWebContents(wc, this);
    this.bind(wc);
    wc.setWebRTCIPHandlingPolicy(nx.privacy.webrtcPolicy());
    wc.setAudioMuted(this.muted);
    if (this.restore && this.restore.entries && this.restore.entries.length) this.restoreHistory(wc);
    else if (url && !(preView && preView.__loaded === url)) this.load(url);
    return view;
  }

  /** Rebuild back/forward history and scroll position of a suspended tab. */
  restoreHistory(wc) {
    const r = this.restore; this.restore = null;
    const idx = Math.min(Math.max(0, r.index || 0), r.entries.length - 1);
    this.errorFor = '';
    wc.navigationHistory.restore({ index: idx, entries: r.entries.map((e) => ({ url: e.url, title: e.title || '' })) })
      .catch(() => this.load(r.entries[idx].url));
    if (r.scroll && (r.scroll[0] || r.scroll[1])) {
      wc.once('did-finish-load', () => { wc.executeJavaScript(`window.scrollTo(${+r.scroll[0] || 0}, ${+r.scroll[1] || 0})`).catch(() => {}); });
    }
  }

  /** Web pages get the standard white canvas; nevix:// pages blend with the theme to avoid a flash. */
  paintBackground(url) {
    if (!this.view) return;
    const internal = /^nevix:/.test(url || '');
    const t = this.win.isPrivate ? THEME.private : this.win.isDark() ? THEME.dark : THEME.light;
    this.view.setBackgroundColor(internal ? t.bg : '#ffffff');
  }

  load(url) {
    this.paintBackground(url);
    const wc = this.wc;
    if (!wc) { this.url = url; return; }
    this.errorFor = '';
    this.url = url;
    this.topUrl = url;
    wc.loadURL(url).catch(() => { /* failures surface through did-fail-load */ });
  }

  bind(wc) {
    const nx = this.win.app;
    const ping = () => this.win.scheduleState();

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.topUrl = details.url;
      this.counters = { ads: 0, trackers: 0, cookies: 0, upgrades: 0 };
      this.usesMedia = false;
      if (nx.privacy.bounce) nx.privacy.bounce.onStart(this, details);
      ping();
    });
    wc.on('did-redirect-navigation', (details) => { if (details.isMainFrame && nx.privacy.bounce) nx.privacy.bounce.onRedirect(this, details.url); });
    wc.on('did-start-loading', () => { this.loading = true; ping(); });
    wc.on('did-stop-loading', () => { this.loading = false; this.syncNav(); ping(); });
    wc.on('did-navigate', (_e, url) => {
      this.url = url; this.topUrl = url;
      this.paintBackground(url);
      if (!/^nevix:\/\/error/.test(url)) this.errorFor = '';
      this.applyZoom();
      if (!this.win.isPrivate && nx.settings.get('general.saveHistory') && !this.isolated && !this.temporary) nx.history.add(url, this.title);
      this.favicon = '';
      if (nx.privacy.bounce) nx.privacy.bounce.onCommitted(this, url);
      this.syncNav(); ping();
    });
    wc.on('did-navigate-in-page', (_e, url, isMain) => {
      if (!isMain) return;
      this.url = url; this.topUrl = url; this.syncNav(); ping();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (!this.win.isPrivate && !this.isolated && !this.temporary) nx.history.setTitle(this.url, title);
      ping();
    });
    wc.on('page-favicon-updated', (_e, favs) => {
      if (favs && favs[0]) nx.fetchFavicon(wc.session, favs[0]).then((d) => { if (d) { this.favicon = d; ping(); } });
    });
    wc.on('audio-state-changed', (e) => { this.audible = e.audible; ping(); });
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return;
      this.showError(code, desc, url);
    });
    wc.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') this.showError(-1000, 'The page crashed (' + d.reason + ')', this.url); });
    wc.on('enter-html-full-screen', () => this.win.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => this.win.setHtmlFullscreen(false));
    wc.on('found-in-page', (_e, r) => this.win.send('find', { active: r.activeMatchOrdinal, matches: r.matches }));
    wc.on('will-prevent-unload', (e) => {
      const choice = dialog.showMessageBoxSync(this.win.win, {
        type: 'question', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, title: 'Leave site?',
        message: 'Leave this site?', detail: 'Changes you made may not be saved.',
      });
      if (choice === 0) e.preventDefault();
    });
    wc.on('will-navigate', (e, url) => this.guardNavigation(e, url));
    wc.on('will-redirect', (e, url) => this.guardNavigation(e, url));
    wc.on('before-input-event', (e, input) => { if (this.win.handleKey(input)) e.preventDefault(); });
    wc.on('context-menu', (_e, params) => this.win.pageContextMenu(this, params));
    wc.on('did-finish-load', () => { this.syncNav(); ping(); });
    wc.on('did-create-window', (child, details) => nx.adoptPopup(child, this, details));
    wc.on('select-bluetooth-device', (e, devices, cb) => { e.preventDefault(); nx.perm.selectBluetooth(wc, devices, cb); });
    wc.on('destroyed', () => { if (nx.lazyModules.perm) nx.perm.forgetTab(this.key); });

    wc.setWindowOpenHandler((details) => {
      const url = details.url;
      const fromInternal = /^(nevix|file):/.test(this.url);
      if (!ALLOWED_SCHEMES.test(url) || /^(javascript|data):/i.test(url) || (/^(nevix|file|view-source|devtools):/i.test(url) && !fromInternal)) {
        if (/^(mailto|tel):/i.test(url)) this.openExternal(url);
        return { action: 'deny' };
      }
      const now = Date.now();
      if (now - this.lastPopup < 400) return { action: 'deny' };      // popup spam guard
      this.lastPopup = now;
      if (details.features && details.features.length > 0 && details.disposition === 'new-window') {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#ffffff' } };
      }
      this.win.newTab({
        url, background: details.disposition === 'background-tab', after: this,
        partition: this.isolated ? this.partition : undefined, isolated: this.isolated, groupId: this.groupId,
      });
      return { action: 'deny' };
    });
  }

  guardNavigation(e, url) {
    // Web content may never steer into privileged pages or the local file system.
    const fromWeb = /^(https?|data|blob):/.test(this.url) || !this.url;
    if (fromWeb && /^(nevix|file|view-source|devtools):/i.test(url)) { e.preventDefault(); return; }
    if (ALLOWED_SCHEMES.test(url)) return;
    e.preventDefault();
    if (/^(mailto|tel):/i.test(url)) this.openExternal(url);
  }

  openExternal(url) {
    const r = dialog.showMessageBoxSync(this.win.win, {
      type: 'question', buttons: ['Open', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Open external app?',
      message: `Allow ${hostOf(this.topUrl) || 'this page'} to open an external application?`, detail: url.slice(0, 200),
    });
    if (r === 0) shell.openExternal(url);
  }

  syncNav() {
    const wc = this.wc;
    if (!wc) return;
    this.canBack = wc.navigationHistory.canGoBack();
    this.canForward = wc.navigationHistory.canGoForward();
  }

  applyZoom() {
    const wc = this.wc;
    if (!wc) return;
    const host = hostOf(this.url);
    const z = host ? this.win.app.settings.get('siteZoom')[host] || 0 : 0;
    this.zoom = z;
    wc.setZoomLevel(z);
  }

  showError(code, desc, url) {
    const nx = this.win.app;
    let type = 'generic';
    if (nx.privacy.upgraded.has(url) && code !== -20) type = 'https';
    else if (code <= -200 && code >= -299) type = 'cert';
    else if (code === -1000) type = 'crash';
    const q = new URLSearchParams({ type, code: String(code), desc: desc || '', url: url || '' });
    if (type === 'https') q.set('http', nx.privacy.upgraded.get(url));
    this.errorFor = url;
    const wc = this.wc;
    if (wc) wc.loadURL('nevix://error?' + q.toString()).catch(() => {});
  }

  // ---- lifecycle stages ---------------------------------------------------------------------------------
  /** Page JS and timers stop; memory stays so resuming is instant. */
  async freeze() {
    const wc = this.wc;
    if (!wc || this.stage === 'frozen' || this.sleeping || wc.isDevToolsOpened()) return false;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.enable');
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
      this.stage = 'frozen';
      return true;
    } catch { try { wc.debugger.detach(); } catch {} return false; }
  }

  async unfreeze() {
    const wc = this.wc;
    if (!wc || this.stage !== 'frozen') return;
    this.stage = 'active';
    try { await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }); } catch {}
    try { wc.debugger.detach(); } catch {}
  }

  /** Release the renderer but keep back/forward history and scroll position. */
  async suspend({ scroll = true } = {}) {
    if (!this.view || this.sleeping) return false;
    const wc = this.wc;
    let nav = null, pos = [0, 0];
    if (wc) {
      try { nav = trimNav(wc.navigationHistory.getAllEntries().map((e) => ({ url: e.url, title: e.title })), wc.navigationHistory.getActiveIndex()); } catch {}
      if (scroll && this.stage !== 'frozen') {
        try { pos = await Promise.race([wc.executeJavaScript('[window.scrollX, window.scrollY]'), new Promise((_, rej) => setTimeout(rej, 400))]); } catch {}
      }
    }
    if (!this.view || this.win.activeId === this.id) return false;   // became active while we were measuring
    this.release('suspended');
    this.restore = nav && nav.entries.length ? { ...nav, scroll: pos } : null;
    return true;
  }

  /** Synchronous suspend (no scroll capture) for callers that cannot await. */
  sleep() {
    if (!this.view || this.sleeping || this.win.activeId === this.id) return false;
    let nav = null;
    try { const wc = this.wc; nav = trimNav(wc.navigationHistory.getAllEntries().map((e) => ({ url: e.url, title: e.title })), wc.navigationHistory.getActiveIndex()); } catch {}
    this.release('suspended');
    this.restore = nav && nav.entries.length ? { ...nav, scroll: [0, 0] } : null;
    return true;
  }

  /** Drop everything but the URL and title. */
  discard() {
    if (!this.view || this.win.activeId === this.id) return false;
    this.release('discarded');
    this.restore = null;
    return true;
  }

  release(stage) {
    const wc = this.wc;
    if (wc) {
      this.win.app.unregisterWebContents(wc);
      this.win.removeView(this.view);
      try { wc.debugger.detach(); } catch {}
      try { wc.close({ waitForBeforeUnload: false }); } catch {}
    }
    this.view = null;
    this.stage = stage;
    this.loading = false;
    this.audible = false;
    this.win.scheduleState();
  }

  wake() {
    if (this.stage === 'frozen') { this.unfreeze(); return; }
    if (!this.sleeping) return;
    this.create(this.errorFor || this.url);
  }

  destroy() {
    const wc = this.wc;
    if (wc) {
      this.win.app.unregisterWebContents(wc);
      this.win.removeView(this.view);
      try { wc.debugger.detach(); } catch {}
      try { wc.close({ waitForBeforeUnload: false }); } catch {}
    }
    this.view = null;
  }

  info() {
    return {
      id: this.id, title: this.title || (this.displayUrl ? this.displayUrl : 'New Tab'), url: this.displayUrl, favicon: this.favicon,
      loading: this.loading, pinned: this.pinned, muted: this.muted, audible: this.audible, sleeping: this.sleeping, stage: this.stage,
      iso: this.isolated, temp: this.temporary, group: this.groupId || 0, selected: this.win.selected.has(this.id),
      internal: /^nevix:/.test(this.url) && !this.errorFor,
    };
  }
}

class NevixWindow {
  constructor(app_, opts = {}) {
    this.app = app_;
    this.id = ++winSeq;
    this.isPrivate = !!opts.private;
    this.partition = this.isPrivate ? `nevix-private-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : 'persist:nevix';
    this.tabs = [];
    this.groups = [];                     // [{ id, name, color, collapsed }]
    this.selected = new Set();            // multi-selected tab ids
    this.anchor = null;                   // last single-clicked tab (for shift-range select)
    this.activeId = null;
    this.closed = [];
    this.overlay = false;
    this.infobarReasons = new Set();
    this.htmlFullscreen = false;
    this.pendingPerms = [];
    this.permShown = false;
    this.prompts = new Map();
    this.stateTimer = null;
    this.alive = true;
    this.groupSeq = 0;

    const dark = this.isDark();
    const bounds = opts.bounds || {};
    const bg = this.isPrivate ? THEME.private.bg : dark ? THEME.dark.bg : THEME.light.bg;
    this.win = new BrowserWindow({
      width: bounds.width || 1280, height: bounds.height || 820, x: bounds.x, y: bounds.y,
      minWidth: 480, minHeight: 360,
      show: false,
      title: 'Nevix',
      backgroundColor: bg,
      titleBarStyle: 'hidden',
      ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { color: bg, symbolColor: dark ? THEME.dark.symbol : THEME.light.symbol, height: TABSTRIP_H } }),
      icon: path.join(__dirname, '..', '..', 'assets', 'app-icon.png'),
    });
    if (!IS_MAC && this.win.removeMenu) this.win.removeMenu();

    app_.privacy.harden(this.session());
    app_.watchSession(this.session());

    this.ui = new WebContentsView({
      webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        preload: path.join(__dirname, '..', 'preload', 'ui.js'),
        spellcheck: false,
      },
    });
    this.ui.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.ui);
    app_.uiWindows.set(this.ui.webContents.id, this);
    this.ui.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.ui.webContents.on('will-navigate', (e) => e.preventDefault());
    this.ui.webContents.on('before-input-event', (e, input) => { if (this.handleKey(input)) e.preventDefault(); });
    this.ui.webContents.loadURL('nevix://ui/index.html' + (this.isPrivate ? '#private' : ''));

    this.win.on('resize', () => this.layout());
    this.win.on('maximize', () => this.layout());
    this.win.on('unmaximize', () => this.layout());
    this.win.on('enter-full-screen', () => { this.layout(); });
    this.win.on('leave-full-screen', () => { this.htmlFullscreen = false; this.layout(); });
    this.win.on('focus', () => app_.setLastWindow(this));
    this.win.on('moved', () => app_.scheduleSessionSave());
    this.win.on('resized', () => app_.scheduleSessionSave());
    this.win.on('close', () => { if (!this.isPrivate && !app_.quitting) app_.saveSession(); });
    this.win.on('closed', () => this.onClosed());
    const reveal = () => {
      if (this.alive && !this.win.isDestroyed() && !this.win.isVisible()) {
        this.win.show(); this.layout(); app_.mark('firstWindowShown');
      }
    };
    this.ui.webContents.once('did-finish-load', () => setTimeout(reveal, 40));
    setTimeout(reveal, 2500);
    this.layout();
  }

  session() {
    const { session } = require('electron');
    return session.fromPartition(this.partition);
  }

  isDark() {
    const t = this.app.settings.get('general.theme');
    return this.isPrivate || t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors);
  }

  applyTheme() {
    const dark = this.isDark();
    const t = this.isPrivate ? THEME.private : dark ? THEME.dark : THEME.light;
    if (!this.alive) return;
    this.win.setBackgroundColor(t.bg);
    if (!IS_MAC) { try { this.win.setTitleBarOverlay({ color: t.bg, symbolColor: t.symbol, height: TABSTRIP_H }); } catch {} }
    for (const tab of this.tabs) tab.paintBackground(tab.url);
  }

  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }
  get infobarOpen() { return this.infobarReasons.size > 0; }

  // ---- layout --------------------------------------------------------------------------------------------
  metrics() {
    const g = this.app.settings.get('general');
    const vertical = g.verticalTabs && this.app.flags.on('nevix-enable-vertical-tabs');
    const top = (vertical ? TOOLBAR_H : TABSTRIP_H + TOOLBAR_H) + (g.bookmarksBar ? BMBAR_H : 0) + (this.infobarOpen ? INFOBAR_H : 0);
    const left = vertical ? (g.sidebarCollapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W) : 0;
    return { top, left, vertical };
  }

  layout() {
    if (!this.alive || this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    this.ui.setBounds({ x: 0, y: 0, width: w, height: h });
    const a = this.active;
    if (!a || !a.view) return;
    if (this.htmlFullscreen) { a.view.setBounds({ x: 0, y: 0, width: w, height: h }); try { a.view.setBorderRadius(0); } catch {} return; }
    try { a.view.setBorderRadius(6); } catch {}
    const m = this.metrics();
    a.view.setBounds({
      x: m.left + PAD, y: m.top, width: Math.max(10, w - m.left - PAD * 2), height: Math.max(10, h - m.top - PAD),
    });
  }

  setHtmlFullscreen(on) {
    this.htmlFullscreen = on;
    this.win.setFullScreen(on);
    this.send('fullscreen', on);
    this.layout();
  }

  removeView(view) { try { this.win.contentView.removeChildView(view); } catch {} }

  setOverlay(on) {
    this.overlay = !!on;
    if (this.overlay) {
      this.win.contentView.addChildView(this.ui); // moves UI above page content
      this.ui.webContents.focus();
    } else {
      const a = this.active;
      if (a && a.view) this.win.contentView.addChildView(a.view);
    }
  }

  // ---- tabs ----------------------------------------------------------------------------------------------
  newTab(opts = {}) {
    const url = opts.url === undefined ? this.app.settings.get('general.homepage') : opts.url;
    let partition = opts.partition;
    if (opts.isolated && !partition) partition = `nevix-iso-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const target = url || 'nevix://newtab';
    let view = null;
    if (!partition && !this.isPrivate && target === 'nevix://newtab' && this.app.lazyModules.life) view = this.app.life.takePrewarmed();
    const tab = new Tab(this, { ...opts, url: target, partition, view });
    if (tab.partition !== this.partition && tab.wc) { this.app.privacy.harden(tab.wc.session); this.app.watchSession(tab.wc.session); }
    let idx = this.tabs.length;
    if (opts.after && this.tabs.includes(opts.after)) {
      idx = this.tabs.indexOf(opts.after) + 1;
      if (tab.groupId === 0 && opts.after.groupId && !opts.noGroup) tab.groupId = opts.after.groupId;
    }
    this.tabs.splice(idx, 0, tab);
    this.normalize();
    if (!opts.background) this.activate(tab.id, target === 'nevix://newtab');
    else if (this.app.lazyModules.life) this.app.life.touch();
    this.scheduleState();
    return tab;
  }

  activate(id, focusOmni = false) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const prev = this.active;
    if (prev && prev !== tab) { if (prev.view) this.removeView(prev.view); prev.lastActive = Date.now(); }
    this.activeId = id;
    tab.lastActive = Date.now();
    const g = tab.groupId && this.groups.find((x) => x.id === tab.groupId);
    if (g && g.collapsed) g.collapsed = false;
    if (tab.sleeping) tab.wake();
    else if (tab.stage === 'frozen') tab.unfreeze();
    else tab.stage = 'active';
    if (tab.view) this.win.contentView.addChildView(tab.view);
    if (this.overlay) this.win.contentView.addChildView(this.ui);
    this.layout();
    this.closeFind();
    if (focusOmni) { this.ui.webContents.focus(); this.send('focus-omnibox', {}); }
    else if (tab.wc && !this.overlay) tab.wc.focus();
    this.win.setTitle(tab.title ? `${tab.title} — Nevix` : 'Nevix');
    if (this.app.lazyModules.life) this.app.life.touch();
    this.scheduleState();
  }

  closeTab(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const tab = this.tabs[i];
    if (!this.isPrivate && !tab.isolated && !tab.temporary && tab.displayUrl && !/^nevix:\/\/newtab/.test(tab.url)) {
      const rec = { url: tab.errorFor || tab.url, title: tab.title, pinned: tab.pinned, index: i, restore: tab.restore || this.liveRestore(tab) };
      this.closed.push(rec);
      if (this.closed.length > 25) this.closed.shift();
      this.app.recentlyClosed.push(rec);
      if (this.app.recentlyClosed.length > 25) this.app.recentlyClosed.shift();
    }
    this.tabs.splice(i, 1);
    this.selected.delete(id);
    const wasActive = this.activeId === id;
    tab.destroy();
    this.dropEmptyGroups();
    if (!this.tabs.length) {
      if (this.app.settings.get('tabs.closeWindowOnLastTab') === false && !this.app.quitting) { this.newTab({ url: 'nevix://newtab' }); return; }
      this.win.close(); return;
    }
    if (wasActive) {
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      this.activeId = null;
      this.activate(next.id);
    }
    this.scheduleState();
  }

  liveRestore(tab) {
    const wc = tab.wc;
    if (!wc) return null;
    try {
      const entries = wc.navigationHistory.getAllEntries().map((e) => ({ url: e.url, title: e.title }));
      if (entries.length < 2) return null;
      return { ...trimNav(entries, wc.navigationHistory.getActiveIndex()), scroll: [0, 0] };
    } catch { return null; }
  }

  reopenClosed(index) {
    const i = typeof index === 'number' ? index : this.closed.length - 1;
    const [c] = this.closed.splice(i, 1);
    if (!c) return;
    const t = this.newTab({ url: c.url, pinned: c.pinned, background: true });
    if (c.restore) { t.release('suspended'); t.restore = c.restore; }
    this.activate(t.id);
  }

  duplicateTab(id) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    const nt = this.newTab({ url: t.errorFor || t.url, after: t, partition: t.isolated ? t.partition : undefined, isolated: t.isolated, groupId: t.groupId, background: true });
    const r = t.wc && this.liveRestore(t);
    if (r) { nt.release('suspended'); nt.restore = r; }
    this.activate(nt.id);
  }

  moveTab(id, toIndex) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const [t] = this.tabs.splice(i, 1);
    const pins = this.tabs.filter((x) => x.pinned).length;
    toIndex = t.pinned ? Math.min(toIndex, pins) : Math.max(toIndex, pins);
    this.tabs.splice(toIndex, 0, t);
    // Dropping between two tabs of one group joins it; dropping away from its group leaves it.
    const left = this.tabs[toIndex - 1], right = this.tabs[toIndex + 1];
    if (left && right && left.groupId && left.groupId === right.groupId) t.groupId = left.groupId;
    else if (t.groupId && !((left && left.groupId === t.groupId) || (right && right.groupId === t.groupId))) t.groupId = 0;
    this.normalize();
    this.dropEmptyGroups();
    this.scheduleState();
  }

  cycle(dir) {
    const vis = this.tabs.filter((t) => !this.isHidden(t));
    if (vis.length < 2) return;
    const i = vis.findIndex((t) => t.id === this.activeId);
    this.activate(vis[(i + dir + vis.length) % vis.length].id);
  }

  togglePin(id) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    t.pinned = !t.pinned;
    if (t.pinned) t.groupId = 0;
    this.normalize();
    this.dropEmptyGroups();
    this.scheduleState();
  }

  muteTab(id) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    t.muted = !t.muted;
    if (t.wc) t.wc.setAudioMuted(t.muted);
    this.scheduleState();
  }

  // ---- selection -----------------------------------------------------------------------------------------
  selectedIds() {
    const ids = [...this.selected].filter((id) => this.tabs.some((t) => t.id === id));
    return ids.length ? ids : (this.activeId ? [this.activeId] : []);
  }

  select(id, mode) {
    if (mode === 'toggle') {
      if (this.selected.has(id)) this.selected.delete(id);
      else { if (!this.selected.size && this.activeId) this.selected.add(this.activeId); this.selected.add(id); }
      this.anchor = id;
    } else if (mode === 'range') {
      const a = this.tabs.findIndex((t) => t.id === (this.anchor || this.activeId)), b = this.tabs.findIndex((t) => t.id === id);
      if (a !== -1 && b !== -1) this.selected = new Set(this.tabs.slice(Math.min(a, b), Math.max(a, b) + 1).map((t) => t.id));
    } else { this.selected.clear(); this.anchor = id; }
    this.scheduleState();
  }

  // ---- groups --------------------------------------------------------------------------------------------
  isHidden(t) { const g = t.groupId && this.groups.find((x) => x.id === t.groupId); return !!(g && g.collapsed && t.id !== this.activeId); }

  /** Keep each group's tabs contiguous and pinned tabs first. */
  normalize() {
    const out = [];
    const used = new Set();
    for (const t of this.tabs) {
      if (used.has(t.id)) continue;
      if (t.groupId) { for (const m of this.tabs) if (m.groupId === t.groupId && !used.has(m.id)) { out.push(m); used.add(m.id); } }
      else { out.push(t); used.add(t.id); }
    }
    this.tabs = [...out.filter((t) => t.pinned), ...out.filter((t) => !t.pinned)];
  }

  dropEmptyGroups() { this.groups = this.groups.filter((g) => this.tabs.some((t) => t.groupId === g.id)); }

  async groupSelected(forId) {
    const ids = forId ? [forId] : this.selectedIds();
    const name = await this.prompt('New tab group', 'Group name', '');
    if (name === null) return null;
    return this.createGroup(ids, name || 'Group');
  }

  createGroup(ids, name, color) {
    const g = { id: ++this.groupSeq, name, color: color || GROUP_COLORS[this.groups.length % GROUP_COLORS.length], collapsed: false };
    this.groups.push(g);
    for (const t of this.tabs) if (ids.includes(t.id) && !t.pinned) t.groupId = g.id;
    this.normalize(); this.dropEmptyGroups(); this.scheduleState();
    return g;
  }

  addToGroup(ids, groupId) {
    for (const t of this.tabs) if (ids.includes(t.id) && !t.pinned) t.groupId = groupId;
    this.normalize(); this.dropEmptyGroups(); this.scheduleState();
  }

  ungroup(id) {
    const ids = id ? [id] : this.selectedIds();
    for (const t of this.tabs) if (ids.includes(t.id)) t.groupId = 0;
    this.dropEmptyGroups(); this.scheduleState();
  }

  groupAction(groupId, action, arg) {
    const g = this.groups.find((x) => x.id === groupId);
    if (!g) return;
    if (action === 'toggle') {
      g.collapsed = !g.collapsed;
      if (g.collapsed && this.active && this.active.groupId === g.id) { const n = this.tabs.find((t) => t.groupId !== g.id); if (n) this.activate(n.id); }
    } else if (action === 'rename') g.name = String(arg || '').slice(0, 40);
    else if (action === 'color' && GROUP_COLORS.includes(arg)) g.color = arg;
    else if (action === 'ungroup') { for (const t of this.tabs) if (t.groupId === g.id) t.groupId = 0; }
    else if (action === 'close') { for (const t of [...this.tabs]) if (t.groupId === g.id) this.closeTab(t.id); }
    this.dropEmptyGroups(); this.scheduleState();
  }

  async renameGroup(groupId) {
    const g = this.groups.find((x) => x.id === groupId);
    if (!g) return;
    const name = await this.prompt('Rename group', 'Group name', g.name);
    if (name !== null) this.groupAction(groupId, 'rename', name);
  }

  groupContextMenu(groupId) {
    const g = this.groups.find((x) => x.id === groupId);
    if (!g) return;
    Menu.buildFromTemplate([
      { label: 'Rename group…', click: () => this.renameGroup(groupId) },
      { label: g.collapsed ? 'Expand group' : 'Collapse group', click: () => this.groupAction(groupId, 'toggle') },
      { label: 'Color', submenu: GROUP_COLORS.map((c) => ({ label: c[0].toUpperCase() + c.slice(1), type: 'radio', checked: g.color === c, click: () => this.groupAction(groupId, 'color', c) })) },
      { type: 'separator' },
      { label: 'Save group…', click: () => this.app.spaces.saveGroup(this, groupId) },
      { label: 'Move group to new window', click: () => this.moveTabsToWindow(this.tabs.filter((t) => t.groupId === groupId).map((t) => t.id), 'new') },
      { type: 'separator' },
      { label: 'Ungroup', click: () => this.groupAction(groupId, 'ungroup') },
      { label: 'Close group', click: () => this.groupAction(groupId, 'close') },
    ]).popup({ window: this.win });
  }

  // ---- moving tabs between windows ---------------------------------------------------------------------
  /** Take a tab out of this window without destroying its page. */
  detach(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return null;
    const [tab] = this.tabs.splice(i, 1);
    this.selected.delete(id);
    if (tab.view) this.removeView(tab.view);
    tab.groupId = 0;
    if (this.activeId === id) {
      this.activeId = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next) this.activate(next.id);
    }
    this.dropEmptyGroups();
    this.scheduleState();
    return tab;
  }

  adopt(tab) {
    tab.win = this;
    this.tabs.push(tab);
    this.normalize();
    this.scheduleState();
  }

  moveTabsToWindow(ids, to) {
    const movable = this.tabs.filter((t) => ids.includes(t.id));
    if (!movable.length) return;
    let target;
    if (to === 'new') target = this.app.createWindow({ blank: true, private: this.isPrivate });
    else target = [...this.app.windows].find((w) => w.id === to);
    if (!target || target === this || target.isPrivate !== this.isPrivate) return;
    const sourceEmpties = movable.length === this.tabs.length;
    let last = null;
    for (const t of movable) { const d = this.detach(t.id); if (d) { target.adopt(d); last = d; } }
    if (last) target.activate(last.id);
    target.win.focus();
    if (sourceEmpties || !this.tabs.length) this.win.close();
  }

  moveActiveTabToWindow(to) { this.moveTabsToWindow(this.selectedIds(), to); }

  // ---- navigation ----------------------------------------------------------------------------------------
  navigate(text, opts = {}) {
    const url = resolveInput(text, this.app.settings);
    let tab = this.active;
    if (!tab || opts.newTab) tab = this.newTab({ url });
    else { if (tab.sleeping) tab.wake(); tab.load(url); }
    this.setOverlay(false);
    this.scheduleState();
    setTimeout(() => { const w = tab.wc; if (w && this.activeId === tab.id) w.focus(); }, 30);
  }

  newTabOrReuse(url) {
    const base = tidy(url).split('#')[0];
    const existing = this.tabs.find((t) => tidy(t.url).split('#')[0] === base);
    if (existing) { if (tidy(url) !== tidy(existing.url)) existing.load(url); this.activate(existing.id); }
    else this.newTab({ url });
  }

  // ---- find ----------------------------------------------------------------------------------------------
  find(text, opts = {}) {
    const wc = this.active && this.active.wc;
    if (!wc) return;
    if (!text) { wc.stopFindInPage('clearSelection'); this.send('find', { active: 0, matches: 0 }); return; }
    wc.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.next, matchCase: !!opts.matchCase });
  }
  closeFind() { const wc = this.active && this.active.wc; if (wc) wc.stopFindInPage('clearSelection'); }

  // ---- keys & commands -----------------------------------------------------------------------------------
  handleKey(input) {
    if (input.type !== 'keyDown') return false;
    if (input.key === 'Escape' && !input.control && !input.meta && !input.alt && !input.shift) {
      if (this.overlay || this.infobarOpen) { this.send('escape', {}); return true; }
      if (this.active && this.active.loading) { this.active.wc && this.active.wc.stop(); return true; }
      return false;
    }
    const id = this.app.commands.match(input);
    if (!id) return false;
    this.exec(id);
    return true;
  }

  exec(name, arg) { return this.app.commands.run(name, this, arg); }

  zoom(delta, reset) {
    const a = this.active;
    const wc = a && a.wc;
    if (!wc) return;
    const host = hostOf(a.url);
    const z = reset ? 0 : Math.max(-3, Math.min(5, wc.getZoomLevel() + delta));
    wc.setZoomLevel(z);
    a.zoom = z;
    if (host) {
      const map = { ...this.app.settings.get('siteZoom') };
      if (z === 0) delete map[host]; else map[host] = z;
      this.app.settings.set('siteZoom', map);
    }
    this.scheduleState();
  }

  toggleBookmark() {
    const a = this.active;
    if (!a || !/^https?:/.test(a.url)) return;
    const on = this.app.bookmarks.toggle(a.url, a.title);
    this.app.broadcastData('bookmarks');
    this.send('toast', on ? 'Bookmark added' : 'Bookmark removed');
  }

  toggleReader() {
    const a = this.active;
    const wc = a && a.wc;
    if (!wc || !/^https?:/.test(a.url)) return;
    const { READER_SCRIPT, READER_SCRIPT_V2 } = require('./reader');
    const script = this.app.flags.on('nevix-enable-experimental-reader') ? READER_SCRIPT_V2 : READER_SCRIPT;
    wc.executeJavaScript(script).then((r) => { if (r === 'unsupported') this.send('toast', 'Reader mode isn’t available for this page'); }).catch(() => {});
  }

  toggleShieldsForSite() {
    const a = this.active;
    if (!a) return;
    const reg = registrable(hostOf(a.displayUrl));
    if (!reg) return;
    this.app.privacy.rules.toggleSiteShields(reg);
    this.app.broadcastData('settings');
    if (a.wc) a.wc.reload();
    this.scheduleState();
  }

  async resetSiteData() {
    const a = this.active;
    if (!a || !/^https?:/.test(a.url)) return;
    await this.app.perm.resetSite(new URL(a.url).origin);
    if (a.wc) a.wc.reload();
    this.send('toast', 'Cleared permissions, cookies, storage and cache for ' + hostOf(a.url));
  }

  async savePdf() {
    const a = this.active;
    if (!a || !a.wc) return;
    const data = await a.wc.printToPDF({ printBackground: true });
    const def = path.join(this.app.downloadDir(), (a.title || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.pdf');
    const r = await dialog.showSaveDialog(this.win, { defaultPath: def, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, data);
  }

  async capture() {
    const a = this.active;
    if (!a || !a.wc) return;
    const img = await a.wc.capturePage();
    const file = path.join(this.app.downloadDir(), `Nevix-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    fs.writeFileSync(file, img.toPNG());
    this.send('toast', 'Screenshot saved to Downloads');
  }

  suggestWorkspaceName() { const a = this.active; return a && hostOf(a.displayUrl) ? hostOf(a.displayUrl) : 'Workspace'; }

  // ---- infobar: find / permission / text prompt -------------------------------------------------------------
  setInfobar(on, reason = 'find') {
    const had = this.infobarOpen;
    if (on) this.infobarReasons.add(reason); else this.infobarReasons.delete(reason);
    if (had !== this.infobarOpen) this.layout();
  }

  askPermission(tab, permission, info) {
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      this.pendingPerms.push({ id, tabId: tab.id, permission, info, resolve });
      this.showNextPermission();
    });
  }

  showNextPermission() {
    const p = this.pendingPerms[0];
    if (!p || this.permShown) return;
    this.permShown = true;
    this.setInfobar(true, 'perm');
    this.send('permission', { id: p.id, permission: p.permission, origin: p.info });
  }

  /** mode: 'always' | 'once' | 'block' | 'dismiss' */
  answerPermission(id, mode) {
    const i = this.pendingPerms.findIndex((p) => p.id === id);
    if (i === -1) return;
    const [p] = this.pendingPerms.splice(i, 1);
    p.resolve({ allow: mode === 'always' || mode === 'once', mode });
    this.permShown = false;
    if (this.pendingPerms.length) this.showNextPermission();
    else { this.send('permission', null); this.setInfobar(false, 'perm'); }
  }

  /** Ask for a line of text in the chrome (there is no native prompt dialog). Resolves to a string or null. */
  prompt(title, label, value) {
    return new Promise((resolve) => {
      const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 5);
      this.prompts.set(id, resolve);
      this.setInfobar(true, 'prompt');
      this.send('prompt', { id, title, label, value: value || '' });
    });
  }

  answerPrompt(id, value) {
    const r = this.prompts.get(id);
    if (!r) return;
    this.prompts.delete(id);
    this.setInfobar(false, 'prompt');
    r(value === null || value === undefined ? null : String(value).slice(0, 120).trim());
  }

  // ---- state to UI ---------------------------------------------------------------------------------------
  send(channel, data) {
    if (!this.alive) return;
    const wc = this.ui.webContents;
    if (!wc.isDestroyed()) wc.send('nx:' + channel, data);
  }

  scheduleState() {
    if (this.stateTimer || !this.alive) return;
    this.stateTimer = setTimeout(() => { this.stateTimer = null; this.pushState(); }, 16);
  }

  state() {
    const a = this.active;
    const g = this.app.settings.get('general');
    const flags = this.app.flags;
    const reg = a ? registrable(hostOf(a.url)) : '';
    const vertical = g.verticalTabs && flags.on('nevix-enable-vertical-tabs');
    const web = a && /^https?:/.test(a.displayUrl);
    return {
      private: this.isPrivate,
      windowId: this.id,
      platform: process.platform,
      tabs: this.tabs.map((t) => ({ ...t.info(), hidden: this.isHidden(t) })),
      groups: this.groups.map((x) => ({ ...x })),
      activeId: this.activeId,
      settings: {
        theme: g.theme, accent: g.accent, verticalTabs: vertical, sidebarCollapsed: g.sidebarCollapsed,
        bookmarksBar: g.bookmarksBar, searchEngine: g.searchEngine,
      },
      features: { palette: flags.on('nevix-enable-command-palette'), vertical: flags.on('nevix-enable-vertical-tabs'), workspaces: flags.on('nevix-enable-workspaces'), snapshots: flags.on('nevix-enable-snapshots') },
      active: a ? {
        url: a.displayUrl, rawUrl: a.url, title: a.title, canBack: a.canBack, canForward: a.canForward, loading: a.loading,
        secure: /^https:/.test(a.displayUrl) && !a.errorFor,
        internal: /^nevix:/.test(a.url) && !a.errorFor,
        counters: a.counters, zoom: a.zoom, bookmarked: this.app.bookmarks.has(a.url),
        shieldsOff: !!(reg && this.app.privacy.rules.shieldsOff(reg)), host: hostOf(a.displayUrl), sleeping: a.sleeping, stage: a.stage, error: !!a.errorFor,
        perms: web ? this.app.perm.forOrigin(safeOrigin(a.displayUrl)).filter((p) => p.stored) : [],
      } : null,
      metrics: { toolbar: TOOLBAR_H, tabstrip: TABSTRIP_H, bmbar: BMBAR_H, infobar: INFOBAR_H },
    };
  }

  pushState() {
    if (!this.alive) return;
    this.send('state', this.state());
    const a = this.active;
    if (a && !this.win.isDestroyed()) {
      const t = a.title ? `${a.title} — Nevix` : 'Nevix';
      if (this.win.getTitle() !== t) this.win.setTitle(t);
    }
    this.app.scheduleSessionSave();
  }

  // ---- context menus -------------------------------------------------------------------------------------
  pageContextMenu(tab, p) {
    const wc = tab.wc;
    if (!wc) return;
    const app_ = this.app;
    const m = new Menu();
    const add = (label, click, opts = {}) => m.append(new MenuItem({ label, click, ...opts }));
    const sep = () => m.append(new MenuItem({ type: 'separator' }));

    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) add(s, () => wc.replaceMisspelling(s));
      if (p.dictionarySuggestions.length) sep();
    }
    if (p.linkURL) {
      add('Open Link in New Tab', () => this.newTab({ url: p.linkURL, background: true, after: tab, isolated: tab.isolated, partition: tab.isolated ? tab.partition : undefined }));
      add('Open Link in New Window', () => app_.createWindow({ url: p.linkURL }));
      add('Open Link in Private Window', () => app_.createWindow({ url: p.linkURL, private: true }));
      add('Copy Link Address', () => clipboard.writeText(p.linkURL));
      add('Copy Clean Link', () => clipboard.writeText(stripTracking(p.linkURL)));
      add('Save Link As…', () => wc.downloadURL(p.linkURL));
      sep();
    }
    if (p.mediaType === 'image' && p.srcURL) {
      add('Open Image in New Tab', () => this.newTab({ url: p.srcURL, background: true, after: tab }));
      add('Save Image As…', () => wc.downloadURL(p.srcURL));
      add('Copy Image', () => wc.copyImageAt(p.x, p.y));
      add('Copy Image Address', () => clipboard.writeText(p.srcURL));
      sep();
    }
    if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL) {
      add('Save Media As…', () => wc.downloadURL(p.srcURL));
      add('Copy Media Address', () => clipboard.writeText(p.srcURL));
      sep();
    }
    if (p.isEditable) {
      add('Undo', () => wc.undo(), { enabled: p.editFlags.canUndo });
      add('Redo', () => wc.redo(), { enabled: p.editFlags.canRedo });
      sep();
      add('Cut', () => wc.cut(), { enabled: p.editFlags.canCut });
      add('Copy', () => wc.copy(), { enabled: p.editFlags.canCopy });
      add('Paste', () => wc.paste(), { enabled: p.editFlags.canPaste });
      add('Paste as Plain Text', () => wc.pasteAndMatchStyle(), { enabled: p.editFlags.canPaste });
      add('Select All', () => wc.selectAll());
      sep();
    } else if (p.selectionText) {
      add('Copy', () => wc.copy());
      const q = p.selectionText.trim().slice(0, 80);
      const eng = (SEARCH_ENGINES[app_.settings.get('general.searchEngine')] || {}).name || 'search';
      add(`Search ${eng} for “${q.length > 28 ? q.slice(0, 28) + '…' : q}”`, () => this.newTab({ url: engineUrl(app_.settings, q), after: tab }));
      sep();
    }
    if (!p.linkURL && !p.selectionText && !p.isEditable) {
      add('Back', () => wc.navigationHistory.goBack(), { enabled: wc.navigationHistory.canGoBack() });
      add('Forward', () => wc.navigationHistory.goForward(), { enabled: wc.navigationHistory.canGoForward() });
      add('Reload', () => wc.reload());
      sep();
      add('Save Page as PDF…', () => this.savePdf());
      add('Print…', () => wc.print());
      add('Reader Mode', () => this.toggleReader());
      add('Take Screenshot', () => this.capture());
      add('Copy Clean Page Link', () => this.exec('copyCleanUrl'));
      sep();
    }
    if (/^https?:/.test(tab.url)) add('View Page Source', () => this.exec('viewSource'));
    add('Inspect Element', () => { wc.inspectElement(p.x, p.y); if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'right' }); });
    m.popup({ window: this.win });
  }

  tabContextMenu(id) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    const multi = this.selected.size > 1 && this.selected.has(id);
    const ids = multi ? [...this.selected] : [id];
    const n = ids.length;
    const others = [...this.app.windows].filter((w) => w !== this && w.isPrivate === this.isPrivate);
    const life = () => this.app.life;
    const items = [
      { label: 'New Tab to the Right', click: () => this.newTab({ url: 'nevix://newtab', after: t }) },
      { type: 'separator' },
      { label: n > 1 ? `Reload ${n} Tabs` : 'Reload', click: () => ids.forEach((i) => { const x = this.tabs.find((q) => q.id === i); if (!x) return; if (x.sleeping) x.wake(); else if (x.wc) x.wc.reload(); }) },
      { label: 'Duplicate', click: () => ids.forEach((i) => this.duplicateTab(i)) },
      { label: t.pinned ? 'Unpin' : 'Pin', click: () => ids.forEach((i) => this.togglePin(i)) },
      { label: t.muted ? 'Unmute' : 'Mute', click: () => ids.forEach((i) => this.muteTab(i)) },
      { type: 'separator' },
      { label: n > 1 ? `Add ${n} Tabs to New Group…` : 'Add to New Group…', click: async () => { const g = await this.groupSelected(n === 1 ? ids[0] : undefined); if (g && n > 1) this.addToGroup(ids, g.id); } },
      ...(this.groups.length ? [{ label: 'Add to Group', submenu: this.groups.map((g) => ({ label: g.name || 'Unnamed', click: () => this.addToGroup(ids, g.id) })) }] : []),
      ...(t.groupId ? [{ label: 'Remove from Group', click: () => ids.forEach((i) => this.ungroup(i)) }] : []),
      { label: 'Move to Window', submenu: [{ label: 'New Window', click: () => this.moveTabsToWindow(ids, 'new') }, ...others.map((w) => ({ label: `Window ${w.id}${w.active && w.active.title ? ' — ' + w.active.title.slice(0, 30) : ''}`, click: () => this.moveTabsToWindow(ids, w.id) }))] },
      { type: 'separator' },
      { label: 'Freeze', enabled: id !== this.activeId && !t.sleeping && t.stage !== 'frozen', click: () => ids.forEach((i) => life().freezeTab(this, i)) },
      { label: 'Suspend (free memory)', enabled: id !== this.activeId && !t.sleeping, click: () => ids.forEach((i) => life().suspendTab(this, i)) },
      { type: 'separator' },
      { label: n > 1 ? `Close ${n} Tabs` : 'Close Tab', click: () => ids.forEach((i) => this.closeTab(i)) },
      { label: 'Close Other Tabs', click: () => this.tabs.filter((x) => !ids.includes(x.id) && !x.pinned).forEach((x) => this.closeTab(x.id)) },
      { label: 'Close Tabs to the Right', click: () => { const i = this.tabs.indexOf(t); this.tabs.slice(i + 1).filter((x) => !x.pinned).forEach((x) => this.closeTab(x.id)); } },
      { label: 'Reopen Closed Tab', enabled: this.closed.length > 0, click: () => this.reopenClosed() },
    ];
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // ---- lifecycle -----------------------------------------------------------------------------------------
  onClosed() {
    this.alive = false;
    for (const t of this.tabs) t.destroy();
    this.tabs = [];
    this.app.uiWindows.delete(this.ui.webContents.id);
    try { this.ui.webContents.close(); } catch {}
    this.app.windowClosed(this);
  }

  /** Serialisable window state: tabs, groups and the navigation entries needed to rebuild them. */
  snapshot() {
    const real = this.tabs.filter((t) => !t.isolated && !t.temporary && t.displayUrl && !/^nevix:\/\/(recovery|error)/.test(t.url));
    const groupIdx = new Map();
    const groups = [];
    for (const t of real) {
      if (t.groupId && !groupIdx.has(t.groupId)) {
        const g = this.groups.find((x) => x.id === t.groupId);
        if (g) { groupIdx.set(t.groupId, groups.length); groups.push({ name: g.name, color: g.color, collapsed: g.collapsed }); }
      }
    }
    return {
      tabs: real.map((t) => {
        const nav = t.restore || (t.wc ? this.liveRestore(t) : null);
        return { url: t.errorFor || t.url, title: t.title, pinned: t.pinned, group: groupIdx.has(t.groupId) ? groupIdx.get(t.groupId) : -1, nav: nav ? { entries: nav.entries, index: nav.index } : null };
      }),
      groups,
      active: Math.max(0, real.findIndex((t) => t.id === this.activeId)),
      bounds: this.win.isDestroyed() ? undefined : this.win.getNormalBounds(),
    };
  }

  /** Rebuild tabs and groups from a snapshot. Background tabs stay unloaded until opened. */
  restoreInto(s) {
    const gm = (s.groups || []).map((g) => { const x = { id: ++this.groupSeq, name: g.name, color: g.color, collapsed: !!g.collapsed }; this.groups.push(x); return x; });
    const act = Math.min(s.active || 0, s.tabs.length - 1);
    const lazy = s.tabs.length > 3;
    const created = [];
    s.tabs.forEach((t, i) => {
      const background = i !== act;
      const gid = t.group >= 0 && gm[t.group] ? gm[t.group].id : 0;
      const stage = background && lazy && !t.pinned ? (t.nav ? 'suspended' : 'discarded') : 'active';
      created.push(this.newTab({
        url: t.url, title: t.title, pinned: t.pinned, groupId: gid, background, stage, noGroup: true,
        restore: t.nav ? { entries: t.nav.entries, index: t.nav.index, scroll: [0, 0] } : null,
      }));
    });
    if (created[act]) this.activate(created[act].id);
    this.dropEmptyGroups();
    return created;
  }
}

module.exports = { NevixWindow, Tab, makeView, ALLOWED_SCHEMES, GROUP_COLORS, trimNav };
