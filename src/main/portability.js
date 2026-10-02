'use strict';
// Moving data in and out, entirely locally:
//   • encrypted backup files (AES-256-GCM, key from the passphrase via scrypt) — the "sync" story: no account, no server
//   • importing bookmarks/history from other browsers installed on this computer
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');
const { Store } = require('./store');
const { SCHEMA } = require('./settings-schema');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const MAGIC = 'nevix-backup';

function deriveKey(pass, salt) { return crypto.scryptSync(pass, salt, 32, SCRYPT); }

function encrypt(obj, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey(pass, salt), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ format: MAGIC, v: 1, kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, cipher: 'aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(text, pass) {
  let f;
  try { f = JSON.parse(text); } catch { throw new Error('This is not a Nevix backup file.'); }
  if (!f || f.format !== MAGIC || f.v !== 1) throw new Error('This is not a Nevix backup file.');
  try {
    const salt = Buffer.from(f.salt, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32, { N: +f.N || SCRYPT.N, r: +f.r || 8, p: +f.p || 1, maxmem: SCRYPT.maxmem }), Buffer.from(f.iv, 'base64'));
    d.setAuthTag(Buffer.from(f.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
}

const WEBKIT_EPOCH_US = 11644473600e6;
const flatten = (node, out) => {
  if (!node) return;
  if (node.type === 'url' && /^https?:/.test(node.url || '')) out.push({ url: node.url, title: node.name || node.url });
  for (const c of node.children || []) flatten(c, out);
};

class Portability {
  constructor(a) { this.app = a; }

  // ---- encrypted backup -----------------------------------------------------------------------------------
  collect(include) {
    const a = this.app, out = { created: Date.now(), version: app.getVersion() };
    if (include.settings !== false) {
      const settings = {};
      for (const s of SCHEMA) if (s.key) settings[s.key] = s.key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), a.settings.get(''));
      out.settings = settings; out.shortcuts = a.settings.get('shortcuts'); out.siteShields = a.settings.get('siteShields'); out.siteZoom = a.settings.get('siteZoom');
    }
    if (include.bookmarks !== false) out.bookmarks = a.bookmarks.items;
    if (include.workspaces !== false) { const w = a.spaces.store.data; out.workspaces = w.workspaces; out.snapshots = w.snapshots; out.groups = w.groups; }
    if (include.permissions !== false) out.permissions = a.perm.store.data;
    if (include.rules !== false) out.rules = a.privacy.rules.customText();
    if (include.history === true) out.history = a.history.items.slice(0, 20000);
    return out;
  }

  async exportBackup(parent, passphrase, include) {
    if (String(passphrase).length < 8) throw new Error('Choose a passphrase of at least 8 characters.');
    const r = await dialog.showSaveDialog(parent, { defaultPath: path.join(app.getPath('documents'), `nevix-backup-${new Date().toISOString().slice(0, 10)}.nevixbackup`), filters: [{ name: 'Nevix backup', extensions: ['nevixbackup'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, encrypt(this.collect(include), passphrase));
    return { ok: true, file: r.filePath };
  }

  async importBackup(parent, passphrase) {
    const r = await dialog.showOpenDialog(parent, { properties: ['openFile'], filters: [{ name: 'Nevix backup', extensions: ['nevixbackup'] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const stat = fs.statSync(r.filePaths[0]);
    if (stat.size > 200 * 1024 * 1024) throw new Error('That file is too large to be a Nevix backup.');
    return this.apply(decrypt(fs.readFileSync(r.filePaths[0], 'utf8'), passphrase));
  }

  /** Merge decrypted data into this profile. Unknown keys are ignored; settings are validated against the schema. */
  apply(d) {
    const a = this.app, counts = {};
    if (d.settings && typeof d.settings === 'object') {
      let n = 0;
      for (const s of SCHEMA) if (s.key && s.key in d.settings) { const v = d.settings[s.key]; if (typeof v === typeof s.default || s.default === undefined || (s.type === 'select' || s.type === 'text')) { a.settings.set(s.key, v); n++; } }
      if (d.shortcuts && typeof d.shortcuts === 'object') a.settings.set('shortcuts', d.shortcuts);
      if (d.siteShields && typeof d.siteShields === 'object') { a.settings.set('siteShields', d.siteShields); a.privacy.rules.loadSites(); }
      if (d.siteZoom && typeof d.siteZoom === 'object') a.settings.set('siteZoom', d.siteZoom);
      counts.settings = n; a.commands.rebuild(); a.settingsChanged('');
    }
    if (Array.isArray(d.bookmarks)) { let n = 0; for (const b of d.bookmarks) if (b && /^https?:/.test(b.url) && !a.bookmarks.has(b.url)) { a.bookmarks.add(b.url, String(b.title || b.url).slice(0, 300)); n++; } counts.bookmarks = n; a.broadcastData('bookmarks'); }
    if (Array.isArray(d.workspaces) || Array.isArray(d.snapshots) || Array.isArray(d.groups)) {
      const st = a.spaces.store;
      const merge = (key, inc) => { const have = new Set(st.get(key).map((x) => x.id)); const add = (inc || []).filter((x) => x && x.id && !have.has(x.id)); st.set(key, [...st.get(key), ...add]); return add.length; };
      counts.workspaces = merge('workspaces', d.workspaces); counts.snapshots = merge('snapshots', d.snapshots); counts.groups = merge('groups', d.groups);
    }
    if (d.permissions && d.permissions.sites && typeof d.permissions.sites === 'object') {
      const sites = { ...a.perm.store.get('sites') };
      for (const [o, p] of Object.entries(d.permissions.sites)) if (typeof o === 'string' && p && typeof p === 'object') sites[o] = { ...(sites[o] || {}), ...p };
      a.perm.store.set('sites', sites); counts.permissions = Object.keys(d.permissions.sites).length;
    }
    if (typeof d.rules === 'string' && d.rules.trim()) { const cur = a.privacy.rules.customText(); a.privacy.rules.setCustomText((cur ? cur.replace(/\n*$/, '\n') : '') + d.rules); counts.rules = d.rules.split('\n').length; }
    if (Array.isArray(d.history)) { let n = 0; for (const it of d.history) if (it && /^https?:/.test(it.url) && !a.history.index.has(it.url)) { a.history.items.push({ url: it.url, title: String(it.title || '').slice(0, 300), visits: +it.visits || 1, first: +it.first || Date.now(), last: +it.last || Date.now() }); a.history.index.set(it.url, a.history.items[a.history.items.length - 1]); n++; } a.history.store.save(); counts.history = n; }
    a.broadcastData('workspaces'); a.broadcastData('settings');
    return { ok: true, counts };
  }

  // ---- importing from other browsers ----------------------------------------------------------------------
  roots() {
    const h = os.homedir();
    const L = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
    const R = process.env.APPDATA || path.join(h, 'AppData', 'Roaming');
    const M = path.join(h, 'Library', 'Application Support');
    const C = path.join(h, '.config');
    const sets = {
      win32: { chrome: [path.join(L, 'Google', 'Chrome', 'User Data')], edge: [path.join(L, 'Microsoft', 'Edge', 'User Data')], brave: [path.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data')], vivaldi: [path.join(L, 'Vivaldi', 'User Data')], opera: [path.join(R, 'Opera Software', 'Opera Stable')], firefox: [path.join(R, 'Mozilla', 'Firefox', 'Profiles')] },
      darwin: { chrome: [path.join(M, 'Google', 'Chrome')], edge: [path.join(M, 'Microsoft Edge')], brave: [path.join(M, 'BraveSoftware', 'Brave-Browser')], vivaldi: [path.join(M, 'Vivaldi')], opera: [path.join(M, 'com.operasoftware.Opera')], firefox: [path.join(M, 'Firefox', 'Profiles')] },
      linux: { chrome: [path.join(C, 'google-chrome'), path.join(C, 'chromium')], edge: [path.join(C, 'microsoft-edge')], brave: [path.join(C, 'BraveSoftware', 'Brave-Browser')], vivaldi: [path.join(C, 'vivaldi')], opera: [path.join(C, 'opera')], firefox: [path.join(h, '.mozilla', 'firefox')] },
    };
    return sets[process.platform] || sets.linux;
  }

  scanBrowsers() {
    const names = { chrome: 'Google Chrome / Chromium', edge: 'Microsoft Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera', firefox: 'Mozilla Firefox' };
    const found = [];
    for (const [id, roots] of Object.entries(this.roots())) {
      const profiles = [];
      for (const root of roots) {
        let entries = [];
        try { entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
        if (id === 'opera') entries = ['.'];
        for (const dir of entries) {
          const full = path.join(root, dir);
          const isFx = id === 'firefox';
          const bm = isFx ? path.join(full, 'places.sqlite') : path.join(full, 'Bookmarks');
          if (!fs.existsSync(bm)) continue;
          profiles.push({ dir: full, label: dir === '.' ? 'Default' : dir.replace(/^[a-z0-9]{8}\./i, ''), history: fs.existsSync(isFx ? bm : path.join(full, 'History')) });
        }
      }
      if (profiles.length) found.push({ id, name: names[id], profiles });
    }
    return found;
  }

  /** @param what {bookmarks:boolean, history:boolean} */
  importFrom(browser, profileDir, what) {
    const known = this.scanBrowsers().find((b) => b.id === browser);
    const prof = known && known.profiles.find((p) => p.dir === profileDir);
    if (!prof) throw new Error('That profile was not found.');   // never read arbitrary paths from page input
    const out = { bookmarks: 0, history: 0 };
    const a = this.app;
    if (browser === 'firefox') {
      const rows = this.sqlite(path.join(prof.dir, 'places.sqlite'), what.history
        ? 'SELECT url, title, visit_count AS v, last_visit_date AS t FROM moz_places WHERE url LIKE \'http%\' ORDER BY last_visit_date DESC LIMIT 20000'
        : null, 'SELECT p.url AS url, b.title AS title FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 AND p.url LIKE \'http%\'');
      for (const r of rows.bookmarks) if (!a.bookmarks.has(r.url)) { a.bookmarks.add(r.url, r.title || r.url); out.bookmarks++; }
      for (const r of rows.history || []) out.history += this.addHistory(r.url, r.title, r.v, r.t ? r.t / 1000 : Date.now());
    } else {
      if (what.bookmarks !== false) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(prof.dir, 'Bookmarks'), 'utf8'));
          const list = [];
          for (const r of Object.values(j.roots || {})) flatten(r, list);
          for (const b of list) if (!a.bookmarks.has(b.url)) { a.bookmarks.add(b.url, b.title); out.bookmarks++; }
        } catch {}
      }
      if (what.history && fs.existsSync(path.join(prof.dir, 'History'))) {
        const rows = this.sqlite(path.join(prof.dir, 'History'), 'SELECT url, title, visit_count AS v, last_visit_time AS t FROM urls WHERE url LIKE \'http%\' ORDER BY last_visit_time DESC LIMIT 20000');
        for (const r of rows.history || []) out.history += this.addHistory(r.url, r.title, r.v, (r.t - WEBKIT_EPOCH_US) / 1000 || Date.now());
      }
    }
    a.bookmarks.store.save(); a.history.store.save();
    a.broadcastData('bookmarks'); a.broadcastData('history');
    return out;
  }

  addHistory(url, title, visits, lastMs) {
    const h = this.app.history;
    if (!/^https?:/.test(url) || h.index.has(url)) return 0;
    const it = { url, title: String(title || '').slice(0, 300), visits: Math.max(1, +visits || 1), first: lastMs, last: lastMs };
    h.items.push(it); h.index.set(url, it);
    return 1;
  }

  /** Read-only query against a COPY of a (possibly locked) SQLite database. */
  sqlite(file, historySql, bookmarkSql) {
    const tmp = path.join(os.tmpdir(), `nevix-import-${process.pid}-${Date.now()}.sqlite`);
    fs.copyFileSync(file, tmp);
    for (const ext of ['-wal', '-shm']) { try { fs.copyFileSync(file + ext, tmp + ext); } catch {} }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(tmp, { readOnly: true });
    try {
      const res = {};
      if (bookmarkSql) res.bookmarks = db.prepare(bookmarkSql).all();
      if (historySql) res.history = db.prepare(historySql).all();
      return res;
    } finally {
      db.close();
      for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + ext); } catch {} }
    }
  }
}

module.exports = { Portability, encrypt, decrypt };
