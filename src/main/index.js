'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  app, BrowserWindow, protocol, session, ipcMain, nativeTheme, dialog, shell, Menu, net, powerMonitor,
} = require('electron');

// ---------------------------------------------------------------------------------------------
// Chromium switches: strip every background call-home, keep the speed features.
// ---------------------------------------------------------------------------------------------
app.setName('Nevix');
const sw = app.commandLine;
for (const s of [
  'disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-sync',
  'disable-client-side-phishing-detection', 'disable-default-apps', 'disable-breakpad', 'no-pings',
  'no-default-browser-check', 'no-first-run', 'disable-translate', 'metrics-recording-only', 'disable-speech-api',
]) sw.appendSwitch(s);
sw.appendSwitch('disable-features', [
  'Translate', 'InterestFeedContentSuggestions', 'PrivacySandboxSettings4', 'OptimizationHints', 'MediaRouter',
  'AutofillServerCommunication', 'CertificateTransparencyComponentUpdater', 'NetworkTimeServiceQuerying',
  'FederatedLearning', 'Topics', 'AttributionReporting', 'BrowsingTopics', 'FledgeInterestGroup', 'FirstPartySets',
  'GlobalMediaControls', 'LiveCaption', 'ReportingServiceProxy', 'NotificationTriggers',
].join(','));
sw.appendSwitch('enable-features', ['ParallelDownloading', 'BackForwardCache'].concat(process.platform === 'linux' ? ['VaapiVideoDecoder'] : []).join(','));
sw.appendSwitch('enable-quic');
sw.appendSwitch('autoplay-policy', 'document-user-activation-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'nevix', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const { Store } = require('./store');
const { SETTINGS, FILTER_LISTS } = require('./defaults');
const { History, Bookmarks, Stats } = require('./data');
const { Privacy } = require('./privacy');
const { NevixWindow, suggest } = require('./window');
const { registrable, hostOf } = require('./domain');
const { resolveInput } = require('./omnibox');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
};
const PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'error', 'auth']);
const CSP = "default-src 'none'; script-src 'self' nevix://res; style-src 'self' nevix://res 'unsafe-inline'; img-src 'self' nevix://res data:; font-src 'self' nevix://res; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock', 'speaker-selection', 'persistent-storage']);
const ASK = new Set(['media', 'geolocation', 'clipboard-read', 'display-capture', 'midi', 'midiSysex']);
const PERM_LABEL = {
  media: 'use your camera or microphone', geolocation: 'know your location', 'clipboard-read': 'read your clipboard',
  'display-capture': 'capture your screen', midi: 'use MIDI devices', midiSysex: 'use MIDI devices',
};

class NevixApp {
  constructor() {
    this.userData = app.getPath('userData');
    this.settings = new Store(path.join(this.userData, 'settings.json'), SETTINGS);
    this.history = new History(this.userData);
    this.bookmarks = new Bookmarks(this.userData);
    this.stats = new Stats(this.userData);
    this.sessionStore = new Store(path.join(this.userData, 'session.json'), { windows: [] });
    this.downloadStore = new Store(path.join(this.userData, 'downloads.json'), { items: [] });
    this.sessionSeed = crypto.randomBytes(16).toString('hex');
    this.windows = new Set();
    this.uiWindows = new Map();
    this.byWc = new Map();       // webContents.id -> tab / popup info
    this.lastWindow = null;
    this.recentlyClosed = [];
    this.downloads = this.downloadStore.get('items').filter((d) => d.state !== 'progressing');
    this.dlItems = new Map();
    this.dlSeq = Date.now();
    this.faviconCache = new Map();
    this.watched = new WeakSet();
    this.authPending = new Map();
    this.privacy = new Privacy({
      settings: this.settings, stats: this.stats, userData: this.userData,
      tabFor: (wc) => (wc ? this.byWc.get(wc.id) : undefined),
      permissionCheck: (wc, perm, origin) => this.permissionCheck(wc, perm, origin),
      permissionAsk: (wc, perm, details) => this.permissionAsk(wc, perm, details),
    });
  }

