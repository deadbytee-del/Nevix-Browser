'use strict';
// Unified site-permission manager. Decisions are keyed by *origin* (scheme + host + port), never by host alone,
// so https://a.com, http://a.com and https://a.com:8443 are three separate sites.
const path = require('path');
const { dialog } = require('electron');
const { Store } = require('./store');
const { hostOf } = require('./domain');

/** The permissions the user can manage. `ask` = prompt, `allow`, `block`. */
const CATALOG = [
  { id: 'camera', label: 'Camera', default: 'ask', verb: 'use your camera' },
  { id: 'microphone', label: 'Microphone', default: 'ask', verb: 'use your microphone' },
  { id: 'geolocation', label: 'Location', default: 'ask', verb: 'know your location' },
  { id: 'notifications', label: 'Notifications', default: 'block', verb: 'show notifications' },
  { id: 'clipboard', label: 'Clipboard (read)', default: 'ask', verb: 'read your clipboard' },
  { id: 'popups', label: 'Pop-ups', default: 'block', verb: 'open pop-up windows' },
  { id: 'downloads', label: 'Automatic downloads', default: 'allow', verb: 'download files' },
  { id: 'autoplay', label: 'Autoplay', default: 'block', verb: 'autoplay media' },
  { id: 'bluetooth', label: 'Bluetooth', default: 'ask', verb: 'connect to Bluetooth devices' },
  { id: 'usb', label: 'USB devices', default: 'ask', verb: 'connect to USB devices' },
  { id: 'sensors', label: 'Motion sensors', default: 'block', verb: 'use motion sensors' },
  { id: 'midi', label: 'MIDI devices', default: 'ask', verb: 'use MIDI devices' },
];
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));
const STATES = ['allow', 'ask', 'block'];

// Electron permission names that need no user decision.
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock', 'speaker-selection', 'persistent-storage']);

const originOf = (url) => {
  try { const u = new URL(url); return u.origin === 'null' ? u.protocol + '//' : u.origin; } catch { return ''; }
};

/** Electron permission name (+ details) -> catalog ids that must all be granted. */
function toCatalog(electronPerm, details = {}) {
  switch (electronPerm) {
    case 'media': {
      const t = details.mediaTypes || [];
      const ids = [];
      if (t.includes('video')) ids.push('camera');
      if (t.includes('audio')) ids.push('microphone');
      return ids.length ? ids : ['camera', 'microphone'];
    }
    case 'geolocation': return ['geolocation'];
    case 'notifications': return ['notifications'];
    case 'clipboard-read': return ['clipboard'];
    case 'midi': case 'midiSysex': return ['midi'];
    case 'sensors': case 'accelerometer': case 'gyroscope': case 'magnetometer': case 'ambient-light-sensor': return ['sensors'];
    default: return null;
  }
}

class Permissions {
  constructor(app) {
    this.app = app;
    this.store = new Store(path.join(app.userData, 'permissions.json'), { sites: {}, defaults: {} });
    this.once = new Map();         // `${tabKey}|${origin}|${perm}` -> true   (allow once: lives until the tab is closed)
    this.session = new Map();      // origin|perm -> state, for private windows and abuse auto-blocks (never persisted)
    this.denials = new Map();      // origin|perm -> count of refusals this run
    this.pending = new Map();      // origin|perm -> promise (de-duplicates simultaneous prompts)
  }

  flush() { this.store.flush(); }
  get catalog() { return CATALOG; }

  defaultFor(perm) {
    const d = this.store.get('defaults')[perm];
    return STATES.includes(d) ? d : (BY_ID.get(perm) || {}).default || 'block';
  }
  setDefault(perm, state) {
    if (!BY_ID.has(perm) || !STATES.includes(state)) throw new Error('bad permission');
    const d = { ...this.store.get('defaults') };
    if (state === (BY_ID.get(perm).default)) delete d[perm]; else d[perm] = state;
    this.store.set('defaults', d);
  }

  /** Effective state for an origin: session override > stored site decision > global default. */
  state(origin, perm, tabKey) {
    if (tabKey && this.once.has(`${tabKey}|${origin}|${perm}`)) return 'allow';
    const s = this.session.get(`${origin}|${perm}`);
    if (s) return s;
    const site = this.store.get('sites')[origin];
    if (site && STATES.includes(site[perm])) return site[perm];
    return this.defaultFor(perm);
  }

