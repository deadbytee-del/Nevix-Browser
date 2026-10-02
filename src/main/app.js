'use strict';
// The orchestrator: owns the core state (settings, history, bookmarks, windows) and lazily constructs every
// feature module the first time something needs it, so unused features cost nothing at startup.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, BrowserWindow, session, nativeTheme, Menu, net } = require('electron');
const { Store } = require('./store');
const { SETTINGS, FILTER_LISTS } = require('./defaults');
const { History, Bookmarks, Stats } = require('./data');
const { Privacy } = require('./privacy');
const { NevixWindow } = require('./window');
const { resolveInput } = require('./omnibox');
const { hostOf } = require('./domain');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
};
const PAGES = new Set([
  'newtab', 'settings', 'history', 'bookmarks', 'downloads', 'error', 'auth', 'performance', 'privacy', 'extensions',
  'workspaces', 'snapshots', 'permissions', 'network', 'diagnostics', 'flags', 'about', 'recovery',
]);
const CSP = "default-src 'none'; script-src 'self' nevix://res; style-src 'self' nevix://res 'unsafe-inline'; img-src 'self' nevix://res data:; font-src 'self' nevix://res; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

class NevixApp {
  constructor(boot) {
    this.boot = boot;
    this.flags = boot.flags;
    this.recovery = boot.recovery;
    this.marks = boot.marks;
    this.userData = boot.userData;
    // First run = no settings yet, or the installer dropped a marker asking us to offer an import.
    this.firstRun = !fs.existsSync(path.join(this.userData, 'settings.json')) || fs.existsSync(path.join(this.userData, 'first-run-import'));
    this.settings = new Store(path.join(this.userData, 'settings.json'), SETTINGS);
    this.history = new History(this.userData);
    this.bookmarks = new Bookmarks(this.userData);
    this.stats = new Stats(this.userData);
    this.sessionStore = new Store(path.join(this.userData, 'session.json'), { windows: [] });
    this.sessionSeed = crypto.randomBytes(16).toString('hex');
    this.windows = new Set();
    this.uiWindows = new Map();
    this.byWc = new Map();             // webContents.id -> tab / popup info
    this.lastWindow = null;
    this.recentlyClosed = [];
    this.faviconCache = new Map();
    this.watched = new WeakSet();
    this.authPending = new Map();
    this.quitting = false;
    this.recoveryPending = false;      // true while the "restore previous session?" choice is open
    this.sessionTimer = null;
    this.privacy = new Privacy({
      settings: this.settings, stats: this.stats, userData: this.userData, flags: this.flags,
      tabFor: (wc) => (wc ? this.byWc.get(wc.id) : undefined),
      permissionCheck: (wc, perm, origin) => this.perm.check(wc, perm, origin),
      permissionAsk: (wc, perm, details) => this.perm.ask(wc, perm, details),
      deviceAllowed: (wc, kind) => this.perm.deviceAllowed(wc, kind),
      selectUsb: (wc, d, cb) => this.perm.selectUsb(wc, d, cb),
      history: this.history,
      log: (e) => this.plog.record(e),
    });
    this.lazyModules = {};
  }

  // ---- lazily constructed feature modules -----------------------------------------------------------------
  lazy(name, factory) {
    if (!(name in this.lazyModules)) this.lazyModules[name] = factory();
    return this.lazyModules[name];
  }
  get commands() { return this.lazy('commands', () => new (require('./commands').Commands)(this)); }
  get perm() { return this.lazy('perm', () => new (require('./permissions').Permissions)(this)); }
  get dl() { return this.lazy('dl', () => new (require('./downloads').Downloads)(this)); }
  get plog() { return this.lazy('plog', () => new (require('./privacy-log').PrivacyLog)(this)); }
  get life() { return this.lazy('life', () => new (require('./lifecycle').Lifecycle)(this)); }
  get perf() { return this.lazy('perf', () => new (require('./perf').Perf)(this)); }
  get spaces() { return this.lazy('spaces', () => new (require('./workspaces').Workspaces)(this)); }
  get ext() { return this.lazy('ext', () => new (require('./extensions').Extensions)(this)); }
  get diag() { return this.lazy('diag', () => new (require('./diagnostics').Diagnostics)(this)); }
  get io() { return this.lazy('io', () => new (require('./portability').Portability)(this)); }

