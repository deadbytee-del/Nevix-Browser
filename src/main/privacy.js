'use strict';
const path = require('path');
const { app } = require('electron');
const { Blocker } = require('./blocker');
const { registrable, hostOf, isLocalHost } = require('./domain');
const { FILTER_LISTS } = require('./defaults');

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'mc_eid', 'mc_cid', '_hsenc', '_hsmi', 'hsctatracking', 'mkt_tok', 'igshid', 'igsh', 'vero_id', 'oly_enc_id',
  'oly_anon_id', 'rb_clickid', 's_cid', 'trk', 'trkid', 'ref_src', 'ref_url', 'spm', 'scid', 'cmpid', '_ga', '_gl',
  'wickedid', 'ml_subscriber', 'ml_subscriber_hash', 'pk_campaign', 'pk_kwd', 'piwik_campaign', 'piwik_kwd',
  'gad_source', 'gad_campaignid', 'epik', 'irclickid', 'sc_cid', 'si',
]);
const TRACKING_PREFIXES = ['utm_', 'mtm_', 'hsa_', 'pk_'];

function stripTracking(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return urlStr; }
  if (!u.search) return urlStr;
  let changed = false;
  for (const k of [...u.searchParams.keys()]) {
    const lk = k.toLowerCase();
    if (TRACKING_PARAMS.has(lk) || TRACKING_PREFIXES.some((p) => lk.startsWith(p))) {
      // "si" is only a tracker on youtu.be / spotify style share links; skip elsewhere.
      if (lk === 'si' && !/youtu\.be$|youtube\.com$|spotify\.com$/.test(u.hostname)) continue;
      u.searchParams.delete(k); changed = true;
    }
  }
  return changed ? u.toString() : urlStr;
}

const HIGH_ENTROPY_CH = [
  'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-platform-version', 'sec-ch-ua-arch',
  'sec-ch-ua-model', 'sec-ch-ua-bitness', 'sec-ch-ua-wow64', 'sec-ch-ua-form-factors',
  'sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion', 'sec-ch-viewport-width', 'sec-ch-viewport-height',
  'sec-ch-dpr', 'sec-ch-device-memory', 'sec-ch-width', 'sec-ch-ua-full', 'downlink', 'ect', 'rtt', 'save-data',
  'device-memory', 'dpr', 'viewport-width', 'width',
];

const DANGEROUS_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513,
  514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

class Privacy {
  /**
   * @param {object} deps { settings: Store, tabFor(webContents) => {topUrl, counters}, userData }
   */
  constructor(deps) {
    this.deps = deps;
    this.blocker = new Blocker();
    this.upgraded = new Map();      // https url -> http url (for fallback UX)
    this.httpAllowed = new Set();   // hosts the user chose to open over http this session
    this.certAllowed = new Set();   // host:port the user chose to proceed past a cert error
    this.stats = deps.stats;
    this.sessions = new WeakSet();
    this.reloadLists();
  }

  get s() { return this.deps.settings.get('privacy'); }

  reloadLists() {
    const b = this.blocker;
    b.clear();
    b.loadFile(path.join(__dirname, 'data', 'core-rules.txt'), 'trackers'); // curated & categorised: wins
    b.loadFile(path.join(__dirname, 'data', 'pgl-hosts.txt'), 'ads');
    const fs = require('fs');
    for (const cfg of this.s.lists) {
      if (!cfg.enabled) continue;
      const def = FILTER_LISTS.find((l) => l.id === cfg.id);
      if (!def) continue;
      b.loadFile(path.join(this.deps.userData, 'lists', cfg.id + '.txt'), def.category);
    }
    this.listCount = b.size;
  }

  shieldsOffFor(topUrl) {
    const reg = registrable(hostOf(topUrl));
    const site = this.deps.settings.get('siteShields')[reg];
    return !!(site && site.off);
  }

