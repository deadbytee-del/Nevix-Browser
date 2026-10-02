'use strict';
// Download manager: queue, pause/resume/retry, speed + ETA, source domain, history, safe-file warnings.
// Nothing is ever uploaded or scanned by an external service.
const path = require('path');
const fs = require('fs');
const { app, shell, dialog } = require('electron');
const { Store } = require('./store');
const { hostOf } = require('./domain');

// Files that can run code when opened. "danger" asks for explicit confirmation before Open.
const EXEC_EXT = new Set(('exe msi msix msixbundle appx appxbundle bat cmd com scr pif ps1 psm1 vbs vbe js jse wsf wsh hta jar cpl reg lnk inf dll sys ' +
  'apk dmg pkg app command sh bash run bin deb rpm appimage chm gadget msc').split(' '));
const CAUTION_EXT = new Set('zip rar 7z iso img vhd cab gz tgz tar docm xlsm pptm dotm xlsb doc xls ppt svg html htm xhtml'.split(' '));
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Remove path tricks, control and bidi-override characters, and Windows-reserved names. */
function safeName(name) {
  let n = path.basename(String(name || 'download'));
  n = n.replace(/[\u0000-\u001f\u007f<>:"/\\|?*‎‏‪-‮⁦-⁩]/g, '_').replace(/[. ]+$/, '');
  if (!n || RESERVED.test(n)) n = '_' + n;
  return n.slice(0, 200) || 'download';
}

function assess(name, url, mime) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const reasons = [];
  let level = null;
  if (EXEC_EXT.has(ext)) { level = 'danger'; reasons.push(`.${ext} files can run programs on your computer`); }
  else if (CAUTION_EXT.has(ext)) { level = 'caution'; reasons.push(`.${ext} files can contain or run unexpected content`); }
  if (/^http:/i.test(url) && level) { level = 'danger'; reasons.push('downloaded over an unencrypted connection'); }
  if (/\.[a-z0-9]{2,5}\.(exe|scr|bat|cmd|com|js|vbs|ps1|msi|lnk)$/i.test(name)) { level = 'danger'; reasons.push('double file extension'); }
  if (mime && /^(image|audio|video|text)\//.test(mime) && EXEC_EXT.has(ext)) { level = 'danger'; reasons.push('file type does not match its content type'); }
  return level ? { level, reasons } : null;
}

class Downloads {
  constructor(a) {
    this.app = a;
    this.store = new Store(path.join(a.userData, 'downloads.json'), { items: [] });
    this.items = (this.store.get('items') || []).filter((d) => d.state !== 'progressing' && d.state !== 'queued' && d.state !== 'paused');
    this.live = new Map();       // id -> electron DownloadItem
    this.sessions = new Map();   // id -> Session (for retry)
    this.queue = [];             // ids waiting for a slot
    this.seq = Date.now();
    this.lastPush = 0;
    this.pushTimer = null;
  }

  flush() { this.persist(true); }

  get maxConcurrent() { return Math.max(1, Math.min(10, +this.app.settings.get('downloads.maxConcurrent') || 3)); }
  get activeCount() { return [...this.items].filter((d) => d.state === 'progressing').length; }

  persist(now) {
    const items = this.items.filter((d) => !d.private && !['progressing', 'queued', 'paused'].includes(d.state)).slice(0, 500);
    if (now) { this.store.data.items = items; this.store.flush(); } else this.store.set('items', items);
  }

  onDownload(item, wc, ses, ev) {
    const tab = wc ? this.app.byWc.get(wc.id) : null;
    const isPrivate = !!(tab && tab.win && tab.win.isPrivate);
    const url = item.getURL().split('#')[0];
    const name = safeName(item.getFilename());
    const id = ++this.seq;
    const rec = {
      id, name, url, domain: hostOf(url) || 'local', state: 'progressing', received: 0, total: item.getTotalBytes(),
      path: '', time: Date.now(), private: isPrivate, speed: 0, eta: 0, mime: item.getMimeType(),
      danger: assess(name, url, item.getMimeType()), retries: 0,
    };

    // Per-site policy: block, ask, or allow.
    const policy = wc ? this.app.perm.downloadPolicy(wc) : 'allow';
    if (policy === 'block') {
      item.cancel();
      rec.state = 'blocked'; rec.done = Date.now();
      this.items.unshift(rec); this.push(true);
      if (tab && tab.win) tab.win.send('toast', { text: `Downloads are blocked for ${rec.domain}`, danger: true });
      return;
    }

    const dir = this.app.downloadDir();
    if (!this.app.settings.get('general.askDownloadLocation')) {
      fs.mkdirSync(dir, { recursive: true });
      const target = this.uniquePath(dir, name);
      item.setSavePath(target);
      rec.path = target; rec.name = path.basename(target);
    }
    this.items.unshift(rec);
    this.live.set(id, item);
    this.sessions.set(id, ses);

    // Queue: only `maxConcurrent` transfers run at once; the rest wait paused until a slot frees up.
    if (this.activeCount - 1 >= this.maxConcurrent) { this.holdInQueue(rec, item); }

    // 'ask' policy: hold the transfer until the user decides.
    if (policy === 'ask' && tab && tab.win) {
      item.pause();
      const prev = rec.state;
      rec.state = 'paused'; rec.waitingForUser = true;
      tab.win.askPermission(tab, 'downloads', { host: rec.domain, origin: tab.topUrl, label: `download “${rec.name}”` }).then((ans) => {
        rec.waitingForUser = false;
        if (ans.allow) { if (prev === 'queued') rec.state = 'queued'; else { rec.state = 'progressing'; item.resume(); } }
        else { item.cancel(); }
        this.push(true);
      });
    }

    let lastBytes = 0, lastT = Date.now();
    item.on('updated', (_e, state) => {
      const now = Date.now();
      rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
      if (item.getSavePath()) { rec.path = item.getSavePath(); rec.name = path.basename(rec.path); }
      if (state === 'interrupted') rec.state = 'interrupted';
      else if (rec.state !== 'queued' && !rec.waitingForUser) rec.state = item.isPaused() ? 'paused' : 'progressing';
      if (now - lastT >= 400 && rec.state === 'progressing') {
        const inst = ((rec.received - lastBytes) * 1000) / (now - lastT);
        rec.speed = rec.speed ? rec.speed * 0.6 + inst * 0.4 : inst;      // smoothed
        rec.eta = rec.total > 0 && rec.speed > 1 ? Math.round((rec.total - rec.received) / rec.speed) : 0;
        lastBytes = rec.received; lastT = now;
      }
      if (rec.state !== 'progressing') rec.speed = 0;
      this.push();
    });
    item.on('done', (_e, state) => {
      rec.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      rec.done = Date.now(); rec.speed = 0; rec.eta = 0;
      rec.received = rec.state === 'completed' ? (rec.total > 0 ? rec.total : item.getReceivedBytes()) : item.getReceivedBytes();
      this.live.delete(id);
      this.queue = this.queue.filter((q) => q !== id);
      this.pump();
      this.push(true);
      if (!isPrivate) this.persist();
      const w = tab && tab.win;
      if (w && rec.state === 'completed') {
        if (rec.danger && rec.danger.level === 'danger') w.send('toast', { text: `${rec.name}: potentially dangerous file`, danger: true });
        else w.send('toast', { text: `Downloaded ${rec.name}` });
      }
    });
    if (tab && tab.win) tab.win.send('download-started', rec);
    this.push(true);
  }

  holdInQueue(rec, item) {
    rec.state = 'queued';
    this.queue.push(rec.id);
    try { item.pause(); } catch {}
  }

  /** Start waiting downloads while slots are free. */
  pump() {
    while (this.queue.length && this.activeCount < this.maxConcurrent) {
      const id = this.queue.shift();
      const rec = this.items.find((d) => d.id === id);
      const item = this.live.get(id);
      if (!rec || !item || rec.state !== 'queued') continue;
      rec.state = 'progressing';
      try { item.resume(); } catch { rec.state = 'interrupted'; }
    }
  }

  uniquePath(dir, name) {
    let target = path.join(dir, name);
    const ext = path.extname(name); const base = path.basename(name, ext);
    for (let i = 1; fs.existsSync(target) || this.items.some((d) => d.path === target && d.state !== 'completed' && d.state !== 'cancelled'); i++) {
      target = path.join(dir, `${base} (${i})${ext}`);
    }
    return target;
  }

  // ---- state to UI (throttled; nothing runs while no download is changing) ---------------------------------
  push(force) {
    const now = Date.now();
    if (!force && now - this.lastPush < 250) {
      if (!this.pushTimer) this.pushTimer = setTimeout(() => { this.pushTimer = null; this.push(true); }, 260);
      return;
    }
    this.lastPush = now;
    const list = this.list(100);
    for (const w of this.app.windows) w.send('downloads', list);
    this.app.broadcastData('downloads');
  }

  list(limit = 500) {
    return this.items.slice(0, limit).map((d) => ({ ...d, canResume: this.live.has(d.id) && this.live.get(d.id).canResume() }));
  }

  summary() {
    const act = this.items.filter((d) => d.state === 'progressing' || d.state === 'queued' || d.state === 'paused');
    return {
      active: act.length, speed: act.reduce((s, d) => s + (d.speed || 0), 0),
      received: act.reduce((s, d) => s + (d.received || 0), 0), total: act.reduce((s, d) => s + (d.total > 0 ? d.total : 0), 0),
    };
  }

  // ---- actions ----------------------------------------------------------------------------------------
  async action(id, action) {
    const rec = this.items.find((d) => d.id === id);
    const item = this.live.get(id);
    switch (action) {
      case 'pause': if (item && !item.isPaused()) { item.pause(); rec.state = 'paused'; } break;
      case 'resume':
        if (item && rec.state === 'queued') { this.queue = this.queue.filter((q) => q !== id); rec.state = 'progressing'; item.resume(); }
        else if (item && item.canResume()) { rec.state = 'progressing'; item.resume(); }
        else if (rec) return this.action(id, 'retry');
        break;
      case 'cancel': if (item) item.cancel(); break;
      case 'retry': {
        if (!rec || !/^https?:/.test(rec.url)) break;
        const ses = this.sessions.get(id) || require('electron').session.fromPartition('persist:nevix');
        this.items = this.items.filter((d) => d.id !== id);
        ses.downloadURL(rec.url);
        break;
      }
      case 'open': {
        if (!rec || !rec.path || !fs.existsSync(rec.path)) break;
        if (rec.danger && rec.danger.level !== null) {
          const win = this.app.lastWindow && this.app.lastWindow.win;
          const r = await dialog.showMessageBox(win, {
            type: 'warning', title: 'Open this file?', buttons: ['Cancel', 'Open anyway'], defaultId: 0, cancelId: 0, noLink: true,
            message: `“${rec.name}” may be unsafe`, detail: `${rec.danger.reasons.join('; ')}.\n\nSource: ${rec.domain}\nOnly open files you trust.`,
          });
          if (r.response !== 1) break;
        }
        shell.openPath(rec.path);
        break;
      }
      case 'show': if (rec && rec.path) shell.showItemInFolder(rec.path); break;
      case 'remove': this.items = this.items.filter((d) => d.id !== id); this.persist(); break;
      case 'delete-file': {
        if (rec && rec.path && fs.existsSync(rec.path)) { try { await shell.trashItem(rec.path); } catch {} }
        this.items = this.items.filter((d) => d.id !== id); this.persist(); break;
      }
      case 'clear': this.clearFinished(false); return;
      default: break;
    }
    this.push(true);
  }

  clearFinished(all) {
    this.items = this.items.filter((d) => ['progressing', 'queued', 'paused'].includes(d.state));
    this.persist(); this.push(true);
  }
}

module.exports = { Downloads, assess, safeName };
