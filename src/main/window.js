'use strict';
const path = require('path');
const fs = require('fs');
const {
  BrowserWindow, WebContentsView, Menu, MenuItem, clipboard, shell, dialog, nativeImage, app, nativeTheme,
} = require('electron');
const { resolveInput, suggest, engineUrl } = require('./omnibox');
const { registrable, hostOf } = require('./domain');
const { stripTracking } = require('./privacy');
const { READER_SCRIPT } = require('./reader');
const { SEARCH_ENGINES } = require('./defaults');

const IS_MAC = process.platform === 'darwin';
const TOOLBAR_H = 46;
const TABSTRIP_H = 40;
const BMBAR_H = 32;
const INFOBAR_H = 44;
const SIDEBAR_W = 248;
const SIDEBAR_W_COLLAPSED = 58;
const PAD = 6;
const ALLOWED_SCHEMES = /^(https?|file|nevix|view-source|about|data|blob|chrome-extension|devtools):/i;

const { DARK, LIGHT, PRIVATE } = require('./theme');
const THEME = {
  dark: { bg: DARK['color-background'], symbol: DARK['color-text'] },
  light: { bg: LIGHT['color-background'], symbol: LIGHT['color-text'] },
  private: { bg: PRIVATE['color-background'], symbol: DARK['color-text'] },
};