  mark(name) { if (!this.marks[name]) this.marks[name] = Date.now(); }

  // ---- startup --------------------------------------------------------------------------------------------
  start(urls) {
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: 'Nevix', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }] },
        { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
      ]));
    } else {
      Menu.setApplicationMenu(null);
    }
    this.applyTheme();
    this.privacy.applyAppLevel();
    const defSes = session.defaultSession;
    this.privacy.harden(defSes);
    this.watchSession(defSes);
    this.privacy.harden(session.fromPartition('nevix-auth'));
    nativeTheme.on('updated', () => { for (const w of this.windows) { w.applyTheme(); w.pushState(); } });
    require('./ipc').registerIpc(this);
    this.startupWindows(urls);

    // Optional filter lists refresh once, shortly after startup, and only if the user enabled some.
    const stale = this.settings.get('privacy.lists').some((l) => l.enabled && Date.now() - l.updated > 7 * 864e5);
    if (stale) setTimeout(() => this.updateLists().catch(() => {}), 15000).unref();
    if (this.settings.get('extensions.enabled') && fs.existsSync(path.join(this.userData, 'extensions.json'))) setTimeout(() => this.ext.init().catch(() => {}), 600).unref();
    setTimeout(() => this.perf.recordLaunch(), 3000).unref();
    if (!this.flags.on('nevix-enable-startup-lazy-init')) this.eagerInit();
    else setImmediate(() => this.life); // lifecycle manager is idle until a tab goes to the background
  }

  /** With lazy init disabled (flag) everything is constructed up front. */
  eagerInit() { void [this.commands, this.perm, this.dl, this.perf, this.spaces, this.life]; if (this.settings.get('extensions.enabled')) void this.ext; }

  startupWindows(urls) {
    const mode = this.settings.get('general.startup');
    const saved = this.sessionStore.get('windows', []);
    const hasSaved = saved.some((s) => s.tabs && s.tabs.length);
    const w = (opts) => this.createWindow(opts);
    if (urls.length) {
      w({ url: urls[0] }); for (const u of urls.slice(1)) this.lastWindow.newTab({ url: u });
      return;
    }
    if (this.recovery.crashed && hasSaved) {
      // Don't pretend a page can always be restored perfectly: ask first, keep the saved session untouched meanwhile.
      this.recoveryPending = true;
      w({ url: 'nevix://recovery' });
      return;
    }
    if (mode === 'restore' && hasSaved) { this.restoreSession(); return; }
    w({ url: mode === 'homepage' ? this.settings.get('general.homepage') : 'nevix://newtab' });
  }

  restoreSession() {
    const saved = this.sessionStore.get('windows', []);
    this.recoveryPending = false;
    const first = [...this.windows][0];
    let reused = false;
    for (const s of saved) {
      if (!s.tabs || !s.tabs.length) continue;
      if (first && !reused && /nevix:\/\/recovery/.test(first.active && first.active.url)) {
        reused = true;
        first.restoreInto(s);
      } else this.createWindow({ tabs: s.tabs, active: s.active, bounds: s.bounds, groups: s.groups });
    }
    this.scheduleSessionSave();
  }

  startFresh() {
    this.recoveryPending = false;
    this.sessionStore.set('windows', []);
    const w = this.lastWindow;
    if (w && w.active) w.navigate('nevix://newtab');
  }

  // ---- registries -----------------------------------------------------------------------------------------
  registerWebContents(wc, tab) { this.byWc.set(wc.id, tab); }
  unregisterWebContents(wc) { try { this.byWc.delete(wc.id); } catch {} }
  setLastWindow(w) { this.lastWindow = w; }

  /** Popups opened by pages (OAuth etc.) keep a real opener relationship; give them the same shields. */
  adoptPopup(child, opener, details) {
    const wc = child.webContents;
    const info = { topUrl: details.url, counters: { ads: 0, trackers: 0, cookies: 0, upgrades: 0 }, win: null, notify() {}, popup: true };
    this.byWc.set(wc.id, info);
    wc.setWebRTCIPHandlingPolicy(this.privacy.webrtcPolicy());
    wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) info.topUrl = d.url; });
    wc.setWindowOpenHandler((d) => {
      if (/^https?:/.test(d.url)) opener.win.newTab({ url: d.url, after: opener });
      return { action: 'deny' };
    });
    child.on('closed', () => this.byWc.delete(wc.id));
    child.setMenuBarVisibility(false);
  }

  downloadDir() { return this.settings.get('general.downloadDir') || app.getPath('downloads'); }

  // ---- windows --------------------------------------------------------------------------------------------
  createWindow(opts = {}) {
    const w = new NevixWindow(this, { private: opts.private, bounds: opts.bounds });
    this.windows.add(w);
    this.lastWindow = w;
    if (opts.blank) { /* caller adds tabs */ }
    else if (opts.tabs && opts.tabs.length) w.restoreInto({ tabs: opts.tabs, active: opts.active || 0, groups: opts.groups || [] });
    else w.newTab({ url: opts.url || (opts.private ? 'nevix://newtab' : this.settings.get('general.homepage')) });
    return w;
  }

  windowClosed(w) {
    this.windows.delete(w);
    if (this.lastWindow === w) this.lastWindow = [...this.windows][this.windows.size - 1] || null;
    if (w.isPrivate) {
      const ses = w.session();
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
    }
    if (!this.quitting) this.scheduleSessionSave();
  }

  openUrls(urls) {
    const w = this.lastWindow || this.createWindow({});
    for (const u of urls) w.newTab({ url: /^file:/.test(u) ? u : resolveInput(u, this.settings) });
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
  }

  /** Persist enough state to rebuild the browser after a crash. Event-driven and debounced — no polling. */
  scheduleSessionSave() {
    if (this.sessionTimer || this.quitting) return;
    this.sessionTimer = setTimeout(() => { this.sessionTimer = null; this.saveSession(); }, 1500);
    this.sessionTimer.unref && this.sessionTimer.unref();
  }

  saveSession() {
    if (this.recoveryPending) return;       // keep the crashed session intact until the user decides
    const wins = [...this.windows].filter((w) => !w.isPrivate && w.alive).map((w) => w.snapshot()).filter((s) => s.tabs.length);
    if (wins.length) this.sessionStore.set('windows', wins);
    this.sessionStore.flush();
  }

  // ---- sessions -------------------------------------------------------------------------------------------
  watchSession(ses) {
    if (this.watched.has(ses)) return;
    this.watched.add(ses);
    if (!ses.protocol.isProtocolHandled('nevix')) ses.protocol.handle('nevix', (req) => this.serveInternal(req));
    this.privacy.applyProxy(ses);
    ses.on('will-download', (e, item, wc) => this.dl.onDownload(item, wc, ses, e));
    if (this.settings.get('extensions.enabled') && this.lazyModules.ext) this.ext.attach(ses);
  }

  serveInternal(req) {
    try {
      const u = new URL(req.url);
      let file;
      const baseHeaders = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' };
      if (u.hostname === 'res' && u.pathname === '/tokens.css') {
        return new Response(require('./theme').css(this.settings.get('general.accent')), { headers: { ...baseHeaders, 'content-type': MIME['.css'], 'cache-control': 'no-store' } });
      }
      if (u.hostname === 'ui') file = path.join(ROOT, 'ui', u.pathname.replace(/^\/+/, '') || 'index.html');
      else if (u.hostname === 'res') file = path.join(ROOT, 'pages', 'res', u.pathname.replace(/^\/+/, ''));
      else if (PAGES.has(u.hostname)) file = path.join(ROOT, 'pages', u.hostname + '.html');
      else return new Response('Not found', { status: 404 });
      const base = u.hostname === 'ui' ? path.join(ROOT, 'ui') : path.join(ROOT, 'pages');
      if (!path.resolve(file).startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
      const buf = fs.readFileSync(file);
      return new Response(buf, { headers: { ...baseHeaders, 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  async fetchFavicon(ses, url) {
    if (url.startsWith('data:')) return url.length < 100000 ? url : '';
    if (!/^https?:/.test(url)) return '';
    if (this.faviconCache.has(url)) return this.faviconCache.get(url);
    try {
      const res = await ses.fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(8000) });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/^image\//.test(type)) return '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 150000) return '';
      const d = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
      this.faviconCache.set(url, d);
      if (this.faviconCache.size > 400) this.faviconCache.delete(this.faviconCache.keys().next().value);
      return d;
    } catch { return ''; }
  }

  // ---- information for internal pages -----------------------------------------------------------------------
  aboutInfo() {
    return {
      name: 'Nevix', version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
      v8: process.versions.v8, node: process.versions.node, platform: `${process.platform} ${process.arch}`,
      userData: this.userData, portable: this.boot.portable, safeMode: this.boot.safeMode, packaged: app.isPackaged,
      isDefault: app.isDefaultProtocolClient('https'), crashReports: !!this.settings.get('advanced.crashReports'),
      hardwareAcceleration: this.settings.get('performance.hardwareAcceleration'),
      firstRun: this.firstRun && !this.settings.get('general.importDismissed'),
    };
  }

  recoveryInfo() {
    const wins = this.sessionStore.get('windows', []);
    const tabs = wins.reduce((n, w) => n + (w.tabs ? w.tabs.length : 0), 0);
    let when = 0;
    try { when = fs.statSync(path.join(this.userData, 'session.json')).mtimeMs; } catch {}
    return {
      windows: wins.length, tabs, groups: wins.reduce((n, w) => n + (w.groups ? w.groups.length : 0), 0), when,
      sample: wins.flatMap((w) => w.tabs || []).slice(0, 8).map((t) => ({ title: t.title || t.url, url: t.url })),
      crashLoop: !!this.boot.notice.crashLoop, disabledFlags: this.boot.notice.disabledFlags || [],
    };
  }

  /** Live request stream for nevix://network — active only while a page is subscribed. */
  netMonitor(sender, on) {
    this.netSubs = this.netSubs || new Set();
    if (on) {
      if (this.netSubs.has(sender)) return;
      this.netSubs.add(sender);
      sender.once('destroyed', () => this.netMonitor(sender, false));
      if (!this.netTap) {
        this.netBuf = [];
        this.netTap = (ev) => {
          this.netBuf.push({ ...ev, t: Date.now() });
          if (this.netBuf.length > 400) this.netBuf.shift();
          if (!this.netTimer) this.netTimer = setTimeout(() => {
            this.netTimer = null;
            const batch = this.netBuf.splice(0);
            for (const s of this.netSubs) { try { if (!s.isDestroyed()) s.send('nevix:net-event', batch); } catch {} }
          }, 250);
        };
        this.privacy.taps.add(this.netTap);
      }
    } else {
      this.netSubs.delete(sender);
      if (!this.netSubs.size && this.netTap) { this.privacy.taps.delete(this.netTap); this.netTap = null; this.netBuf = []; clearTimeout(this.netTimer); this.netTimer = null; }
    }
  }

  // ---- HTTP auth ------------------------------------------------------------------------------------------
  promptLogin(wc, auth, cb) {
    const id = crypto.randomBytes(6).toString('hex');
    const parent = BrowserWindow.fromWebContents(wc) || (this.lastWindow && this.lastWindow.win);
    const win = new BrowserWindow({
      width: 420, height: 300, parent, modal: !!parent, resizable: false, minimizable: false, maximizable: false,
      show: false, title: 'Sign in', autoHideMenuBar: true, backgroundColor: require('./theme').DARK['color-background'],
      webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, '..', 'preload', 'page.js'), partition: 'nevix-auth' },
    });
    win.removeMenu();
    this.watchSession(win.webContents.session);
    this.authPending.set(id, { cb, win, done: false });
    win.on('closed', () => { const p = this.authPending.get(id); if (p && !p.done) cb(); this.authPending.delete(id); });
    win.once('ready-to-show', () => win.show());
    win.loadURL('nevix://auth?' + new URLSearchParams({ id, host: auth.host, realm: auth.realm || '', scheme: auth.scheme, proxy: auth.isProxy ? '1' : '' }));
  }

  // ---- settings & broadcast -------------------------------------------------------------------------------
  applyTheme() {
    nativeTheme.themeSource = this.settings.get('general.theme');
    for (const w of this.windows) w.applyTheme();
  }

  settingsChanged(path_) {
    this.applyTheme();
    this.privacy.applyAppLevel();
    for (const w of this.windows) {
      for (const t of w.tabs) if (t.wc) t.wc.setWebRTCIPHandlingPolicy(this.privacy.webrtcPolicy());
      w.layout(); w.pushState();
    }
    if (path_ && /^privacy\.proxy$/.test(path_)) {
      for (const w of this.windows) { this.privacy.applyProxy(w.session()); for (const t of w.tabs) if (t.wc) this.privacy.applyProxy(t.wc.session); }
    }
    if (path_ && /^privacy\.lists/.test(path_)) this.privacy.reloadLists();
    if (this.lazyModules.life && /^performance\./.test(path_ || '')) this.life.reschedule();
    if (this.lazyModules.commands && /^shortcuts/.test(path_ || '')) this.commands.rebuild();
    this.broadcastData('settings');
  }

  broadcastData(topic) {
    for (const [, t] of this.byWc) {
      if (!t.win || !t.url || !/^nevix:/.test(t.url) || !t.wc) continue;
      try { t.wc.send('nevix:changed', topic); } catch {}
    }
    if (topic === 'bookmarks') for (const w of this.windows) { w.send('bookmarks', this.bookmarks.items); w.scheduleState(); }
  }

  // ---- filter list updates --------------------------------------------------------------------------------
  async updateLists() {
    const dir = path.join(this.userData, 'lists');
    fs.mkdirSync(dir, { recursive: true });
    const lists = this.settings.get('privacy.lists').map((l) => ({ ...l }));
    const result = [];
    for (const l of lists) {
      if (!l.enabled) continue;
      const def = FILTER_LISTS.find((x) => x.id === l.id);
      if (!def) continue;
      try {
        const res = await net.fetch(def.url, { credentials: 'omit', headers: { 'user-agent': this.privacy.userAgent() } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        fs.writeFileSync(path.join(dir, def.id + '.txt'), text);
        l.updated = Date.now();
        result.push({ id: def.id, ok: true, bytes: text.length });
      } catch (e) { result.push({ id: def.id, ok: false, error: e.message }); }
    }
    this.settings.set('privacy.lists', lists);
    this.privacy.reloadLists();
    this.broadcastData('settings');
    return result;
  }

  // ---- clearing data --------------------------------------------------------------------------------------
  allSessions() {
    const out = new Set([session.fromPartition('persist:nevix')]);
    for (const w of this.windows) for (const t of w.tabs) if (t.wc) out.add(t.wc.session);
    return [...out];
  }

  async clearData(opts) {
    const since = opts.range ? opts.range * 3600e3 : 0;
    if (opts.history) this.history.clear(since);
    if (opts.downloads) this.dl.clearFinished(true);
    const storages = [];
    if (opts.cookies) storages.push('cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem');
    for (const s of this.allSessions()) {
      if (storages.length) await s.clearStorageData({ storages });
      if (opts.cache) { await s.clearCache(); await s.clearCodeCaches({}); }
    }
    if (opts.cookies) await session.fromPartition('persist:nevix').clearAuthCache().catch(() => {});
    this.broadcastData('history'); this.broadcastData('downloads');
  }

  async onQuit() {
    const c = this.settings.get('privacy.clearOnExit');
    this.saveSession();
    if (c.history || c.cookies || c.cache || c.downloads) await this.clearData({ ...c, range: 0 });
    this.settings.flush(); this.history.store.flush(); this.bookmarks.store.flush(); this.stats.store.flush(); this.sessionStore.flush();
    for (const m of Object.values(this.lazyModules)) { try { m && m.flush && m.flush(); } catch {} }
  }
}

module.exports = { NevixApp, PAGES };
