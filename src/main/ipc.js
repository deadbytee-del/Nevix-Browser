'use strict';
// IPC router. Two channels:
//   nx:cmd          chrome UI -> main        (only from a registered browser window)
//   nevix:internal  nevix:// pages -> main   (only from the main frame of a nevix:// page)
// Feature modules are required lazily the first time one of their commands is used.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, ipcMain, dialog, shell } = require('electron');
const { suggest } = require('./omnibox');
const { registrable, hostOf } = require('./domain');
const { resolveInput } = require('./omnibox');
const { SEARCH_ENGINES, FILTER_LISTS, SETTINGS } = require('./defaults');
const { SCHEMA, CATEGORIES, getDefault } = require('./settings-schema');

const str = (v, max = 2048) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, lo, hi, d = 0) => { const n = Math.floor(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const SCHEMA_KEYS = new Set(SCHEMA.filter((s) => s.key).map((s) => s.key));

function registerIpc(nx) {
  // ======================================================================================================
  // Chrome UI
  // ======================================================================================================
  const UI = {
    state: (w) => w.state(),
    'tab.activate': (w, id) => w.activate(int(id, 0, 1e9)),
    'tab.close': (w, id) => w.closeTab(int(id, 0, 1e9)),
    'tab.new': (w, arg) => w.newTab({ url: 'nevix://newtab', isolated: !!(arg && arg.isolated) }),
    'tab.context': (w, id) => w.tabContextMenu(int(id, 0, 1e9)),
    'tab.move': (w, a) => w.moveTab(int(a.id, 0, 1e9), int(a.index, 0, 1e6)),
    'tab.pin': (w, id) => w.togglePin(int(id, 0, 1e9)),
    'tab.mute': (w, id) => w.muteTab(int(id, 0, 1e9)),
    'tab.select': (w, a) => w.select(int(a.id, 0, 1e9), a.mode),
    'group.toggle': (w, id) => w.groupAction(int(id, 0, 1e9), 'toggle'),
    'group.context': (w, id) => w.groupContextMenu(int(id, 0, 1e9)),
    nav: (w, a) => w.navigate(str(a.text, 4096), { newTab: !!a.newTab }),
    exec: (w, a) => w.exec(str(a.name, 64), a.arg),
    overlay: (w, on) => w.setOverlay(!!on),
    infobar: (w, on) => w.setInfobar(!!on, 'find'),
    find: (w, a) => w.find(str(a.text, 500), a),
    'find.close': (w) => { w.closeFind(); w.setInfobar(false, 'find'); const t = w.active; if (t && t.wc) t.wc.focus(); },
    suggest: (w, q) => suggest(str(q, 500), {
      history: nx.history, bookmarks: nx.bookmarks, settings: nx.settings, windows: nx.windows, commands: nx.commands,
      get spaces() { return nx.spaces; }, win: w, flags: nx.flags,
      tabs: [...nx.windows].flatMap((x) => x.tabs.map((t) => ({ id: t.id, win: x.id, title: t.title, url: t.errorFor || t.url }))).filter((t) => /^https?:/.test(t.url)),
    }),
    'perm.answer': (w, a) => w.answerPermission(a.id, ['always', 'once', 'block', 'dismiss'].includes(a.mode) ? a.mode : 'dismiss'),
    'prompt.answer': (w, a) => w.answerPrompt(str(a.id, 40), a.value === null ? null : str(a.value, 120)),
    'shield.site': (w, a) => {
      const t = w.active; if (!t) return;
      const reg = registrable(hostOf(t.displayUrl)); if (!reg) return;
      nx.privacy.rules.setSite(reg, !!a.off);
      nx.broadcastData('settings');
      if (t.wc) t.wc.reload();
      w.scheduleState();
    },
    'shield.temp': (w, a) => {
      const t = w.active; if (!t) return;
      const reg = registrable(hostOf(t.displayUrl)); if (!reg) return;
      nx.privacy.rules.allowTemporarily(reg, int(a.minutes, 1, 1440, 30));
      if (t.wc) t.wc.reload();
      w.scheduleState();
    },
    'perm.revoke': (w, id) => {
      const t = w.active; if (!t || !/^https?:/.test(t.displayUrl)) return;
      nx.perm.set(new URL(t.displayUrl).origin, str(id, 40), 'default');
      w.scheduleState();
    },
    bookmarks: () => nx.bookmarks.items,
    'bookmark.remove': (w, id) => { nx.bookmarks.remove(str(id, 100)); nx.broadcastData('bookmarks'); },
    'bookmark.move': (w, a) => { nx.bookmarks.move(str(a.id, 100), int(a.index, 0, 1e5)); nx.broadcastData('bookmarks'); },
    downloads: () => nx.dl.list(100),
    'download.action': (w, a) => nx.dl.action(int(a.id, 0, 1e15), str(a.action, 20)),
    stats: () => ({ ...nx.stats.all, listCount: nx.privacy.rules.count }),
    'setting.set': (w, a) => { const k = str(a.key, 80); if (k === 'sidebarCollapsed') { nx.settings.set('general.sidebarCollapsed', !!a.value); nx.settingsChanged('general.sidebarCollapsed'); } },
    'commands.list': () => nx.commands.describe({ forPalette: true }),
    'commands.items': (w, kind) => nx.commands.items(str(kind, 30), w),
    'commands.pick': (w, a) => nx.commands.runPick(str(a.id, 40), a.arg || {}, w),
    quit: () => app.quit(),
  };
  ipcMain.handle('nx:cmd', (e, name, arg) => {
    const w = nx.uiWindows.get(e.sender.id);
    if (!w || typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(UI, name)) return null;
    return UI[name](w, arg || {});
  });

  // ======================================================================================================
  // Page configuration read synchronously by the preload (fingerprint shield, cosmetic filter, autoplay, popups)
  // ======================================================================================================
  ipcMain.on('nevix:page-config', (e, href) => {
    try {
      const tab = nx.byWc.get(e.sender.id);
      const top = (tab && tab.topUrl) || href;
      const p = nx.settings.get('privacy');
      const off = nx.privacy.shieldsOffFor(top);
      const reg = registrable(hostOf(top));
      const seed = parseInt(crypto.createHash('sha256').update(nx.sessionSeed + reg).digest('hex').slice(0, 8), 16);
      let autoplay = 'block', popups = 'block';
      if (/^https?:/.test(top)) {
        const origin = new URL(top).origin;
        autoplay = nx.perm.state(origin, 'autoplay', tab && tab.key);
        popups = nx.perm.state(origin, 'popups', tab && tab.key);
      }
      e.returnValue = {
        fp: p.fingerprint && !off, strictFp: nx.flags.on('nevix-enable-strict-fingerprinting-protection') && !off,
        cosmetic: p.cosmetic && !off, seed, lang: p.spoofLanguage, thirdPartyCookies: p.thirdPartyCookies && !off,
        autoplay, popups,
      };
    } catch { e.returnValue = { fp: false, cosmetic: false, seed: 1, lang: false, thirdPartyCookies: false, autoplay: 'allow', popups: 'allow' }; }
  });

  // A page tried window.open() without a user gesture; offer to allow it for this site.
  const popupAsked = new Map();
  ipcMain.on('nevix:popup-blocked', (e, url) => {
    const tab = nx.byWc.get(e.sender.id);
    if (!tab || !tab.win || !/^https?:/.test(tab.topUrl)) return;
    const now = Date.now();
    if (now - (popupAsked.get(tab.key) || 0) < 8000) return;
    popupAsked.set(tab.key, now);
    const origin = new URL(tab.topUrl).origin;
    if (nx.perm.state(origin, 'popups', tab.key) === 'block' && nx.perm.stored(origin, 'popups') === 'block') return;
    tab.win.askPermission(tab, 'popups', { host: hostOf(origin), origin, label: 'open a pop-up window (blocked)' }).then((a) => {
      if (!a.allow) return;
      if (a.mode === 'once') nx.perm.allowOnce(tab.key, origin, 'popups'); else nx.perm.set(origin, 'popups', 'allow', { persist: !tab.win.isPrivate });
    });
  });

  // ======================================================================================================
  // nevix:// pages
  // ======================================================================================================
  const S = nx.settings;
  const dlg = (w) => (w ? w.win : undefined);

  const flatValues = () => {
    const out = {};
    for (const s of SCHEMA) if (s.key) out[s.key] = s.key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), S.get(''));
    return out;
  };

  const INTERNAL = {
    // ---- settings --------------------------------------------------------------------------------------
    'settings:get': () => ({
      general: S.get('general'), privacy: S.get('privacy'), siteShields: S.get('siteShields'),
      engines: SEARCH_ENGINES, filterLists: FILTER_LISTS, listCount: nx.privacy.rules.count,
    }),
    'settings:schema': () => ({
      categories: CATEGORIES, schema: SCHEMA.map((s) => ({ ...s, default: s.key ? getDefault(s.key) : undefined, flagOn: s.flag ? nx.flags.on(s.flag) : true })),
      values: flatValues(), lists: S.get('privacy.lists'), filterLists: FILTER_LISTS, listCount: nx.privacy.rules.count,
      safeMode: nx.boot.safeMode, portable: nx.boot.portable,
    }),
    'settings:set': (e, a) => {
      const key = str(a.path || a.key, 80);
      if (!SCHEMA_KEYS.has(key) && !/^privacy\.lists$/.test(key)) throw new Error('unknown setting');
      const entry = SCHEMA.find((s) => s.key === key);
      let v = a.value;
      if (entry) {
        if (entry.type === 'toggle') v = !!v;
        else if (entry.type === 'number') v = int(v, entry.min ?? 0, entry.max ?? 1e9, getDefault(key));
        else if (entry.type === 'select') { if (!entry.options.some(([o]) => o === v)) throw new Error('bad option'); }
        else if (entry.type === 'color') { v = str(v, 7); if (v && !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('bad colour'); }
        else v = str(v, 1024);
      }
      S.set(key, v);
      if (key === 'general.spellcheck') for (const ses of nx.allSessions()) nx.privacy.applySpellcheck(ses);
      nx.settingsChanged(key);
      return true;
    },
    'settings:reset': (e, a) => {
      const key = str(a.key, 80);
      if (!SCHEMA_KEYS.has(key)) throw new Error('unknown setting');
      S.set(key, getDefault(key));
      nx.settingsChanged(key);
      return true;
    },
    'settings:resetAll': () => {
      for (const k of SCHEMA_KEYS) S.set(k, getDefault(k));
      S.set('shortcuts', {});
      nx.commands.rebuild();
      nx.settingsChanged('');
      return true;
    },
    'action:run': async (e, a, w) => {
      switch (str(a.action, 40)) {
        case 'default-browser':
          if (process.platform === 'win32') { await shell.openExternal('ms-settings:defaultapps'); return 'opened'; }
          app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https');
          return app.isDefaultProtocolClient('https') ? 'set' : 'failed';
        case 'open-profile': shell.showItemInFolder(path.join(nx.userData, 'settings.json')); return true;
        default: throw new Error('unknown action');
      }
    },
    'download:dir': async (e, a, w) => {
      const r = await dialog.showOpenDialog(dlg(w), { properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      S.set('general.downloadDir', r.filePaths[0]); nx.broadcastData('settings');
      return r.filePaths[0];
    },
    'siteShields:remove': (e, a) => { nx.privacy.rules.setSite(str(a, 255), false); nx.broadcastData('settings'); return true; },
    resolve: (e, a) => resolveInput(str(a, 4096), S),
    'open:tab': (e, a, w) => { if (w) w.newTab({ url: resolveInput(str(a, 4096), S) }); return true; },

    // ---- shortcuts -------------------------------------------------------------------------------------
    'shortcuts:list': () => nx.commands.describe(),
    'shortcuts:set': (e, a) => nx.commands.setShortcuts(str(a.id, 40), (Array.isArray(a.accels) ? a.accels : []).slice(0, 3).map((x) => str(x, 40))),
    'shortcuts:reset': (e, a) => { nx.commands.resetShortcut(str(a.id, 40)); return true; },
    'shortcuts:resetAll': () => { nx.commands.resetAllShortcuts(); return true; },

    // ---- flags -----------------------------------------------------------------------------------------
    'flags:list': () => ({
      flags: nx.flags.list(), safeMode: nx.boot.safeMode, notice: nx.boot.notice,
      restartPending: nx.flags.list().some((f) => f.restartPending),
    }),
    'flags:set': (e, a) => { nx.flags.set(str(a.id, 80), str(a.state, 12)); nx.settingsChanged(''); nx.lazyModules.life && nx.life.touch(); return true; },
    'flags:reset': (e, a) => { nx.flags.reset(str(a.id, 80)); nx.settingsChanged(''); return true; },
    'flags:resetAll': () => { nx.flags.resetAll(); nx.settingsChanged(''); return true; },
    'flags:restart': (e, a) => { app.relaunch(a && a.safe ? { args: process.argv.slice(1).concat('--safe-mode') } : undefined); app.quit(); return true; },

    // ---- history / bookmarks ---------------------------------------------------------------------------
    'history:list': (e, a) => nx.history.search(str(a && a.q, 200), 500),
    'history:remove': (e, a) => { nx.history.remove(str(a, 2048)); nx.broadcastData('history'); return true; },
    'history:clear': (e, a) => { nx.history.clear(a ? int(a, 1, 1e6) * 3600e3 : 0); nx.broadcastData('history'); return true; },
    'bookmarks:list': () => nx.bookmarks.items,
    'bookmarks:remove': (e, a) => { nx.bookmarks.remove(str(a, 100)); nx.broadcastData('bookmarks'); return true; },
    'bookmarks:rename': (e, a) => { nx.bookmarks.rename(str(a.id, 100), str(a.title, 300)); nx.broadcastData('bookmarks'); return true; },
    'bookmarks:import': async (e, a, w) => {
      const r = await dialog.showOpenDialog(dlg(w), { properties: ['openFile'], filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }] });
      if (r.canceled || !r.filePaths[0]) return 0;
      const n = nx.bookmarks.importHtml(fs.readFileSync(r.filePaths[0], 'utf8'));
      nx.broadcastData('bookmarks');
      return n;
    },
    'bookmarks:export': async (e, a, w) => {
      const r = await dialog.showSaveDialog(dlg(w), { defaultPath: path.join(app.getPath('documents'), 'nevix-bookmarks.html'), filters: [{ name: 'HTML', extensions: ['html'] }] });
      if (r.canceled || !r.filePath) return false;
      fs.writeFileSync(r.filePath, nx.bookmarks.exportHtml());
      return true;
    },
    'stats:get': () => ({ ...nx.stats.all, listCount: nx.privacy.rules.count }),
    topsites: () => nx.history.top(8).map((h) => ({ url: h.url, title: h.title })),
    'data:clear': async (e, a) => { await nx.clearData({ history: !!a.history, cookies: !!a.cookies, cache: !!a.cache, downloads: !!a.downloads, range: int(a.range, 0, 1e6) }); return true; },
    'lists:update': () => nx.updateLists(),

    // ---- downloads -------------------------------------------------------------------------------------
    'downloads:list': () => nx.dl.list(),
    'downloads:action': (e, a) => nx.dl.action(int(a.id, 0, 1e15), str(a.action, 20)),
    'downloads:summary': () => nx.dl.summary(),

    // ---- permissions -----------------------------------------------------------------------------------
    'perm:list': () => nx.perm.list(),
    'perm:set': (e, a) => { nx.perm.set(str(a.origin, 300), str(a.perm, 30), str(a.state, 10)); return true; },
    'perm:setDefault': (e, a) => { nx.perm.setDefault(str(a.perm, 30), str(a.state, 10)); return true; },
    'perm:reset': (e, a) => { nx.perm.reset(str(a.origin, 300)); return true; },
    'perm:resetSite': async (e, a) => { await nx.perm.resetSite(str(a.origin, 300)); return true; },

    // ---- privacy dashboard & network -------------------------------------------------------------------
    'privacy:summary': () => ({ sites: nx.plog.summary(), totals: nx.stats.all, temp: nx.privacy.rules.tempList(), shieldsOff: nx.privacy.rules.siteList() }),
    'privacy:detail': (e, a) => nx.plog.detail(str(a.site, 255)),
    'privacy:clear': (e, a) => { nx.plog.clear(a && a.site ? str(a.site, 255) : null); return true; },
    'privacy:shields': (e, a) => { nx.privacy.rules.setSite(str(a.site, 255), !!a.off); nx.broadcastData('settings'); return true; },
    'privacy:allowTemp': (e, a) => { nx.privacy.rules.allowTemporarily(str(a.site, 255), int(a.minutes, 1, 1440, 30)); return true; },
    'privacy:rule': (e, a) => {
      const line = str(a.line, 400).trim();
      if (!line || /[\r\n]/.test(line)) throw new Error('bad rule');
      nx.privacy.rules.appendCustom(line);
      nx.broadcastData('network');
      return true;
    },
    'network:overview': () => ({
      lists: nx.privacy.rules.lists(), total: nx.privacy.rules.count, filterLists: FILTER_LISTS, enabled: S.get('privacy.lists'),
      doh: S.get('privacy.doh'), dohServer: S.get('privacy.dohServer'), proxy: S.get('privacy.proxy'), httpsOnly: S.get('privacy.httpsOnly'),
      http3Forced: nx.flags.on('nevix-enable-experimental-http3'), strict: nx.flags.on('nevix-enable-strict-tracker-blocking'),
      shieldsOff: nx.privacy.rules.siteList(), temp: nx.privacy.rules.tempList(),
    }),
    'network:customGet': () => nx.privacy.rules.customText(),
    'network:customSet': (e, a) => nx.privacy.rules.setCustomText(str(a.text, 2e6)),
    'network:customExport': async (e, a, w) => {
      const r = await dialog.showSaveDialog(dlg(w), { defaultPath: path.join(app.getPath('documents'), 'nevix-rules.txt'), filters: [{ name: 'Text', extensions: ['txt'] }] });
      if (r.canceled || !r.filePath) return false;
      fs.writeFileSync(r.filePath, nx.privacy.rules.customText());
      return true;
    },
    'network:customImport': async (e, a, w) => {
      const r = await dialog.showOpenDialog(dlg(w), { properties: ['openFile'], filters: [{ name: 'Rule files', extensions: ['txt', 'list', 'rules'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const text = fs.readFileSync(r.filePaths[0], 'utf8').slice(0, 2e6);
      const prev = nx.privacy.rules.customText();
      nx.privacy.rules.setCustomText(prev ? prev.replace(/\n*$/, '\n') + text : text);
      return nx.privacy.rules.custom.count;
    },
    /** Rule tester: what would Nevix do with this request? */
    'network:test': (e, a) => {
      let u; try { u = new URL(str(a.url, 4096)); } catch { return { error: 'Not a valid URL' }; }
      const top = hostOf(str(a.top, 255)) || str(a.top, 255);
      const d = nx.privacy.rules.check({ url: u.toString(), host: u.hostname, path: u.pathname + u.search, topHost: top, type: str(a.type, 20) || 'script' });
      return d || { action: 'none', note: 'No rule matches — the request would be allowed.' };
    },

    // ---- performance -----------------------------------------------------------------------------------
    'perf:snapshot': () => nx.perf.snapshot(),
    'perf:startup': () => nx.perf.startup(),
    'perf:tabAction': async (e, a) => nx.perf.tabAction(int(a.win, 0, 1e9), int(a.tab, 0, 1e9), str(a.action, 20)),
    'perf:bench': (e, a) => nx.perf.bench.run(a || {}, (p) => { try { e.sender.send('nevix:bench-progress', p); } catch {} }),
    'perf:benchHistory': () => nx.perf.bench.history(),
    'perf:benchClear': () => nx.perf.bench.clear(),
    'perf:benchExport': async (e, a, w) => nx.perf.bench.export(dlg(w)),

    // ---- workspaces / snapshots / saved groups ---------------------------------------------------------
    'ws:list': () => nx.spaces.listWorkspaces(),
    'ws:save': (e, a, w) => nx.spaces.saveWorkspace(w || nx.lastWindow, str(a.name, 80)),
    'ws:restore': (e, a, w) => nx.spaces.restoreWorkspace(str(a.id, 40), w || nx.lastWindow, str(a.mode, 10)),
    'ws:delete': (e, a) => nx.spaces.deleteWorkspace(str(a.id, 40)),
    'ws:rename': (e, a) => nx.spaces.renameWorkspace(str(a.id, 40), str(a.name, 80)),
    'snap:list': () => nx.spaces.listSnapshots(),
    'snap:save': (e, a) => nx.spaces.saveSnapshot(str(a.name, 80)),
    'snap:restore': (e, a) => nx.spaces.restoreSnapshot(str(a.id, 40)),
    'snap:delete': (e, a) => nx.spaces.deleteSnapshot(str(a.id, 40)),
    'snap:rename': (e, a) => nx.spaces.renameSnapshot(str(a.id, 40), str(a.name, 80)),
    'group:list': () => nx.spaces.listSavedGroups(),
    'group:open': (e, a, w) => nx.spaces.openSavedGroup(str(a.id, 40), w || nx.lastWindow),
    'group:delete': (e, a) => nx.spaces.deleteSavedGroup(str(a.id, 40)),

    // ---- extensions ------------------------------------------------------------------------------------
    'ext:list': () => nx.ext.list(),
    'ext:install': (e, a, w) => nx.ext.installFromDialog(dlg(w)),
    'ext:remove': (e, a) => nx.ext.remove(str(a.id, 64)),
    'ext:toggle': (e, a) => nx.ext.setEnabled(str(a.id, 64), !!a.enabled),
    'ext:sites': (e, a) => nx.ext.setBlockedSites(str(a.id, 64), (Array.isArray(a.sites) ? a.sites : []).slice(0, 200).map((x) => str(x, 255))),

    // ---- diagnostics -----------------------------------------------------------------------------------
    'diag:tabs': () => nx.diag.tabs(),
    'diag:start': (e, a) => nx.diag.start(int(a.win, 0, 1e9), int(a.tab, 0, 1e9), e.sender),
    'diag:stop': () => nx.diag.stop(),
    'diag:entries': () => nx.diag.entries(),
    'diag:clear': () => nx.diag.clear(),

    // ---- network monitor (only while a nevix://network page is subscribed) ---------------------------
    'net:subscribe': (e) => { nx.netMonitor(e.sender, true); return true; },
    'net:unsubscribe': (e) => { nx.netMonitor(e.sender, false); return true; },

    // ---- portability -----------------------------------------------------------------------------------
    'backup:export': (e, a, w) => nx.io.exportBackup(dlg(w), str(a.passphrase, 256), a.include || {}),
    'backup:import': (e, a, w) => nx.io.importBackup(dlg(w), str(a.passphrase, 256)),
    'import:scan': () => nx.io.scanBrowsers(),
    'import:run': (e, a) => nx.io.importFrom(str(a.browser, 40), str(a.profile, 120), a.what || {}),

    // ---- about / recovery / errors / auth --------------------------------------------------------------
    'app:info': () => nx.aboutInfo(),
    'newtab:dismissImport': () => { S.set('general.importDismissed', true); try { fs.unlinkSync(path.join(nx.userData, 'first-run-import')); } catch {} return true; },
    'recovery:info': () => nx.recoveryInfo(),
    'recovery:restore': () => { nx.restoreSession(); return true; },
    'recovery:fresh': () => { nx.startFresh(); return true; },
    'error:proceed': (e, a, w, tab) => {
      if (!tab || !tab.win) return false;
      if (a.kind === 'https') {
        const h = hostOf(str(a.http, 2048));
        if (h) nx.privacy.httpAllowed.add(h);
        tab.load(str(a.http, 2048));
      } else if (a.kind === 'cert') {
        try { nx.privacy.certAllowed.add(new URL(str(a.url, 2048)).host); } catch {}
        tab.load(str(a.url, 2048));
      }
      return true;
    },
    'error:retry': (e, a, w, tab) => { if (tab) tab.load(str(a, 2048)); return true; },
    'error:back': (e, a, w, tab) => { if (tab && tab.wc && tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack(); else if (tab) tab.load('nevix://newtab'); return true; },
    'auth:submit': (e, a) => {
      const p = nx.authPending.get(str(a.id, 40));
      if (!p) return false;
      p.done = true;
      if (a.cancel) p.cb(); else p.cb(str(a.user, 256), str(a.pass, 256));
      nx.authPending.delete(a.id);
      p.win.close();
      return true;
    },
  };

  // Test hook (only with NEVIX_E2E=1): call page commands / UI commands without a page.
  if (process.env.NEVIX_E2E === '1') {
    nx.ipcInternal = (cmd, arg, win) => INTERNAL[cmd]({ sender: { send() {}, isDestroyed: () => false, once() {} } }, arg || {}, win || nx.lastWindow, undefined);
    nx.ipcUi = (name, arg, win) => UI[name](win || nx.lastWindow, arg || {});
  }

  ipcMain.handle('nevix:internal', async (e, cmd, arg) => {
    const frame = e.senderFrame;
    if (!frame || frame !== e.sender.mainFrame || !/^nevix:\/\//.test(frame.url)) throw new Error('forbidden');
    if (typeof cmd !== 'string' || !Object.prototype.hasOwnProperty.call(INTERNAL, cmd)) throw new Error('unknown command');
    const tab = nx.byWc.get(e.sender.id);
    const w = tab && tab.win ? tab.win : nx.lastWindow;
    return INTERNAL[cmd](e, arg || {}, w, tab);
  });
}

module.exports = { registerIpc };
