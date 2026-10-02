'use strict';
// Extension manager (nevix://extensions).
//
// Extensions are loaded with Electron's extension support (content scripts, background/service workers and the
// subset of chrome.* APIs Electron implements). Unpacked extension folders are COPIED into the profile, so the
// original can change or disappear without surprises, and per-site restrictions are applied to the copy's manifest
// (content-script `exclude_matches`). Extensions run only in normal windows, never in private windows.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, session, webContents } = require('electron');
const { Store } = require('./store');

const PERM_INFO = {
  storage: ['Store data on this device', 'low'], unlimitedStorage: ['Store unlimited data', 'low'], alarms: ['Schedule background tasks', 'low'],
  activeTab: ['Access the tab you are using, only when you click it', 'low'], contextMenus: ['Add items to context menus', 'low'], notifications: ['Show notifications', 'low'],
  tabs: ['See the URL, title and icon of all your tabs', 'medium'], scripting: ['Run code in web pages', 'medium'], declarativeNetRequest: ['Block or change network requests', 'medium'],
  declarativeNetRequestWithHostAccess: ['Block or change network requests on allowed sites', 'medium'], webNavigation: ['See which pages you navigate to', 'medium'],
  history: ['Read and change your browsing history', 'high'], bookmarks: ['Read and change your bookmarks', 'high'], cookies: ['Read and change cookies on allowed sites', 'high'],
  webRequest: ['Observe network requests', 'high'], webRequestBlocking: ['Observe and modify network requests', 'high'], clipboardRead: ['Read your clipboard', 'high'],
  clipboardWrite: ['Write to your clipboard', 'low'], downloads: ['Manage your downloads', 'medium'], management: ['Manage other extensions', 'high'], proxy: ['Control your proxy settings', 'high'],
  privacy: ['Change privacy settings', 'high'], geolocation: ['Know your location', 'high'], nativeMessaging: ['Talk to programs on your computer', 'high'], debugger: ['Debug pages (full access to page content)', 'high'],
  topSites: ['See your most visited sites', 'medium'], identity: ['Sign in with accounts', 'medium'], offscreen: ['Create hidden pages', 'low'], sidePanel: ['Show a side panel', 'low'],
};

const ALL_HOSTS = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|\*:\/\/\*\.\*\/\*)$/;

function describe(manifest) {
  const perms = [];
  for (const p of manifest.permissions || []) {
    const info = PERM_INFO[p];
    perms.push({ id: p, text: info ? info[0] : `Use the “${p}” capability`, risk: info ? info[1] : 'medium' });
  }
  const hosts = [...(manifest.host_permissions || []), ...((manifest.permissions || []).filter((p) => /^(https?|\*|file|ftp):|^<all_urls>$/.test(p)))];
  const csMatches = (manifest.content_scripts || []).flatMap((c) => c.matches || []);
  const all = [...new Set([...hosts, ...csMatches])];
  const broad = all.some((h) => ALL_HOSTS.test(h));
  return {
    permissions: perms.filter((p) => !/^(https?|\*|file|ftp):|^<all_urls>$/.test(p.id)),
    hosts: all, broadAccess: broad,
    risk: broad || perms.some((p) => p.risk === 'high') ? 'high' : perms.some((p) => p.risk === 'medium') || all.length ? 'medium' : 'low',
  };
}

/** `example.com` → match patterns covering the site and its subdomains. */
const patternsFor = (site) => [`*://${site}/*`, `*://*.${site}/*`];

class Extensions {
  constructor(a) {
    this.app = a;
    this.dir = path.join(a.userData, 'extensions');
    this.store = new Store(path.join(a.userData, 'extensions.json'), { items: [] });
    this.loaded = new Map();       // record id -> electron extension id
    this.ready = false;
  }

  get ses() { return session.fromPartition('persist:nevix'); }
  get api() { const s = this.ses; return s.extensions || s; }
  flush() { this.store.flush(); }

  records() { return this.store.get('items'); }
  save(items) { this.store.set('items', items); this.app.broadcastData('extensions'); }

  /** Load every enabled extension into the normal profile. Safe to call repeatedly. */
  async init() {
    if (this.ready || !this.app.settings.get('extensions.enabled')) return;
    this.ready = true;
    for (const r of this.records()) if (r.enabled) await this.load(r).catch(() => {});
  }

  /** Called for sessions created after init (only the normal profile gets extensions). */
  attach(ses) { if (ses === this.ses) this.init(); }

  async load(r) {
    const ses = this.ses;
    const api = ses.extensions || ses;
    try {
      const ext = await api.loadExtension(r.dir, { allowFileAccess: false });
      this.loaded.set(r.id, ext.id);
      return ext;
    } catch (e) { r.error = String(e.message || e).slice(0, 200); throw e; }
  }