  stored(origin, perm) { const s = this.store.get('sites')[origin]; return s && s[perm]; }

  set(origin, perm, state, { persist = true } = {}) {
    if (!origin || !BY_ID.has(perm)) throw new Error('bad permission');
    if (state !== 'default' && !STATES.includes(state)) throw new Error('bad state');
    this.session.delete(`${origin}|${perm}`);
    if (!persist) { if (state !== 'default') this.session.set(`${origin}|${perm}`, state); return; }
    const sites = { ...this.store.get('sites') };
    const site = { ...(sites[origin] || {}) };
    if (state === 'default') delete site[perm]; else site[perm] = state;
    if (Object.keys(site).length) sites[origin] = site; else delete sites[origin];
    this.store.set('sites', sites);
    this.app.broadcastData('permissions');
  }

  allowOnce(tabKey, origin, perm) { this.once.set(`${tabKey}|${origin}|${perm}`, true); }
  forgetTab(tabKey) { for (const k of [...this.once.keys()]) if (k.startsWith(tabKey + '|')) this.once.delete(k); }

  /** Remove every saved decision for one origin. */
  reset(origin) {
    const sites = { ...this.store.get('sites') };
    delete sites[origin];
    this.store.set('sites', sites);
    for (const k of [...this.session.keys()]) if (k.startsWith(origin + '|')) this.session.delete(k);
    for (const k of [...this.denials.keys()]) if (k.startsWith(origin + '|')) this.denials.delete(k);
    this.app.broadcastData('permissions');
  }

