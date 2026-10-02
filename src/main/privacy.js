'use strict';
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { Rules } = require('./rules');
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
const PIXEL_KEYS = /(^|[?&])(uid|userid|user_id|cid|clientid|client_id|visitor|visitorid|sid|sessionid|fpid|gaid|idfa|aaid|deviceid|device_id|tracking_id|trackid|ev|event|pixel)=/i;

function stripTracking(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return urlStr; }
  if (!u.search) return urlStr;
  let changed = false;
  for (const k of [...u.searchParams.keys()]) {
    const lk = k.toLowerCase();
    if (TRACKING_PARAMS.has(lk) || TRACKING_PREFIXES.some((p) => lk.startsWith(p))) {
      // "si" is only a tracker on share links; skip elsewhere.
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

const MAX_REDIRECTS = 20;

/**
 * Rule sets + per-site shield state. `main` holds the bundled and optional lists (third-party only);
 * `custom` holds the user's own rules and may match any request.
 */
class RuleSet {
  constructor(deps) {
    this.deps = deps;
    this.main = new Rules();
    this.custom = new Rules({ thirdPartyOnly: false });
    this.site = new Set();                  // permanent per-site shields-off (registrable domains)
    this.temp = new Map();                  // temporary shields-off: registrable -> expiry
    this.customFile = path.join(deps.userData, 'custom-rules.txt');
    this.loadSites();
    this.reload();
  }

  get count() { return this.main.count + this.custom.count; }

  loadSites() {
    this.site = new Set(Object.entries(this.deps.settings.get('siteShields') || {}).filter(([, v]) => v && v.off).map(([k]) => k));
  }

  /** Bundled lists compile synchronously (protection from the first request); optional lists compile in the background. */
  reload() {
    const next = new Rules();
    const dir = path.join(__dirname, 'data');
    next.loadFile(path.join(dir, 'core-rules.txt'), { listId: 'nevix-core', category: 'trackers' });
    next.loadFile(path.join(dir, 'pgl-hosts.txt'), { listId: 'pgl', category: 'ads' });
    this.main = next;
    this.loadCustom();
    const lists = this.deps.settings.get('privacy.lists') || [];
    const tasks = [];
    for (const cfg of lists) {
      if (!cfg.enabled) continue;
      const def = FILTER_LISTS.find((l) => l.id === cfg.id);
      if (!def) continue;
      const file = path.join(this.deps.userData, 'lists', cfg.id + '.txt');
      tasks.push({ file, def });
    }
    const run = async () => {
      for (const t of tasks) {
        if (this.main !== next) return;      // superseded by another reload
        let text;
        try { text = fs.readFileSync(t.file, 'utf8'); } catch { continue; }
        await next.loadAsync(text, { listId: t.def.id, name: t.def.name, category: t.def.category });
      }
    };
    if (tasks.length) {
      if (this.deps.flags.on('nevix-enable-startup-lazy-init')) setTimeout(() => run().catch(() => {}), 300).unref();
      else run().catch(() => {});
    }
    return next;
  }

  loadCustom() {
    const c = new Rules({ thirdPartyOnly: false });
    try { c.load(fs.readFileSync(this.customFile, 'utf8'), { listId: 'custom', category: 'custom', custom: true, name: 'Your rules' }); } catch {}
    this.custom = c;
  }

  customText() { try { return fs.readFileSync(this.customFile, 'utf8'); } catch { return ''; } }
  setCustomText(text) {
    fs.mkdirSync(path.dirname(this.customFile), { recursive: true });
    fs.writeFileSync(this.customFile, String(text).slice(0, 2e6));
    this.loadCustom();
    return this.custom.count;
  }
  appendCustom(line) {
    const t = this.customText();
    this.setCustomText((t && !t.endsWith('\n') ? t + '\n' : t) + line + '\n');
  }

  /** User rules win over the bundled lists; an `allow` in either stops the request being blocked. */
  check(q) {
    const c = this.custom.check(q);
    if (c) return c;
    return this.main.check(q);
  }

  lists() {
    const out = [];
    for (const [id, v] of this.main.lists) out.push({ id, name: v.name, count: v.count });
    const cu = this.custom.lists.get('custom');
    out.push({ id: 'custom', name: 'Your rules', count: cu ? cu.count : 0 });
    return out;
  }

  // ---- per-site shields ---------------------------------------------------------------------------------
  shieldsOff(reg) {
    if (this.site.has(reg)) return true;
    const t = this.temp.get(reg);
    if (t === undefined) return false;
    if (t > Date.now()) return true;
    this.temp.delete(reg);                  // lazy expiry: no timers
    return false;
  }
  persistSites() { this.deps.settings.set('siteShields', Object.fromEntries([...this.site].map((k) => [k, { off: true }]))); }
  setSite(reg, off) { if (off) this.site.add(reg); else this.site.delete(reg); this.temp.delete(reg); this.persistSites(); }
  toggleSiteShields(reg) { this.setSite(reg, !this.shieldsOff(reg)); }
  allowTemporarily(reg, minutes) { this.temp.set(reg, Date.now() + minutes * 60000); }
  clearTemporary(reg) { this.temp.delete(reg); }
  tempList() { const now = Date.now(); return [...this.temp].filter(([, t]) => t > now).map(([site, until]) => ({ site, until })); }
  siteList() { return [...this.site]; }
}

/**
 * Bounce-tracking protection. A "bounce" is a navigation that is redirected through an intermediate site the user
 * never visited (and so never interacted with). After it completes, the intermediate site's cookies and storage are
 * deleted. Interactive hops (a login page that commits and is used) are separate navigations and never match.
 */
class Bounce {
  constructor(privacy) { this.p = privacy; }
  get enabled() { return this.p.deps.flags.on('nevix-enable-bounce-tracking-protection'); }
  onStart(tab, details) { tab.chain = [details.url]; }
  onRedirect(tab, url) { if (!tab.chain) tab.chain = []; tab.chain.push(url); }
  hops(tab) { return tab.chain ? tab.chain.length : 0; }

  onCommitted(tab, finalUrl) {
    const chain = tab.chain; tab.chain = null;
    if (!this.enabled || !chain || chain.length < 3) return;
    const startReg = registrable(hostOf(chain[0]));
    const endReg = registrable(hostOf(finalUrl));
    const mids = new Set();
    for (const u of chain.slice(1, -1)) {
      const reg = registrable(hostOf(u));
      if (reg && reg !== startReg && reg !== endReg && !isLocalHost(hostOf(u))) mids.add(reg);
    }
    const hist = this.p.deps.history;
    for (const reg of mids) {
      if (hist && hist.items.some((i) => registrable(hostOf(i.url)) === reg)) continue;   // the user has been there: not a bounce
      setTimeout(() => this.purge(tab, reg, startReg), 1200).unref();
    }
  }

  async purge(tab, reg, from) {
    const wc = tab.wc;
    const ses = wc ? wc.session : null;
    if (!ses) return;
    let removed = 0;
    try {
      for (const c of await ses.cookies.get({})) {
        const d = (c.domain || '').replace(/^\./, '');
        if (d === reg || d.endsWith('.' + reg)) {
          await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${d}${c.path}`, c.name);
          removed++;
        }
      }
      for (const origin of [`https://${reg}`, `https://www.${reg}`]) await ses.clearStorageData({ origin }).catch(() => {});
    } catch {}
    this.p.deps.stats.bump('bounces');
    this.p.deps.log && this.p.deps.log({ kind: 'bounce', top: from, host: reg, removed });
  }
}

class Privacy {
  /** @param {object} deps { settings, stats, userData, flags, history, tabFor(wc), permissionCheck, permissionAsk, log } */
  constructor(deps) {
    this.deps = deps;
    this.rules = new RuleSet(deps);
    this.bounce = new Bounce(this);
    this.upgraded = new Map();      // https url -> http url (for fallback UX)
    this.httpAllowed = new Set();   // hosts the user chose to open over http this session
    this.certAllowed = new Set();   // host:port the user chose to proceed past a cert error
    this.isolated = new Set();      // request ids that matched an `isolate` rule
    this.stats = deps.stats;
    this.sessions = new WeakSet();
    this.taps = new Set();          // optional live observers (network monitor, diagnostics)
    this.net = { requests: 0, bytes: 0, cached: 0 };
  }

  get s() { return this.deps.settings.get('privacy'); }
  get strict() { return this.deps.flags.on('nevix-enable-strict-tracker-blocking'); }

  reloadLists() { this.rules.reload(); }

  shieldsOffFor(topUrl) { return this.rules.shieldsOff(registrable(hostOf(topUrl))); }

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
    const log = this.deps.log;
    ses.setUserAgent(this.userAgent(), this.s.spoofLanguage ? 'en-US,en;q=0.9' : undefined);
    this.applySpellcheck(ses);
    ses.setPermissionCheckHandler((wc, permission, origin) => this.deps.permissionCheck(wc, permission, origin));
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      Promise.resolve(this.deps.permissionAsk(wc, permission, details)).then(cb, () => cb(false));
    });
    ses.setDevicePermissionHandler(() => false);   // every device use goes through an explicit chooser; nothing is remembered
    ses.on('select-hid-device', (e, d, cb) => { e.preventDefault(); cb(); });
    ses.on('select-serial-port', (e, l, wc, cb) => { e.preventDefault(); cb(''); });
    ses.on('select-usb-device', (e, d, cb) => { e.preventDefault(); this.deps.selectUsb ? this.deps.selectUsb(d.webContents || null, d, cb) : cb(); });

    const wr = ses.webRequest;

    wr.onBeforeRequest((details, cb) => {
      const url = details.url;
      if (!/^(https?|wss?):/.test(url)) return cb({});
      let u;
      try { u = new URL(url); } catch { return cb({}); }
      const p = this.s;
      if (u.port && DANGEROUS_PORTS.has(+u.port)) return cb({ cancel: true });

      const tab = this.deps.tabFor(details.webContents);
      const topUrl = (tab && tab.topUrl) || '';
      const isMain = details.resourceType === 'mainFrame';
      const topHost = hostOf(topUrl);
      const topReg = registrable(topHost);
      const reg = registrable(u.hostname);
      const off = tab && !isMain && this.rules.shieldsOff(topReg);
      const hostOff = isMain && this.rules.shieldsOff(reg);
      const third = !!topReg && reg !== topReg && !isMain;
      if (log && tab && !isMain && topReg) log({ kind: 'req', top: topReg, host: u.hostname, third, http: u.protocol === 'http:' || u.protocol === 'ws:' });

      // 1. HTTPS-only upgrade.
      if (p.httpsOnly && u.protocol === 'http:' && !isLocalHost(u.hostname) && !u.port &&
          !this.httpAllowed.has(u.hostname) && !hostOff && !off) {
        const https = new URL(url); https.protocol = 'https:';
        this.upgraded.set(https.toString(), url);
        if (this.upgraded.size > 500) this.upgraded.delete(this.upgraded.keys().next().value);
        if (tab) tab.counters.upgrades++;
        this.stats.bump('upgrades');
        if (log) log({ kind: 'upgrade', top: isMain ? reg : topReg, host: u.hostname });
        return cb({ redirectURL: https.toString() });
      }
      if (u.protocol === 'ws:' && p.httpsOnly && !isLocalHost(u.hostname)) {
        return cb({ redirectURL: url.replace(/^ws:/, 'wss:') });
      }

      // 2. Redirect abuse: a main-frame navigation may not bounce forever.
      if (isMain && tab && this.bounce.hops(tab) > MAX_REDIRECTS) return cb({ cancel: true });

      // 3. Strip tracking parameters from top-level navigations.
      if (isMain && p.stripTrackingParams && !hostOff) {
        const clean = stripTracking(url);
        if (clean !== url) {
          this.stats.bump('params');
          if (log) log({ kind: 'params', top: reg, host: u.hostname });
          return cb({ redirectURL: clean });
        }
      }

      // 4. Filter ads and trackers (subresources and frames).
      if (!isMain && tab && topUrl && !off) {
        const q = { url, host: u.hostname, path: u.pathname + u.search, topHost, type: details.resourceType };
        let d = (p.adblock || p.trackers || this.rules.custom.count) ? this.rules.check(q) : null;
        let reason = null;
        if (d && d.action !== 'allow') {
          const cat = d.category;
          const enabled = cat === 'custom' || (cat === 'ads' && p.adblock) || ((cat === 'trackers' || cat === 'fingerprinting') && p.trackers);
          if (enabled) reason = d;
        }
        if (!reason && this.strict && p.trackers && third && !(d && d.action === 'allow')) reason = this.strictCheck(u, details.resourceType);
        if (reason) {
          if (reason.action === 'isolate') {
            this.isolated.add(details.id);
            if (this.isolated.size > 2000) this.isolated.delete(this.isolated.values().next().value);
            if (log) log({ kind: 'isolate', top: topReg, host: u.hostname, rule: reason.rule, list: reason.list });
            if (this.taps.size) this.emit({ kind: 'isolate', url, top: topReg, rule: reason.rule });
          } else {
            const cat = reason.category === 'fingerprinting' || reason.category === 'custom' ? reason.category : reason.category === 'ads' ? 'ads' : 'trackers';
            if (cat === 'ads' || cat === 'trackers') tab.counters[cat]++;
            else tab.counters.trackers++;
            this.stats.bump(cat === 'ads' ? 'ads' : 'trackers');
            if (log) log({ kind: 'blocked', top: topReg, host: u.hostname, url, type: details.resourceType, category: cat, rule: reason.rule, list: reason.list, third });
            if (this.taps.size) this.emit({ kind: 'blocked', url, top: topReg, type: details.resourceType, category: cat, rule: reason.rule, list: reason.list });
            tab.notify && tab.notify();
            return cb({ cancel: true });
          }
        }
      }
      if (this.taps.size) this.emit({ kind: 'request', url, top: topReg, type: details.resourceType, third, method: details.method });
      cb({});
    });

    wr.onBeforeSendHeaders((details, cb) => {
      const p = this.s;
      const h = details.requestHeaders;
      const tab = this.deps.tabFor(details.webContents);
      const topUrl = (tab && tab.topUrl) || '';
      const off = tab && this.rules.shieldsOff(registrable(hostOf(topUrl)));
      if (off) return cb({ requestHeaders: h });
      const lower = {};
      for (const k of Object.keys(h)) lower[k.toLowerCase()] = k;
      const del = (name) => { if (lower[name]) { delete h[lower[name]]; delete lower[name]; return true; } return false; };
      const mods = [];

      if (p.gpc) { h['Sec-GPC'] = '1'; mods.push('Sec-GPC: 1 added'); }
      let ch = 0;
      for (const n of HIGH_ENTROPY_CH) if (del(n)) ch++;
      if (ch) mods.push(`${ch} high-entropy client hint header(s) removed`);

      const reqHost = hostOf(details.url);
      const crossSite = !!topUrl && registrable(reqHost) !== registrable(hostOf(topUrl));
      const iso = this.isolated.has(details.id);

      if (lower['referer'] && (crossSite || iso)) {
        if (p.referrer === 'none' || iso) { del('referer'); mods.push('Referer removed'); }
        else if (p.referrer === 'origin') {
          try { h[lower['referer']] = new URL(h[lower['referer']]).origin + '/'; mods.push('Referer reduced to origin'); } catch { del('referer'); }
        }
      }
      if ((p.thirdPartyCookies && crossSite && details.resourceType !== 'mainFrame' || iso) && lower['cookie']) {
        del('cookie'); mods.push('Cookie header removed');
        if (tab) tab.counters.cookies++;
        this.deps.log && this.deps.log({ kind: 'cookie', top: registrable(hostOf(topUrl)), host: reqHost });
      }
      if (p.spoofLanguage) { h['Accept-Language'] = 'en-US,en;q=0.9'; mods.push('Accept-Language normalised'); }
      if (this.taps.size && mods.length) this.emit({ kind: 'headers', url: details.url, mods });
      cb({ requestHeaders: h });
    });

    wr.onHeadersReceived((details, cb) => {
      const p = this.s;
      const h = details.responseHeaders;
      if (!h) return cb({});
      const tab = this.deps.tabFor(details.webContents);
      const topUrl = (tab && tab.topUrl) || '';
      if (tab && this.rules.shieldsOff(registrable(hostOf(topUrl)))) return cb({ responseHeaders: h });
      const iso = this.isolated.delete(details.id);
      let changed = false;
      const mods = [];
      for (const k of Object.keys(h)) {
        const lk = k.toLowerCase();
        if (lk === 'accept-ch' || lk === 'critical-ch' || lk === 'permissions-policy-report-only') { delete h[k]; changed = true; mods.push(`${k} response header removed`); }
        if (lk === 'set-cookie' && topUrl && details.resourceType !== 'mainFrame' &&
            ((p.thirdPartyCookies && registrable(hostOf(details.url)) !== registrable(hostOf(topUrl))) || iso)) {
          delete h[k]; changed = true; mods.push('Set-Cookie blocked');
          if (tab) tab.counters.cookies++;
          this.deps.log && this.deps.log({ kind: 'cookie', top: registrable(hostOf(topUrl)), host: hostOf(details.url) });
        }
      }
      if (this.taps.size && mods.length) this.emit({ kind: 'headers', url: details.url, mods });
      cb(changed ? { responseHeaders: h } : {});
    });

    wr.onCompleted((details) => {
      const n = this.net;
      n.requests++;
      if (details.fromCache) n.cached++;
      const h = details.responseHeaders;
      if (h) { const cl = h['content-length'] || h['Content-Length']; if (cl) n.bytes += +cl[0] || 0; }
    });
  }

  emit(ev) { for (const t of this.taps) { try { t(ev); } catch {} } }

  /** Strict tracker mode: third-party pixels and beacons that carry identifiers. */
  strictCheck(u, type) {
    if (!['image', 'ping', 'xhr', 'other', 'cspReport'].includes(type)) return null;
    const qs = u.search;
    if (type === 'ping' || type === 'cspReport') return { action: 'block', category: 'trackers', list: 'strict mode', rule: `third-party ${type} request` };
    if (qs && (PIXEL_KEYS.test(qs) || [...u.searchParams.keys()].some((k) => TRACKING_PARAMS.has(k.toLowerCase()) || TRACKING_PREFIXES.some((x) => k.toLowerCase().startsWith(x))))) {
      return { action: 'block', category: 'trackers', list: 'strict mode', rule: 'third-party request carrying a tracking identifier' };
    }
    if (type === 'image' && /(^|\/)(pixel|beacon|track|collect|__utm|b\/ss|1x1|clear)\b[^/]*\.(gif|png)$/i.test(u.pathname)) {
      return { action: 'block', category: 'trackers', list: 'strict mode', rule: 'tracking-pixel path' };
    }
    return null;
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
    } catch (e) { /* unsupported on this platform */ }
  }

  webrtcPolicy() {
    return { default: 'default', 'public-only': 'default_public_interface_only', strict: 'disable_non_proxied_udp' }[this.s.webrtc] || 'default_public_interface_only';
  }

  async applyProxy(ses) {
    const proxy = this.s.proxy;
    try {
      if (proxy) await ses.setProxy({ proxyRules: proxy, proxyBypassRules: '<local>' });
      else await ses.setProxy({ mode: 'system' });
    } catch { /* invalid proxy string: keep the previous configuration */ }
  }
}

module.exports = { Privacy, RuleSet, stripTracking };