  async unload(r) {
    const eid = this.loaded.get(r.id);
    if (!eid) return;
    try { const api = this.ses.extensions || this.ses; await api.removeExtension(eid); } catch {}
    this.loaded.delete(r.id);
  }

  // ---- install / remove -----------------------------------------------------------------------------------
  async installFromDialog(parent) {
    const r = await dialog.showOpenDialog(parent, { title: 'Choose an unpacked extension folder (containing manifest.json)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    return this.installFromPath(r.filePaths[0]);
  }

  async installFromPath(src) {
    if (!this.app.settings.get('extensions.enabled')) return { error: 'Extensions are turned off in settings.' };
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')); } catch { return { error: 'That folder has no valid manifest.json.' }; }
    if (!manifest.name || !manifest.manifest_version) return { error: 'manifest.json is missing name or manifest_version.' };
    if (![2, 3].includes(manifest.manifest_version)) return { error: 'Unsupported manifest_version.' };
    this.ready = true;
    const id = crypto.createHash('sha1').update(path.resolve(src) + Date.now()).digest('hex').slice(0, 12);
    const dir = path.join(this.dir, id);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.cpSync(src, dir, { recursive: true, filter: (p) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p) });
    const rec = { id, dir, origin: path.resolve(src), name: String(manifest.name).slice(0, 80), version: String(manifest.version || ''), enabled: true, blocked: [], installedAt: Date.now() };
    this.applyRestrictions(rec);
    try { await this.load(rec); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); return { error: 'Could not load the extension: ' + (e.message || e) }; }
    this.save([...this.records(), rec]);
    return { ok: true, id };
  }

  async remove(id) {
    const items = this.records();
    const r = items.find((x) => x.id === id);
    if (!r) return false;
    await this.unload(r);
    try { fs.rmSync(r.dir, { recursive: true, force: true }); } catch {}
    this.save(items.filter((x) => x.id !== id));
    return true;
  }

  async setEnabled(id, enabled) {
    const items = this.records().map((x) => ({ ...x }));
    const r = items.find((x) => x.id === id);
    if (!r) return false;
    r.enabled = !!enabled;
    if (enabled) { this.ready = true; await this.load(r).catch(() => {}); } else await this.unload(r);
    this.save(items);
    return true;
  }

  /** Per-site restriction: content scripts of this extension will not run on these sites (applies after reload). */
  async setBlockedSites(id, sites) {
    const clean = [...new Set(sites.map((s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '').trim()).filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/.test(s)))];
    const items = this.records().map((x) => ({ ...x }));
    const r = items.find((x) => x.id === id);
    if (!r) return false;
    r.blocked = clean;
    this.applyRestrictions(r);
    if (r.enabled && this.loaded.has(r.id)) { await this.unload(r); await this.load(r).catch(() => {}); }
    this.save(items);
    return true;
  }

  /** Rewrite the copy's manifest from the pristine copy, adding exclude_matches for blocked sites. */
  applyRestrictions(r) {
    const mf = path.join(r.dir, 'manifest.json');
    const pristine = path.join(r.dir, '.manifest.original.json');
    if (!fs.existsSync(pristine)) fs.copyFileSync(mf, pristine);
    const m = JSON.parse(fs.readFileSync(pristine, 'utf8'));
    if (r.blocked && r.blocked.length) {
      const ex = r.blocked.flatMap(patternsFor);
      for (const cs of m.content_scripts || []) cs.exclude_matches = [...new Set([...(cs.exclude_matches || []), ...ex])];
    }
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  }

  // ---- information ----------------------------------------------------------------------------------------
  list() {
    return this.records().map((r) => {
      let manifest = {};
      try { manifest = JSON.parse(fs.readFileSync(path.join(r.dir, '.manifest.original.json'), 'utf8')); } catch { try { manifest = JSON.parse(fs.readFileSync(path.join(r.dir, 'manifest.json'), 'utf8')); } catch {} }
      return {
        id: r.id, name: r.name, version: r.version, enabled: r.enabled, loaded: this.loaded.has(r.id), blocked: r.blocked || [], error: r.error || '',
        description: String(manifest.description || '').slice(0, 300), manifestVersion: manifest.manifest_version, installedAt: r.installedAt, origin: r.origin,
        ...describe(manifest),
      };
    });
  }

  /** Resource overhead: extension background pages' processes and their memory. */
  overhead() {
    const ids = new Set([...this.loaded.values()]);
    const pids = new Set();
    for (const wc of webContents.getAllWebContents()) {
      try { const u = wc.getURL(); if ([...ids].some((i) => u.startsWith(`chrome-extension://${i}/`))) pids.add(wc.getOSProcessId()); } catch {}
    }
    const metrics = app.getAppMetrics().filter((m) => pids.has(m.pid));
    return { count: this.loaded.size, pids: [...pids], memory: metrics.reduce((n, m) => n + (m.memory ? m.memory.workingSetSize * 1024 : 0), 0) };
  }
}

module.exports = { Extensions, describe };