  /** Permissions + cookies + storage + cache for the origin ("forget this site"). */
  async resetSite(origin) {
    this.reset(origin);
    const host = hostOf(origin);
    for (const ses of this.app.allSessions()) {
      try {
        if (typeof ses.clearData === 'function') await ses.clearData({ origins: [origin], dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'cacheStorage', 'fileSystems', 'webSQL', 'cache', 'sharedStorage'].filter(Boolean) });
        else await ses.clearStorageData({ origin });
      } catch { try { await ses.clearStorageData({ origin }); } catch {} }
      // Cookies are keyed by domain, which may include sibling subdomains of the origin's host.
      try {
        for (const c of await ses.cookies.get({ domain: host })) {
          await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`, c.name);
        }
      } catch {}
    }
  }

  list() {
    const sites = this.store.get('sites');
    return {
      catalog: CATALOG.map((c) => ({ ...c, current: this.defaultFor(c.id) })),
      sites: Object.entries(sites).map(([origin, perms]) => ({ origin, perms })).sort((a, b) => a.origin.localeCompare(b.origin)),
    };
  }

  forOrigin(origin) {
    return CATALOG.map((c) => ({ id: c.id, label: c.label, state: this.state(origin, c.id), stored: this.stored(origin, c.id) || null }));
  }

  // ---- Electron hooks ---------------------------------------------------------------------------------
  tabKeyOf(wc) { const t = wc && this.app.byWc.get(wc.id); return t && t.id ? 't' + t.id : ''; }
  topOrigin(wc) { const t = wc && this.app.byWc.get(wc.id); return originOf((t && t.topUrl) || (wc && wc.getURL()) || ''); }

  /** Synchronous check (permission query / feature probing). `ask` means "not granted yet". */
  check(wc, electronPerm, requestingOrigin) {
    if (/^nevix:/.test(requestingOrigin || '')) return electronPerm === 'clipboard-sanitized-write';
    if (AUTO_ALLOW.has(electronPerm)) return true;
    const ids = toCatalog(electronPerm, {});
    if (!ids) return false;
    const origin = originOf(requestingOrigin) || this.topOrigin(wc);
    const tabKey = this.tabKeyOf(wc);
    return ids.every((id) => this.state(origin, id, tabKey) === 'allow');
  }

  async ask(wc, electronPerm, details) {
    const origin = originOf(details.requestingUrl || (wc && wc.getURL()) || '');
    if (/^nevix:/.test(details.requestingUrl || '')) return false;
    if (AUTO_ALLOW.has(electronPerm)) return true;
    const ids = toCatalog(electronPerm, details);
    if (!ids || !origin) return false;
    const tab = wc && this.app.byWc.get(wc.id);
    const tabKey = this.tabKeyOf(wc);
    // Frames from other origins are not covered by the top page's grant.
    for (const id of ids) {
      const st = this.state(origin, id, tabKey);
      if (st === 'block') return false;
    }
    if (ids.every((id) => this.state(origin, id, tabKey) === 'allow')) return true;
    if (!tab || !tab.win) return false;

    const need = ids.filter((id) => this.state(origin, id, tabKey) !== 'allow');
    const verb = need.length > 1 ? need.map((i) => BY_ID.get(i).verb).join(' and ') : BY_ID.get(need[0]).verb;
    const key = origin + '|' + need.join(',');
    if (this.pending.has(key)) return this.pending.get(key);
    const p = tab.win.askPermission(tab, electronPerm, { host: hostOf(origin) || origin, origin, label: verb }).then((answer) => {
      this.pending.delete(key);
      const allow = answer.allow;
      const persist = !tab.win.isPrivate;
      for (const id of need) {
        const k = `${origin}|${id}`;
        if (allow && answer.mode === 'once') this.allowOnce(tabKey, origin, id);
        else if (allow) this.set(origin, id, 'allow', { persist });
        else if (answer.mode === 'block') this.set(origin, id, 'block', { persist });
        else {
          // Dismissed: remember refusals, and stop asking once a site is clearly nagging.
          const n = (this.denials.get(k) || 0) + 1;
          this.denials.set(k, n);
          if (n >= 3) this.set(origin, id, 'block', { persist: false });
        }
      }
      return allow;
    });
    this.pending.set(key, p);
    return p;
  }

  // ---- popups -----------------------------------------------------------------------------------------
  /** May this page open a window without a user gesture? */
  popupAllowed(wc) {
    const origin = this.topOrigin(wc);
    return this.state(origin, 'popups', this.tabKeyOf(wc)) === 'allow';
  }

  // ---- downloads --------------------------------------------------------------------------------------
  downloadPolicy(wc) {
    const origin = this.topOrigin(wc);
    return this.state(origin, 'downloads', this.tabKeyOf(wc));
  }

  // ---- devices (Bluetooth / USB / HID / serial) -------------------------------------------------------
  /** Shows a native chooser; resolves to the chosen index or -1. Never auto-selects a device. */
  async choose(win, title, names) {
    const MAX = 8;
    const shown = names.slice(0, MAX);
    const r = await dialog.showMessageBox(win ? win.win : undefined, {
      type: 'question', title, message: title, detail: names.length > MAX ? `Showing the first ${MAX} of ${names.length} devices.` : undefined,
      buttons: [...shown, 'Cancel'], cancelId: shown.length, defaultId: shown.length, noLink: true,
    });
    return r.response >= shown.length ? -1 : r.response;
  }

  deviceAllowed(wc, perm) {
    const origin = this.topOrigin(wc);
    return this.state(origin, perm, this.tabKeyOf(wc)) !== 'block';
  }

  async selectBluetooth(wc, devices, cb) {
    const tab = this.app.byWc.get(wc.id);
    if (!this.deviceAllowed(wc, 'bluetooth') || !devices.length) return cb('');
    const i = await this.choose(tab && tab.win, `${hostOf(wc.getURL())} wants to connect to a Bluetooth device`, devices.map((d) => d.deviceName || d.deviceId));
    cb(i < 0 ? '' : devices[i].deviceId);
  }

  async selectUsb(wc, details, cb) {
    const tab = wc && this.app.byWc.get(wc.id);
    const list = details.deviceList || [];
    if (!wc || !this.deviceAllowed(wc, 'usb') || !list.length) return cb();
    const i = await this.choose(tab && tab.win, `${hostOf(wc.getURL())} wants to connect to a USB device`, list.map((d) => d.productName || `USB ${d.vendorId}:${d.productId}`));
    if (i < 0) cb(); else cb(list[i].deviceId);
  }
}

module.exports = { Permissions, CATALOG, originOf, toCatalog };