let tabSeq = 0;
/** Chromium normalises nevix://settings to nevix://settings/ — show and compare the clean form. */
const tidy = (u) => (u || '').replace(/^(nevix:\/\/[^/#?]+)\/(?=[#?]|$)/, '$1');

class Tab {
  constructor(win, opts = {}) {
    this.win = win;
    this.id = ++tabSeq;
    this.partition = opts.partition || win.partition;
    this.isolated = !!opts.isolated;
    this.url = opts.url || '';
    this.topUrl = this.url;
    this.title = opts.title || '';
    this.favicon = opts.favicon || '';
    this.pinned = !!opts.pinned;
    this.muted = false;
    this.audible = false;
    this.loading = false;
    this.sleeping = !!opts.sleeping;
    this.lastActive = Date.now();
    this.counters = { ads: 0, trackers: 0, cookies: 0, upgrades: 0 };
    this.errorFor = '';
    this.canBack = false;
    this.canForward = false;
    this.zoom = 0;
    this.view = null;
    this.lastPopup = 0;
    this.notify = () => win.scheduleState();
    if (!this.sleeping) this.create(opts.url);
  }

  get wc() { return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null; }

  get displayUrl() {
    if (this.errorFor) return this.errorFor;
    if (/^nevix:\/\/newtab/.test(this.url)) return '';
    return tidy(this.url);
  }

  create(url) {
    const app_ = this.win.app;
    const seed = app_.sessionSeed;
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        preload: path.join(__dirname, '..', 'preload', 'page.js'),
        spellcheck: !!app_.settings.get('general.spellcheck'),
        safeDialogs: true,
        safeDialogsMessage: 'Prevent this page from showing more dialogs',
        enableWebSQL: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: true,
        autoplayPolicy: app_.settings.get('privacy.blockAutoplay') ? 'document-user-activation-required' : 'no-user-gesture-required',
        additionalArguments: ['--nevix-seed=' + seed],
      },
    });
    this.view = view;
    this.paintBackground(url);
    try { view.setBorderRadius(10); } catch {}
    const wc = view.webContents;
    app_.registerWebContents(wc, this);
    this.bind(wc);
    wc.setWebRTCIPHandlingPolicy(app_.privacy.webrtcPolicy());
    wc.setAudioMuted(this.muted);
    if (url) this.load(url);
    return view;
  }

  /** Web pages get the standard white canvas; nevix:// pages blend with the theme to avoid a flash. */
  paintBackground(url) {
    if (!this.view) return;
    const internal = /^nevix:/.test(url || '');
    this.view.setBackgroundColor(internal ? (this.win.isPrivate ? THEME.private.bg : this.win.isDark() ? THEME.dark.bg : THEME.light.bg) : '#ffffff');
  }

  load(url) {
    this.paintBackground(url);
    const wc = this.wc;
    if (!wc) { this.url = url; return; }
    this.errorFor = '';
    this.url = url;
    this.topUrl = url;
    wc.loadURL(url).catch((e) => { if (e && e.code !== 'ERR_ABORTED' && e.errno !== -3) { /* handled by did-fail-load */ } });
  }

  bind(wc) {
    const win = this.win;
    const app_ = win.app;
    const ping = () => win.scheduleState();

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.topUrl = details.url;
      this.counters = { ads: 0, trackers: 0, cookies: 0, upgrades: 0 };
      ping();
    });
    wc.on('did-start-loading', () => { this.loading = true; ping(); });
    wc.on('did-stop-loading', () => { this.loading = false; this.syncNav(); ping(); });
    wc.on('did-navigate', (_e, url) => {
      this.url = url; this.topUrl = url;
      this.paintBackground(url);
      if (!/^nevix:\/\/error/.test(url)) this.errorFor = '';
      this.applyZoom();
      if (!win.isPrivate && app_.settings.get('general.saveHistory') && !this.isolated) app_.history.add(url, this.title);
      this.favicon = '';
      this.syncNav(); ping();
    });
    wc.on('did-navigate-in-page', (_e, url, isMain) => {
      if (!isMain) return;
      this.url = url; this.topUrl = url; this.syncNav(); ping();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (!win.isPrivate && !this.isolated) app_.history.setTitle(this.url, title);
      ping();
    });
    wc.on('page-favicon-updated', (_e, favs) => {
      if (favs && favs[0]) app_.fetchFavicon(wc.session, favs[0]).then((d) => { if (d) { this.favicon = d; ping(); } });
    });
    wc.on('audio-state-changed', (e) => { this.audible = e.audible; ping(); });
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return;
      this.showError(code, desc, url);
    });
    wc.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') this.showError(-1000, 'The page crashed (' + d.reason + ')', this.url); });
    wc.on('enter-html-full-screen', () => win.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => win.setHtmlFullscreen(false));
    wc.on('found-in-page', (_e, r) => win.send('find', { active: r.activeMatchOrdinal, matches: r.matches }));
    wc.on('will-prevent-unload', (e) => {
      const choice = dialog.showMessageBoxSync(win.win, {
        type: 'question', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1, title: 'Leave site?',
        message: 'Leave this site?', detail: 'Changes you made may not be saved.',
      });
      if (choice === 0) e.preventDefault();
    });
    wc.on('will-navigate', (e, url) => this.guardNavigation(e, url));
    wc.on('will-redirect', (e, url) => this.guardNavigation(e, url));
    wc.on('before-input-event', (e, input) => { if (win.handleKey(input)) e.preventDefault(); });
    wc.on('context-menu', (_e, params) => win.pageContextMenu(this, params));
    wc.on('zoom-changed', () => {});
    wc.on('did-finish-load', () => { this.syncNav(); ping(); });
    wc.on('page-title-updated', ping);
    wc.on('did-create-window', (child, details) => app_.adoptPopup(child, this, details));

    wc.setWindowOpenHandler((details) => {
      const url = details.url;
      if (!ALLOWED_SCHEMES.test(url) || /^(javascript|data):/i.test(url) || (/^(nevix|file|view-source|devtools):/i.test(url) && !/^(nevix|file):/.test(this.url))) {
        if (/^(mailto|tel):/i.test(url)) this.openExternal(url);
        return { action: 'deny' };
      }
      const now = Date.now();
      if (details.features && details.features.length > 0 && details.disposition === 'new-window') {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#ffffff' } };
      }
      if (now - this.lastPopup < 400) return { action: 'deny' }; // popup spam guard
      this.lastPopup = now;
      win.newTab({
        url,
        background: details.disposition === 'background-tab',
        after: this,
        partition: this.isolated ? this.partition : undefined,
        isolated: this.isolated,
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
    const app_ = this.win.app;
    let type = 'generic';
    if (app_.privacy.upgraded.has(url) && code !== -20) type = 'https';
    else if (code <= -200 && code >= -299) type = 'cert';
    else if (code === -1000) type = 'crash';
    const q = new URLSearchParams({ type, code: String(code), desc: desc || '', url: url || '' });
    if (type === 'https') q.set('http', app_.privacy.upgraded.get(url));
    this.errorFor = url;
    const wc = this.wc;
    if (wc) wc.loadURL('nevix://error?' + q.toString()).catch(() => {});
  }

  sleep() {
    if (this.sleeping || !this.view) return;
    const wc = this.wc;
    this.sleeping = true;
    if (wc) {
      this.win.app.unregisterWebContents(wc);
      this.win.removeView(this.view);
      try { wc.close({ waitForBeforeUnload: false }); } catch {}
    }
    this.view = null;
    this.loading = false;
    this.audible = false;
    this.win.scheduleState();
  }

  wake() {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.create(this.errorFor || this.url);
  }

  destroy() {
    const wc = this.wc;
    if (wc) {
      this.win.app.unregisterWebContents(wc);
      this.win.removeView(this.view);
      try { wc.close({ waitForBeforeUnload: false }); } catch {}
    }
    this.view = null;
  }

  info() {
    return {
      id: this.id, title: this.title || (this.displayUrl ? this.displayUrl : 'New Tab'), url: this.displayUrl, favicon: this.favicon,
      loading: this.loading, pinned: this.pinned, muted: this.muted, audible: this.audible, sleeping: this.sleeping,
      iso: this.isolated, internal: /^nevix:/.test(this.url) && !this.errorFor,
    };
  }
}

class NevixWindow {
  constructor(app_, opts = {}) {
    this.app = app_;
    this.isPrivate = !!opts.private;
    this.partition = this.isPrivate ? `nevix-private-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : 'persist:nevix';
    this.tabs = [];
    this.activeId = null;
    this.closed = [];
    this.overlay = false;
    this.infobarOpen = false;
    this.htmlFullscreen = false;
    this.pendingPerms = [];
    this.stateTimer = null;
    this.alive = true;

    const dark = this.isDark();
    const bounds = opts.bounds || {};
    this.win = new BrowserWindow({
      width: bounds.width || 1280, height: bounds.height || 820, x: bounds.x, y: bounds.y,
      minWidth: 480, minHeight: 360,
      show: false,
      title: 'Nevix',
      backgroundColor: this.isPrivate ? THEME.private.bg : dark ? THEME.dark.bg : THEME.light.bg,
      titleBarStyle: 'hidden',
      ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { color: this.isPrivate ? THEME.private.bg : dark ? THEME.dark.bg : THEME.light.bg, symbolColor: dark ? THEME.dark.symbol : THEME.light.symbol, height: TABSTRIP_H } }),
      icon: path.join(__dirname, '..', '..', 'assets', 'app-icon.png'),
    });
    this.win.removeMenu && !IS_MAC && this.win.removeMenu();

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
    this.ui.webContents.on('before-input-event', (e, input) => { if (this.handleKey(input, true)) e.preventDefault(); });
    this.ui.webContents.loadURL('nevix://ui/index.html' + (this.isPrivate ? '#private' : ''));

    this.win.on('resize', () => this.layout());
    this.win.on('maximize', () => this.layout());
    this.win.on('unmaximize', () => this.layout());
    this.win.on('enter-full-screen', () => { this.layout(); });
    this.win.on('leave-full-screen', () => { this.htmlFullscreen = false; this.layout(); });
    this.win.on('focus', () => app_.setLastWindow(this));
    this.win.on('close', () => { if (!this.isPrivate) app_.saveSession(); });
    this.win.on('closed', () => this.onClosed());
    const reveal = () => { if (this.alive && !this.win.isDestroyed() && !this.win.isVisible()) { this.win.show(); this.layout(); } };
    this.ui.webContents.once('did-finish-load', () => setTimeout(reveal, 60));
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
  }

  get active() { return this.tabs.find((t) => t.id === this.activeId) || null; }

  // ---- layout --------------------------------------------------------------------------------
  metrics() {
    const g = this.app.settings.get('general');
    const vertical = g.verticalTabs;
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
    try { a.view.setBorderRadius(10); } catch {}
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

  removeView(view) {
    try { this.win.contentView.removeChildView(view); } catch {}
  }

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

  // ---- tabs ----------------------------------------------------------------------------------
  newTab(opts = {}) {
    const url = opts.url === undefined ? this.app.settings.get('general.homepage') : opts.url;
    let partition = opts.partition;
    if (opts.isolated && !partition) partition = `nevix-iso-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const tab = new Tab(this, { ...opts, url: url || 'nevix://newtab', partition });
    if (tab.partition !== this.partition) { this.app.privacy.harden(tab.wc.session); this.app.watchSession(tab.wc.session); }
    let idx = this.tabs.length;
    if (opts.after) {
      idx = this.tabs.indexOf(opts.after) + 1;
      if (idx <= 0) idx = this.tabs.length;
    } else if (!tab.pinned) {
      idx = this.tabs.length;
    }
    this.tabs.splice(idx, 0, tab);
    if (!opts.background) this.activate(tab.id, !!(url === 'nevix://newtab' || !url));
    this.scheduleState();
    return tab;
  }

  activate(id, focusOmni = false) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const prev = this.active;
    if (prev && prev !== tab && prev.view) this.removeView(prev.view);
    this.activeId = id;
    tab.lastActive = Date.now();
    if (tab.sleeping) tab.wake();
    if (tab.view) this.win.contentView.addChildView(tab.view);
    if (this.overlay) this.win.contentView.addChildView(this.ui);
    this.layout();
    this.closeFind();
    if (focusOmni) { this.ui.webContents.focus(); this.send('focus-omnibox', {}); }
    else if (tab.wc && !this.overlay) tab.wc.focus();
    this.win.setTitle(tab.title ? `${tab.title} — Nevix` : 'Nevix');
    this.scheduleState();
  }

  closeTab(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const tab = this.tabs[i];
    if (!this.isPrivate && !tab.isolated && tab.displayUrl && !/^nevix:\/\/newtab/.test(tab.url)) {
      this.closed.push({ url: tab.errorFor || tab.url, title: tab.title, pinned: tab.pinned, index: i });
      if (this.closed.length > 25) this.closed.shift();
      this.app.recentlyClosed.push(this.closed[this.closed.length - 1]);
      if (this.app.recentlyClosed.length > 25) this.app.recentlyClosed.shift();
    }
    this.tabs.splice(i, 1);
    const wasActive = this.activeId === id;
    tab.destroy();
    if (!this.tabs.length) { this.win.close(); return; }
    if (wasActive) {
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      this.activeId = null;
      this.activate(next.id);
    }
    this.scheduleState();
  }

  reopenClosed() {
    const c = this.closed.pop();
    if (!c) return;
    this.newTab({ url: c.url, pinned: c.pinned });
  }

  moveTab(id, toIndex) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const [t] = this.tabs.splice(i, 1);
    // keep pinned tabs grouped on the left
    const pins = this.tabs.filter((x) => x.pinned).length;
    toIndex = t.pinned ? Math.min(toIndex, pins) : Math.max(toIndex, pins);
    this.tabs.splice(toIndex, 0, t);
    this.scheduleState();
  }

  cycle(dir) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length].id);
  }

  togglePin(id) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    t.pinned = !t.pinned;
    const i = this.tabs.indexOf(t);
    this.tabs.splice(i, 1);
    const pins = this.tabs.filter((x) => x.pinned).length;
    this.tabs.splice(t.pinned ? pins : pins, 0, t);
    this.scheduleState();
  }

  sleepIdle(minutes) {
    const now = Date.now();
    for (const t of this.tabs) {
      if (t.id === this.activeId || t.sleeping || t.audible || t.loading || /^nevix:/.test(t.url)) continue;
      if (now - t.lastActive > minutes * 60000) t.sleep();
    }
  }

  // ---- navigation ------------------------------------------------------------------------------
  navigate(text, opts = {}) {
    const url = resolveInput(text, this.app.settings);
    let tab = this.active;
    if (!tab || opts.newTab) tab = this.newTab({ url });
    else { if (tab.sleeping) tab.wake(); tab.load(url); }
    this.setOverlay(false);
    this.scheduleState();
    setTimeout(() => { const w = tab.wc; if (w && this.activeId === tab.id) w.focus(); }, 30);
  }

  // ---- find ------------------------------------------------------------------------------------
  find(text, opts = {}) {
    const wc = this.active && this.active.wc;
    if (!wc) return;
    if (!text) { wc.stopFindInPage('clearSelection'); this.send('find', { active: 0, matches: 0 }); return; }
    wc.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.next, matchCase: !!opts.matchCase });
  }
  closeFind() {
    const wc = this.active && this.active.wc;
    if (wc) wc.stopFindInPage('clearSelection');
  }

  // ---- key handling ----------------------------------------------------------------------------
  handleKey(input, fromUi = false) {
    if (input.type !== 'keyDown') return false;
    const mod = IS_MAC ? input.meta : input.control;
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    const shift = input.shift;
    const alt = input.alt;
    const k = (mod ? 'mod+' : '') + (input.control && !mod ? 'ctrl+' : '') + (alt ? 'alt+' : '') + (shift ? 'shift+' : '') + key;
    const n = parseInt(key, 10);
    const A = {
      'mod+t': ['newTab'], 'mod+n': ['newWindow'], 'mod+shift+n': ['privateWindow'], 'mod+w': ['closeTab'],
      'mod+shift+t': ['reopenTab'], 'mod+l': ['focusOmnibox'], 'F6': ['focusOmnibox'], 'mod+alt+l': ['focusOmnibox'],
      'mod+r': ['reload'], 'F5': ['reload'], 'mod+shift+r': ['hardReload'], 'ctrl+F5': ['hardReload'],
      'mod+f': ['find'], 'mod+d': ['bookmark'], 'mod+shift+b': ['toggleBookmarksBar'],
      'mod+h': IS_MAC ? null : ['openPage', 'history'], 'mod+y': ['openPage', 'history'], 'mod+j': ['openPage', 'downloads'],
      'mod+shift+o': ['openPage', 'bookmarks'], 'mod+shift+Delete': ['openPage', 'settings#data'],
      'mod+,': ['openPage', 'settings'], 'mod+k': ['palette'], 'mod+shift+p': ['palette'],
      'mod+p': ['print'], 'mod+=': ['zoomIn'], 'mod++': ['zoomIn'], 'mod+shift++': ['zoomIn'], 'mod+-': ['zoomOut'], 'mod+0': ['zoomReset'],
      'F11': ['fullscreen'], 'F12': ['devtools'], 'mod+shift+i': ['devtools'], 'mod+alt+i': ['devtools'], 'mod+u': ['viewSource'],
      [IS_MAC ? 'ctrl+Tab' : 'mod+Tab']: ['nextTab'], [IS_MAC ? 'ctrl+shift+Tab' : 'mod+shift+Tab']: ['prevTab'], 'mod+PageDown': ['nextTab'], 'mod+PageUp': ['prevTab'], 'mod+alt+ArrowRight': ['nextTab'], 'mod+alt+ArrowLeft': ['prevTab'],
      'alt+ArrowLeft': IS_MAC ? null : ['back'], 'alt+ArrowRight': IS_MAC ? null : ['forward'], 'mod+[': ['back'], 'mod+]': ['forward'],
      'mod+shift+e': ['toggleVertical'], 'mod+alt+r': ['reader'], 'mod+shift+s': ['capture'], 'mod+shift+m': ['muteTab'],
      'mod+shift+d': ['bookmarkAll'], 'mod+shift+c': ['copyCleanUrl'], 'mod+alt+n': ['isolatedTab'], 'mod+alt+s': ['sleepOthers'],
      'Escape': ['escape'],
    };
    let a = A[k];
    if (!a && mod && !shift && !alt && n >= 1 && n <= 9) a = ['gotoTab', n];
    if (!a) {
      // Find-next shortcuts
      if (k === 'F3' || k === 'mod+g') { this.send('find-next', { forward: true }); return true; }
      if (k === 'shift+F3' || k === 'mod+shift+g') { this.send('find-next', { forward: false }); return true; }
      return false;
    }
    if (a[0] === 'escape') {
      if (this.overlay || this.infobarOpen) { this.send('escape', {}); return true; }
      if (this.active && this.active.loading) { this.active.wc && this.active.wc.stop(); return true; }
      return false;
    }
    this.exec(a[0], a[1]);
    return true;
  }

  // ---- commands --------------------------------------------------------------------------------
  exec(name, arg) {
    const a = this.active;
    const wc = a && a.wc;
    const app_ = this.app;
    switch (name) {
      case 'newTab': this.newTab({ url: 'nevix://newtab' }); break;
      case 'isolatedTab': this.newTab({ url: 'nevix://newtab', isolated: true }); break;
      case 'newWindow': app_.createWindow({ url: 'nevix://newtab' }); break;
      case 'privateWindow': app_.createWindow({ private: true, url: 'nevix://newtab' }); break;
      case 'closeTab': if (a) this.closeTab(arg || a.id); break;
      case 'reopenTab': this.reopenClosed(); break;
      case 'focusOmnibox': this.ui.webContents.focus(); this.send('focus-omnibox', {}); break;
      case 'reload': if (a) { if (a.sleeping) a.wake(); else if (a.errorFor) a.load(a.errorFor); else wc && wc.reload(); } break;
      case 'hardReload': if (wc) wc.reloadIgnoringCache(); break;
      case 'stop': if (wc) wc.stop(); break;
      case 'back': if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'home': this.navigate(app_.settings.get('general.homepage')); break;
      case 'find': this.setInfobar(true); this.send('open-find', {}); break;
      case 'bookmark': this.toggleBookmark(); break;
      case 'bookmarkAll': for (const t of this.tabs) if (/^https?:/.test(t.url)) app_.bookmarks.add(t.url, t.title); app_.broadcastData('bookmarks'); break;
      case 'toggleBookmarksBar': app_.settings.set('general.bookmarksBar', !app_.settings.get('general.bookmarksBar')); app_.settingsChanged(); break;
      case 'toggleVertical': app_.settings.set('general.verticalTabs', !app_.settings.get('general.verticalTabs')); app_.settingsChanged(); break;
      case 'toggleSidebar': app_.settings.set('general.sidebarCollapsed', !app_.settings.get('general.sidebarCollapsed')); app_.settingsChanged(); break;
      case 'openPage': this.newTabOrReuse('nevix://' + arg); break;
      case 'palette': this.send('palette', {}); break;
      case 'print': if (wc) wc.print(); break;
      case 'savePdf': this.savePdf(); break;
      case 'zoomIn': this.zoom(+0.5); break;
      case 'zoomOut': this.zoom(-0.5); break;
      case 'zoomReset': this.zoom(0, true); break;
      case 'fullscreen': this.win.setFullScreen(!this.win.isFullScreen()); break;
      case 'devtools': if (wc) wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'right' }); break;
      case 'viewSource': if (a && /^https?:/.test(a.url)) this.newTab({ url: 'view-source:' + a.url, after: a }); break;
      case 'nextTab': this.cycle(1); break;
      case 'prevTab': this.cycle(-1); break;
      case 'gotoTab': { const i = arg === 9 ? this.tabs.length - 1 : arg - 1; if (this.tabs[i]) this.activate(this.tabs[i].id); break; }
      case 'reader': if (wc && /^https?:/.test(a.url)) wc.executeJavaScript(READER_SCRIPT).then((r) => { if (r === 'unsupported') this.send('toast', 'Reader mode isn’t available for this page'); }).catch(() => {}); break;
      case 'capture': this.capture(); break;
      case 'muteTab': if (a) this.muteTab(a.id); break;
      case 'copyCleanUrl': if (a) { clipboard.writeText(stripTracking(a.displayUrl)); this.send('toast', 'Clean link copied'); } break;
      case 'sleepOthers': for (const t of this.tabs) if (t.id !== this.activeId && !t.pinned) t.sleep(); break;
      case 'clearSiteData': this.clearSiteData(); break;
      case 'quit': app.quit(); break;
      default: break;
    }
  }

  newTabOrReuse(url) {
    const base = tidy(url).split('#')[0];
    const existing = this.tabs.find((t) => tidy(t.url).split('#')[0] === base);
    if (existing) { if (tidy(url) !== tidy(existing.url)) existing.load(url); this.activate(existing.id); }
    else this.newTab({ url });
  }

  zoom(delta, reset) {
    const a = this.active;
    const wc = a && a.wc;
    if (!wc) return;
    const host = hostOf(a.url);
    let z = reset ? 0 : Math.max(-3, Math.min(5, wc.getZoomLevel() + delta));
    wc.setZoomLevel(z);
    a.zoom = z;
    if (host) {
      const map = { ...this.app.settings.get('siteZoom') };
      if (z === 0) delete map[host]; else map[host] = z;
      this.app.settings.set('siteZoom', map);
    }
    this.scheduleState();
  }

  muteTab(id) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    t.muted = !t.muted;
    if (t.wc) t.wc.setAudioMuted(t.muted);
    this.scheduleState();
  }

  toggleBookmark() {
    const a = this.active;
    if (!a || !/^https?:/.test(a.url)) return;
    const on = this.app.bookmarks.toggle(a.url, a.title);
    this.app.broadcastData('bookmarks');
    this.send('toast', on ? 'Bookmark added' : 'Bookmark removed');
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

  async clearSiteData() {
    const a = this.active;
    if (!a || !a.wc) return;
    const origin = new URL(a.url).origin;
    await a.wc.session.clearStorageData({ origin });
    a.wc.reload();
    this.send('toast', 'Cleared cookies and site data for ' + hostOf(a.url));
  }

  // ---- infobar / permissions -----------------------------------------------------------------
  setInfobar(on) {
    if (this.infobarOpen === on) return;
    this.infobarOpen = on;
    this.layout();
  }

  askPermission(tab, permission, origin) {
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      this.pendingPerms.push({ id, tabId: tab.id, permission, origin, resolve });
      this.showNextPermission();
    });
  }

  showNextPermission() {
    const p = this.pendingPerms[0];
    if (!p || this.promptShown) return;
    this.promptShown = true;
    this.setInfobar(true);
    this.send('permission', { id: p.id, permission: p.permission, origin: p.origin });
  }

  answerPermission(id, allow, remember) {
    const i = this.pendingPerms.findIndex((p) => p.id === id);
    if (i === -1) return;
    const [p] = this.pendingPerms.splice(i, 1);
    if (remember && !this.isPrivate) this.app.rememberPermission(p.origin, p.permission, allow);
    p.resolve(!!allow);
    this.promptShown = false;
    if (this.pendingPerms.length) this.showNextPermission();
    else { this.send('permission', null); this.setInfobar(false); }
  }

  // ---- state to UI -----------------------------------------------------------------------------
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
    const reg = a ? registrable(hostOf(a.url)) : '';
    const site = reg ? this.app.settings.get('siteShields')[reg] : null;
    return {
      private: this.isPrivate,
      platform: process.platform,
      tabs: this.tabs.map((t) => t.info()),
      activeId: this.activeId,
      settings: {
        theme: g.theme, accent: g.accent, verticalTabs: g.verticalTabs, sidebarCollapsed: g.sidebarCollapsed,
        bookmarksBar: g.bookmarksBar, searchEngine: g.searchEngine,
      },
      active: a ? {
        url: a.displayUrl, rawUrl: a.url, title: a.title, canBack: a.canBack, canForward: a.canForward, loading: a.loading,
        secure: /^https:/.test(a.displayUrl) && !a.errorFor, internal: /^nevix:/.test(a.url) && !a.errorFor,
        counters: a.counters, zoom: a.zoom, bookmarked: this.app.bookmarks.has(a.url),
        shieldsOff: !!(site && site.off), host: hostOf(a.displayUrl), sleeping: a.sleeping, error: !!a.errorFor,
        perms: this.app.permissionsFor(hostOf(a.displayUrl)),
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
  }

  // ---- context menus ---------------------------------------------------------------------------
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
      add('Reader Mode', () => this.exec('reader'));
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
    const m = Menu.buildFromTemplate([
      { label: 'New Tab to the Right', click: () => this.newTab({ url: 'nevix://newtab', after: t }) },
      { type: 'separator' },
      { label: 'Reload', click: () => { if (t.sleeping) t.wake(); else t.wc && t.wc.reload(); } },
      { label: 'Duplicate', click: () => this.newTab({ url: t.errorFor || t.url, after: t, partition: t.isolated ? t.partition : undefined, isolated: t.isolated }) },
      { label: t.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => this.togglePin(id) },
      { label: t.muted ? 'Unmute Tab' : 'Mute Tab', click: () => this.muteTab(id) },
      { label: 'Put Tab to Sleep', enabled: id !== this.activeId && !t.sleeping, click: () => t.sleep() },
      { type: 'separator' },
      { label: 'Close Tab', click: () => this.closeTab(id) },
      { label: 'Close Other Tabs', click: () => this.tabs.filter((x) => x.id !== id && !x.pinned).forEach((x) => this.closeTab(x.id)) },
      { label: 'Close Tabs to the Right', click: () => { const i = this.tabs.indexOf(t); this.tabs.slice(i + 1).filter((x) => !x.pinned).forEach((x) => this.closeTab(x.id)); } },
      { label: 'Reopen Closed Tab', enabled: this.closed.length > 0, click: () => this.reopenClosed() },
    ]);
    m.popup({ window: this.win });
  }

  // ---- lifecycle -------------------------------------------------------------------------------
  onClosed() {
    this.alive = false;
    for (const t of this.tabs) t.destroy();
    this.tabs = [];
    this.app.uiWindows.delete(this.ui.webContents.id);
    try { this.ui.webContents.close(); } catch {}
    this.app.windowClosed(this);
  }

  snapshot() {
    return {
      tabs: this.tabs.filter((t) => !t.isolated && t.displayUrl).map((t) => ({ url: t.errorFor || t.url, title: t.title, pinned: t.pinned, favicon: '' })),
      active: Math.max(0, this.tabs.filter((t) => !t.isolated && t.displayUrl).findIndex((t) => t.id === this.activeId)),
      bounds: this.win.isDestroyed() ? undefined : this.win.getNormalBounds(),
    };
  }
}

module.exports = { NevixWindow, Tab, ALLOWED_SCHEMES, suggest };