  // ---- registries ----------------------------------------------------------------------------
  registerWebContents(wc, tab) { this.byWc.set(wc.id, tab); }
  unregisterWebContents(wc) { try { this.byWc.delete(wc.id); } catch {} }
  setLastWindow(w) { this.lastWindow = w; }

  /** Popups opened by pages (OAuth etc.) keep a real opener relationship; give them the same shields. */
  adoptPopup(child, opener, details) {
    const wc = child.webContents;
    const info = {
      topUrl: details.url, counters: { ads: 0, trackers: 0, cookies: 0, upgrades: 0 }, win: null, notify() {},
    };
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

  downloadDir() {
    return this.settings.get('general.downloadDir') || app.getPath('downloads');
  }

  // ---- windows -------------------------------------------------------------------------------
  createWindow(opts = {}) {
    const w = new NevixWindow(this, { private: opts.private, bounds: opts.bounds });
    this.windows.add(w);
    this.lastWindow = w;
    if (opts.tabs && opts.tabs.length) {
      opts.tabs.forEach((t, i) => w.newTab({ url: t.url, title: t.title, pinned: t.pinned, background: i !== (opts.active || 0), sleeping: i !== (opts.active || 0) && !t.pinned && opts.tabs.length > 3 }));
      const act = w.tabs[opts.active || 0];
      if (act) w.activate(act.id);
    } else {
      w.newTab({ url: opts.url || (opts.private ? 'nevix://newtab' : this.settings.get('general.homepage')) });
    }
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
    if (!this.quitting) this.saveSession();
  }

  openUrls(urls) {
    const w = this.lastWindow || this.createWindow({});
    for (const u of urls) w.newTab({ url: resolveInput(u, this.settings) });
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
  }

  saveSession() {
    const wins = [...this.windows].filter((w) => !w.isPrivate && w.alive).map((w) => w.snapshot()).filter((s) => s.tabs.length);
    if (wins.length) this.sessionStore.set('windows', wins);
    this.sessionStore.flush();
  }

  startup() {
    const mode = this.settings.get('general.startup');
    const urls = process.argv.slice(1).filter((a) => /^https?:\/\//i.test(a));
    if (mode === 'restore' && !urls.length) {
      const saved = this.sessionStore.get('windows', []);
      if (saved.length) {
        for (const s of saved) this.createWindow({ tabs: s.tabs, active: s.active, bounds: s.bounds });
        return;
      }
    }
    if (urls.length) { this.createWindow({ url: urls[0] }); for (const u of urls.slice(1)) this.lastWindow.newTab({ url: u }); }
    else this.createWindow({ url: mode === 'homepage' ? this.settings.get('general.homepage') : 'nevix://newtab' });
  }

  // ---- sessions ------------------------------------------------------------------------------
  watchSession(ses) {
    if (this.watched.has(ses)) return;
    this.watched.add(ses);
    if (!ses.protocol.isProtocolHandled('nevix')) ses.protocol.handle('nevix', (req) => this.serveInternal(req));
    this.privacy.applyProxy(ses);
    ses.on('will-download', (e, item, wc) => this.onDownload(item, wc));
  }

  serveInternal(req) {
    try {
      const u = new URL(req.url);
      let file;
      if (u.hostname === 'ui') file = path.join(ROOT, 'ui', u.pathname.replace(/^\/+/, '') || 'index.html');
      else if (u.hostname === 'res' && u.pathname === '/tokens.css') {
        return new Response(require('./theme').css(this.settings.get('general.accent')), { headers: { 'content-type': MIME['.css'], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      }
      else if (u.hostname === 'res') file = path.join(ROOT, 'pages', 'res', u.pathname.replace(/^\/+/, ''));
      else if (PAGES.has(u.hostname)) file = path.join(ROOT, 'pages', u.hostname + '.html');
      else return new Response('Not found', { status: 404 });
      const base = u.hostname === 'ui' ? path.join(ROOT, 'ui') : path.join(ROOT, 'pages');
      if (!path.resolve(file).startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
      const buf = fs.readFileSync(file);
      return new Response(buf, {
        headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
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

  // ---- permissions ---------------------------------------------------------------------------
  stored(host, perm) { const s = this.settings.get('sitePermissions')[host]; return s && s[perm]; }

  permissionCheck(wc, perm, origin) {
    const host = hostOf(origin || '');
    const st = this.stored(host, perm);
    if (st) return st === 'allow';
    if (/^nevix:/.test(origin || '')) return perm === 'clipboard-sanitized-write';
    return AUTO_ALLOW.has(perm);
  }

  async permissionAsk(wc, perm, details) {
    const origin = details.requestingUrl || (wc && wc.getURL()) || '';
    const host = hostOf(origin);
    const st = this.stored(host, perm);
    if (st) return st === 'allow';
    if (AUTO_ALLOW.has(perm)) return true;
    if (!ASK.has(perm)) return false;
    const tab = this.byWc.get(wc.id);
    if (!tab || !tab.win) return false;
    let label = PERM_LABEL[perm] || perm;
    if (perm === 'media' && details.mediaTypes) {
      const t = details.mediaTypes;
      label = t.includes('video') && t.includes('audio') ? 'use your camera and microphone' : t.includes('video') ? 'use your camera' : 'use your microphone';
    }
    return tab.win.askPermission(tab, perm, { host, label });
  }

  rememberPermission(origin, perm, allow) {
    const map = { ...this.settings.get('sitePermissions') };
    map[origin.host] = { ...(map[origin.host] || {}), [perm]: allow ? 'allow' : 'deny' };
    this.settings.set('sitePermissions', map);
  }

  permissionsFor(host) {
    const s = this.settings.get('sitePermissions')[host] || {};
    return Object.entries(s).map(([k, v]) => ({ perm: k, value: v }));
  }

  // ---- downloads -----------------------------------------------------------------------------
  onDownload(item, wc) {
    const tab = wc ? this.byWc.get(wc.id) : null;
    const isPrivate = !!(tab && tab.win && tab.win.isPrivate);
    const id = ++this.dlSeq;
    const dir = this.downloadDir();
    const name = (item.getFilename() || 'download').replace(/[\\/:*?"<>|]/g, '_');
    const rec = {
      id, name, url: item.getURL().split('#')[0], state: 'progressing', received: 0, total: item.getTotalBytes(),
      path: '', time: Date.now(), private: isPrivate,
    };
    if (!this.settings.get('general.askDownloadLocation')) {
      fs.mkdirSync(dir, { recursive: true });
      let target = path.join(dir, name);
      const ext = path.extname(name); const base = path.basename(name, ext);
      for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${base} (${i})${ext}`);
      item.setSavePath(target);
      rec.path = target;
    }
    this.downloads.unshift(rec);
    this.dlItems.set(id, item);
    let last = 0;
    const push = (force) => {
      const now = Date.now();
      if (!force && now - last < 250) return;
      last = now;
      rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
      if (item.getSavePath()) { rec.path = item.getSavePath(); rec.name = path.basename(rec.path); }
      this.broadcastDownloads();
    };
    item.on('updated', (_e, state) => { rec.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'; push(); });
    item.on('done', (_e, state) => {
      rec.state = state; rec.done = Date.now();
      this.dlItems.delete(id);
      push(true);
      if (!isPrivate) this.persistDownloads();
      const w = tab && tab.win;
      if (w && state === 'completed') w.send('toast', `Downloaded ${rec.name}`);
    });
    if (tab && tab.win) tab.win.send('download-started', rec);
  }

  persistDownloads() {
    this.downloadStore.set('items', this.downloads.filter((d) => !d.private && d.state !== 'progressing').slice(0, 200));
  }

  broadcastDownloads() {
    const list = this.downloads.slice(0, 100);
    for (const w of this.windows) w.send('downloads', list);
    this.broadcastData('downloads');
  }

  downloadAction(id, action) {
    const rec = this.downloads.find((d) => d.id === id);
    const item = this.dlItems.get(id);
    if (action === 'cancel' && item) item.cancel();
    else if (action === 'pause' && item) item.pause();
    else if (action === 'resume' && item) item.resume();
    else if (rec && action === 'open' && rec.path && fs.existsSync(rec.path)) shell.openPath(rec.path);
    else if (rec && action === 'show' && rec.path) shell.showItemInFolder(rec.path);
    else if (action === 'remove') { this.downloads = this.downloads.filter((d) => d.id !== id); this.persistDownloads(); this.broadcastDownloads(); }
    else if (action === 'clear') { this.downloads = this.downloads.filter((d) => d.state === 'progressing'); this.persistDownloads(); this.broadcastDownloads(); }
  }

  // ---- settings & broadcast ------------------------------------------------------------------
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
    if (path_ && /^privacy\.(proxy)$/.test(path_)) {
      for (const w of this.windows) { this.privacy.applyProxy(w.session()); for (const t of w.tabs) if (t.wc) this.privacy.applyProxy(t.wc.session); }
    }
    if (path_ && /^privacy\.lists/.test(path_)) this.privacy.reloadLists();
    this.broadcastData('settings');
  }

  broadcastData(topic) {
    for (const [id, t] of this.byWc) {
      if (!t.win || !t.url || !/^nevix:/.test(t.url) || !t.wc) continue;
      try { t.wc.send('nevix:changed', topic); } catch {}
    }
    if (topic === 'bookmarks') for (const w of this.windows) { w.send('bookmarks', this.bookmarks.items); w.scheduleState(); }
  }

  // ---- filter list updates -------------------------------------------------------------------
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

  // ---- clearing data -------------------------------------------------------------------------
  async clearData(opts) {
    const since = opts.range ? opts.range * 3600e3 : 0;
    const ses = session.fromPartition('persist:nevix');
    if (opts.history) this.history.clear(since);
    if (opts.downloads) { this.downloads = this.downloads.filter((d) => d.state === 'progressing'); this.persistDownloads(); }
    const storages = [];
    if (opts.cookies) storages.push('cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql', 'filesystem');
    for (const s of [ses, ...[...this.windows].flatMap((w) => w.tabs.filter((t) => t.wc && t.wc.session !== ses).map((t) => t.wc.session))]) {
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
    this.settings.flush(); this.history.store.flush(); this.bookmarks.store.flush(); this.stats.store.flush();
    this.downloadStore.flush();
  }
}

// ---------------------------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock && process.env.NEVIX_E2E !== '1') app.quit();

let nx;
app.userAgentFallback = (() => {
  const chrome = process.versions.chrome.split('.')[0];
  const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`;
})();

app.on('second-instance', (_e, argv) => {
  if (!nx) return;
  const urls = argv.slice(1).filter((a) => /^https?:\/\//i.test(a));
  if (urls.length) nx.openUrls(urls);
  else if (nx.lastWindow) { if (nx.lastWindow.win.isMinimized()) nx.lastWindow.win.restore(); nx.lastWindow.win.focus(); }
});
app.on('open-url', (e, url) => { e.preventDefault(); if (nx) nx.openUrls([url]); });

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

app.on('certificate-error', (e, wc, url, error, cert, cb) => {
  e.preventDefault();
  try {
    const u = new URL(url);
    cb(!!nx && nx.privacy.certAllowed.has(u.host));
  } catch { cb(false); }
});

app.on('login', (e, wc, req, auth, cb) => {
  e.preventDefault();
  if (!nx) return cb();
  const id = crypto.randomBytes(6).toString('hex');
  const parent = BrowserWindow.fromWebContents(wc) || (nx.lastWindow && nx.lastWindow.win);
  const win = new BrowserWindow({
    width: 420, height: 300, parent, modal: !!parent, resizable: false, minimizable: false, maximizable: false,
    show: false, title: 'Sign in', autoHideMenuBar: true, backgroundColor: require('./theme').DARK['color-background'],
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, '..', 'preload', 'page.js'), partition: 'nevix-auth' },
  });
  win.removeMenu();
  nx.watchSession(win.webContents.session);
  nx.authPending.set(id, { cb, win, done: false });
  win.on('closed', () => { const p = nx.authPending.get(id); if (p && !p.done) cb(); nx.authPending.delete(id); });
  win.once('ready-to-show', () => win.show());
  win.loadURL('nevix://auth?' + new URLSearchParams({ id, host: auth.host, realm: auth.realm || '', scheme: auth.scheme, proxy: auth.isProxy ? '1' : '' }));
});

// ---- IPC: browser UI -------------------------------------------------------------------------
ipcMain.handle('nx:cmd', (e, name, arg) => {
  const w = nx.uiWindows.get(e.sender.id);
  if (!w) return null;
  switch (name) {
    case 'state': return w.state();
    case 'tab.activate': return w.activate(arg);
    case 'tab.close': return w.closeTab(arg);
    case 'tab.new': return w.newTab({ url: 'nevix://newtab', isolated: !!(arg && arg.isolated) });
    case 'tab.context': return w.tabContextMenu(arg);
    case 'tab.move': return w.moveTab(arg.id, arg.index);
    case 'tab.pin': return w.togglePin(arg);
    case 'tab.mute': return w.muteTab(arg);
    case 'nav': return w.navigate(arg.text, { newTab: arg.newTab });
    case 'exec': return w.exec(arg.name, arg.arg);
    case 'overlay': return w.setOverlay(arg);
    case 'infobar': return w.setInfobar(arg);
    case 'find': return w.find(arg.text, arg);
    case 'find.close': w.closeFind(); w.setInfobar(false); { const a = w.active; if (a && a.wc) a.wc.focus(); } return null;
    case 'suggest': return suggest(arg, {
      history: nx.history, bookmarks: nx.bookmarks, settings: nx.settings,
      tabs: w.tabs.map((t) => ({ id: t.id, title: t.title, url: t.errorFor || t.url })).filter((t) => /^https?:/.test(t.url)),
    });
    case 'perm.answer': return w.answerPermission(arg.id, arg.allow, arg.remember);
    case 'shield.site': {
      const a = w.active; if (!a) return null;
      const reg = registrable(hostOf(a.displayUrl)); if (!reg) return null;
      const map = { ...nx.settings.get('siteShields') };
      if (arg.off) map[reg] = { off: true }; else delete map[reg];
      nx.settings.set('siteShields', map);
      nx.broadcastData('settings');
      if (a.wc) a.wc.reload();
      return null;
    }
    case 'perm.revoke': {
      const a = w.active; if (!a) return null;
      const host = hostOf(a.displayUrl);
      const map = { ...nx.settings.get('sitePermissions') };
      if (map[host]) { const m = { ...map[host] }; delete m[arg]; if (Object.keys(m).length) map[host] = m; else delete map[host]; nx.settings.set('sitePermissions', map); }
      w.scheduleState();
      return null;
    }
    case 'bookmarks': return nx.bookmarks.items;
    case 'bookmark.remove': nx.bookmarks.remove(arg); nx.broadcastData('bookmarks'); return null;
    case 'bookmark.move': nx.bookmarks.move(arg.id, arg.index); nx.broadcastData('bookmarks'); return null;
    case 'downloads': return nx.downloads.slice(0, 100);
    case 'download.action': return nx.downloadAction(arg.id, arg.action);
    case 'stats': return { ...nx.stats.all, listCount: nx.privacy.listCount };
    case 'settings': return nx.settings.get('general');
    case 'setting.set': nx.settings.set('general.' + arg.key, arg.value); nx.settingsChanged('general.' + arg.key); return null;
    case 'quit': return app.quit();
    default: return null;
  }
});

// ---- IPC: nevix:// pages ---------------------------------------------------------------------
ipcMain.on('nevix:page-config', (e, href) => {
  try {
    const tab = nx.byWc.get(e.sender.id);
    const top = (tab && tab.topUrl) || href;
    const p = nx.settings.get('privacy');
    const off = nx.privacy.shieldsOffFor(top);
    const seed = parseInt(crypto.createHash('sha256').update(nx.sessionSeed + registrable(hostOf(top))).digest('hex').slice(0, 8), 16);
    e.returnValue = {
      fp: p.fingerprint && !off, cosmetic: p.cosmetic && !off, seed, lang: p.spoofLanguage,
      thirdPartyCookies: p.thirdPartyCookies && !off,
    };
  } catch { e.returnValue = { fp: false, cosmetic: false, seed: 1, lang: false, thirdPartyCookies: false }; }
});

ipcMain.handle('nevix:internal', async (e, cmd, arg) => {
  const frame = e.senderFrame;
  if (!frame || frame !== e.sender.mainFrame || !/^nevix:\/\//.test(frame.url)) throw new Error('forbidden');
  const S = nx.settings;
  const tab = nx.byWc.get(e.sender.id);
  switch (cmd) {
    case 'settings:get': return {
      general: S.get('general'), privacy: S.get('privacy'), siteShields: S.get('siteShields'),
      sitePermissions: S.get('sitePermissions'),
      engines: require('./defaults').SEARCH_ENGINES, filterLists: FILTER_LISTS, listCount: nx.privacy.listCount,
    };
    case 'settings:set': {
      if (!/^(general|privacy)\.[A-Za-z.]+$/.test(arg.path)) throw new Error('bad path');
      S.set(arg.path, arg.value);
      if (arg.path === 'general.spellcheck') for (const w of nx.windows) { nx.privacy.applySpellcheck(w.session()); for (const t of w.tabs) if (t.wc) nx.privacy.applySpellcheck(t.wc.session); }
      nx.settingsChanged(arg.path);
      return true;
    }
    case 'siteShields:remove': { const m = { ...S.get('siteShields') }; delete m[arg]; S.set('siteShields', m); nx.broadcastData('settings'); return true; }
    case 'sitePermissions:remove': { const m = { ...S.get('sitePermissions') }; delete m[arg]; S.set('sitePermissions', m); nx.broadcastData('settings'); return true; }
    case 'history:list': return nx.history.search(arg && arg.q, 500);
    case 'history:remove': nx.history.remove(arg); nx.broadcastData('history'); return true;
    case 'history:clear': nx.history.clear(arg ? arg * 3600e3 : 0); nx.broadcastData('history'); return true;
    case 'bookmarks:list': return nx.bookmarks.items;
    case 'bookmarks:remove': nx.bookmarks.remove(arg); nx.broadcastData('bookmarks'); return true;
    case 'bookmarks:rename': nx.bookmarks.rename(arg.id, String(arg.title).slice(0, 300)); nx.broadcastData('bookmarks'); return true;
    case 'bookmarks:import': {
      const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }] });
      if (r.canceled || !r.filePaths[0]) return 0;
      const n = nx.bookmarks.importHtml(fs.readFileSync(r.filePaths[0], 'utf8'));
      nx.broadcastData('bookmarks');
      return n;
    }
    case 'bookmarks:export': {
      const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), 'nevix-bookmarks.html'), filters: [{ name: 'HTML', extensions: ['html'] }] });
      if (r.canceled || !r.filePath) return false;
      fs.writeFileSync(r.filePath, nx.bookmarks.exportHtml());
      return true;
    }
    case 'downloads:list': return nx.downloads.slice(0, 200);
    case 'downloads:action': nx.downloadAction(arg.id, arg.action); return true;
    case 'stats:get': return { ...nx.stats.all, listCount: nx.privacy.listCount };
    case 'topsites': return nx.history.top(8).map((h) => ({ url: h.url, title: h.title }));
    case 'data:clear': await nx.clearData(arg); return true;
    case 'lists:update': return nx.updateLists();
    case 'app:info': return {
      name: 'Nevix', version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
      v8: process.versions.v8, platform: process.platform + ' ' + process.arch, userData: nx.userData,
      isDefault: app.isDefaultProtocolClient('https'),
    };
    case 'default:set': app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); return app.isDefaultProtocolClient('https');
    case 'download:dir': {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      S.set('general.downloadDir', r.filePaths[0]); nx.broadcastData('settings');
      return r.filePaths[0];
    }
    case 'error:proceed': {
      if (!tab || !tab.win) return false;
      if (arg.kind === 'https') {
        const h = hostOf(arg.http);
        if (h) nx.privacy.httpAllowed.add(h);
        tab.load(arg.http);
      } else if (arg.kind === 'cert') {
        try { nx.privacy.certAllowed.add(new URL(arg.url).host); } catch {}
        tab.load(arg.url);
      }
      return true;
    }
    case 'error:retry': if (tab) tab.load(arg); return true;
    case 'error:back': if (tab && tab.wc && tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack(); else if (tab) tab.load('nevix://newtab'); return true;
    case 'auth:submit': {
      const p = nx.authPending.get(arg.id);
      if (!p) return false;
      p.done = true;
      if (arg.cancel) p.cb(); else p.cb(arg.user, arg.pass);
      nx.authPending.delete(arg.id);
      p.win.close();
      return true;
    }
    case 'resolve': return resolveInput(arg, S);
    case 'open:tab': if (tab && tab.win) tab.win.newTab({ url: resolveInput(arg, S) }); return true;
    default: throw new Error('unknown command');
  }
});

// ---- boot ------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  nx = new NevixApp();
  global.__nevix = nx;
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Nevix', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
  nx.applyTheme();
  nx.privacy.applyAppLevel();
  const defSes = session.defaultSession;
  nx.privacy.harden(defSes);
  nx.watchSession(defSes);
  nx.privacy.harden(session.fromPartition('nevix-auth'));
  nativeTheme.on('updated', () => { for (const w of nx.windows) { w.applyTheme(); w.pushState(); } });

  nx.startup();

  // Put idle tabs to sleep to save memory.
  setInterval(() => {
    const m = nx.settings.get('general.tabSleepMinutes');
    if (m > 0) for (const w of nx.windows) w.sleepIdle(m);
  }, 60000).unref();
  setInterval(() => nx.saveSession(), 30000).unref();

  // Weekly filter-list refresh (only for lists the user enabled).
  const stale = nx.settings.get('privacy.lists').some((l) => l.enabled && Date.now() - l.updated > 7 * 864e5);
  if (stale) setTimeout(() => nx.updateLists().catch(() => {}), 15000).unref();

  // Test harness hook: only active when the environment explicitly opts in (never from argv alone).
  const e2e = process.env.NEVIX_E2E === '1' ? process.argv.indexOf('--nevix-e2e') : -1;
  if (e2e !== -1 && process.argv[e2e + 1]) {
    setTimeout(() => require(path.resolve(process.argv[e2e + 1]))(nx, { app, session }).catch((err) => { console.error('E2E FAIL', err); app.exit(1); }), 1500);
  }
});

let quitDone = false;
app.on('before-quit', (e) => {
  if (!nx) return;
  nx.quitting = true;
  if (quitDone) return;
  e.preventDefault();
  quitDone = true;
  nx.onQuit().catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (nx && !nx.windows.size) nx.createWindow({}); });