  userAgent() {
    const chrome = process.versions.chrome.split('.')[0];
    const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
    return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`;
  }

  /** Install every network-level protection on a session. */
  harden(ses) {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    const self = this;
    const acceptLang = () => (this.s.spoofLanguage ? 'en-US,en;q=0.9' : undefined);
    ses.setUserAgent(this.userAgent(), acceptLang());
    this.applySpellcheck(ses);
    ses.setPermissionCheckHandler((wc, permission, origin) => this.deps.permissionCheck(wc, permission, origin));
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      Promise.resolve(this.deps.permissionAsk(wc, permission, details)).then(cb, () => cb(false));
    });
    ses.setDevicePermissionHandler(() => false);
    ses.on('select-hid-device', (e, d, cb) => { e.preventDefault(); cb(); });
    ses.on('select-serial-port', (e, l, wc, cb) => { e.preventDefault(); cb(''); });
    ses.on('select-usb-device', (e, d, cb) => { e.preventDefault(); cb(); });

    const wr = ses.webRequest;

    wr.onBeforeRequest((details, cb) => {
      const url = details.url;
      if (!/^(https?|wss?):/.test(url)) return cb({});
      let u;
      try { u = new URL(url); } catch { return cb({}); }
      const p = self.s;
      if (u.port && DANGEROUS_PORTS.has(+u.port)) return cb({ cancel: true });

      const tab = self.deps.tabFor(details.webContents);
      const topUrl = (tab && tab.topUrl) || '';
      const isMain = details.resourceType === 'mainFrame';
      const off = tab && !isMain && self.shieldsOffFor(topUrl);
      const hostOff = isMain && self.shieldsOffFor(url);

      // 1. HTTPS-only upgrade.
      if (p.httpsOnly && u.protocol === 'http:' && !isLocalHost(u.hostname) && !u.port &&
          !self.httpAllowed.has(u.hostname) && !hostOff && !off) {
        const https = new URL(url); https.protocol = 'https:';
        self.upgraded.set(https.toString(), url);
        if (self.upgraded.size > 500) self.upgraded.delete(self.upgraded.keys().next().value);
        if (tab) tab.counters.upgrades++;
        self.stats.bump('upgrades');
        return cb({ redirectURL: https.toString() });
      }
      if (u.protocol === 'ws:' && p.httpsOnly && !isLocalHost(u.hostname)) {
        return cb({ redirectURL: url.replace(/^ws:/, 'wss:') });
      }

      // 2. Strip tracking parameters from top-level navigations.
      if (isMain && p.stripTrackingParams && !hostOff) {
        const clean = stripTracking(url);
        if (clean !== url) {
          self.stats.bump('params');
          return cb({ redirectURL: clean });
        }
      }

      // 3. Block ads and trackers (subresources only).
      if (!isMain && (p.adblock || p.trackers) && tab && topUrl && !off) {
        const cat = self.blocker.match(u.hostname, u.pathname + u.search, hostOf(topUrl));
        if (cat && ((cat === 'ads' && p.adblock) || (cat === 'trackers' && p.trackers))) {
          tab.counters[cat]++;
          self.stats.bump(cat);
          tab.notify && tab.notify();
          return cb({ cancel: true });
        }
      }
      cb({});
    });

    wr.onBeforeSendHeaders((details, cb) => {
      const p = this.s;
      const h = details.requestHeaders;
      const tab = this.deps.tabFor(details.webContents);
      const topUrl = (tab && tab.topUrl) || '';
      const off = tab && this.shieldsOffFor(topUrl);
      if (off) return cb({ requestHeaders: h });
      const lower = {};
      for (const k of Object.keys(h)) lower[k.toLowerCase()] = k;
      const del = (name) => { if (lower[name]) { delete h[lower[name]]; delete lower[name]; } };

      if (p.gpc) { h['Sec-GPC'] = '1'; }
      for (const n of HIGH_ENTROPY_CH) del(n);

      const reqHost = hostOf(details.url);
      const crossSite = !!topUrl && registrable(reqHost) !== registrable(hostOf(topUrl));

      // Referrer minimisation for cross-site requests.
      if (lower['referer'] && crossSite) {
        if (p.referrer === 'none') del('referer');
        else if (p.referrer === 'origin') {
          try { h[lower['referer']] = new URL(h[lower['referer']]).origin + '/'; } catch { del('referer'); }
        }
      }
      // Third-party cookies: never send.
      if (p.thirdPartyCookies && crossSite && details.resourceType !== 'mainFrame' && lower['cookie']) {
        del('cookie');
        if (tab) tab.counters.cookies++;
      }
      if (p.spoofLanguage) h['Accept-Language'] = 'en-US,en;q=0.9';
      cb({ requestHeaders: h });
    });

    wr.onHeadersReceived((details, cb) => {
      const p = this.s;
      const h = details.responseHeaders;
      if (!h) return cb({});
      const tab = this.deps.tabFor(details.webContents);
      const topUrl = (tab && tab.topUrl) || '';
      if (tab && this.shieldsOffFor(topUrl)) return cb({ responseHeaders: h });
      let changed = false;
      for (const k of Object.keys(h)) {
        const lk = k.toLowerCase();
        if (lk === 'accept-ch' || lk === 'critical-ch' || lk === 'permissions-policy-report-only') { delete h[k]; changed = true; }
        if (lk === 'set-cookie' && p.thirdPartyCookies && topUrl && details.resourceType !== 'mainFrame' &&
            registrable(hostOf(details.url)) !== registrable(hostOf(topUrl))) {
          delete h[k]; changed = true;
          if (tab) tab.counters.cookies++;
        }
      }
      cb(changed ? { responseHeaders: h } : {});
    });
  }

  /** Spell-check is opt-in: with it off, no dictionaries are requested from any server. */
  applySpellcheck(ses) {
    const on = !!this.deps.settings.get('general.spellcheck');
    try {
      ses.setSpellCheckerEnabled(on);
      ses.setSpellCheckerLanguages(on ? [app.getLocale() || 'en-US'] : []);
    } catch {}
  }

  applyAppLevel() {
    const p = this.s;
    const mode = p.doh;
    try {
      if (mode === 'off') app.configureHostResolver({ secureDnsMode: 'off' });
      else app.configureHostResolver({ secureDnsMode: mode, secureDnsServers: [p.dohServer] });
    } catch (e) { console.warn('DoH config failed', e.message); }
  }

  webrtcPolicy() {
    return { default: 'default', 'public-only': 'default_public_interface_only', strict: 'disable_non_proxied_udp' }[this.s.webrtc] || 'default_public_interface_only';
  }

  async applyProxy(ses) {
    const proxy = this.s.proxy;
    try {
      if (proxy) await ses.setProxy({ proxyRules: proxy, proxyBypassRules: '<local>' });
      else await ses.setProxy({ mode: 'system' });
    } catch (e) { console.warn('proxy config failed', e.message); }
  }
}

module.exports = { Privacy, stripTracking };
