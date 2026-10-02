'use strict';
// Nevix diagnostics: attach the Chrome DevTools Protocol to one tab and record, per request, what the engine
// actually did — HTTP protocol, TLS details, cache behaviour, remote address — together with what Nevix itself
// changed or blocked. Opt-in and per tab: nothing is recorded until you start it, and nothing leaves the page.
const { hostOf } = require('./domain');

const MAX = 1500;

class Diagnostics {
  constructor(app) {
    this.app = app;
    this.target = null;      // { win, tab, wc }
    this.reqs = new Map();   // requestId -> entry
    this.order = [];
    this.mods = new Map();   // url -> [modifications]
    this.listener = null;
    this.sender = null;
    this.timer = null;
    this.attachedByUs = false;
  }

  tabs() {
    const out = [];
    for (const w of this.app.windows) for (const t of w.tabs) if (t.wc) out.push({ win: w.id, id: t.id, title: t.title || t.displayUrl || 'New Tab', host: hostOf(t.displayUrl), active: t.id === w.activeId, recording: !!(this.target && this.target.tab === t) });
    return out;
  }

  async start(winId, tabId, sender) {
    this.stop();
    const w = [...this.app.windows].find((x) => x.id === winId);
    const tab = w && w.tabs.find((t) => t.id === tabId);
    const wc = tab && tab.wc;
    if (!wc) return { error: 'That tab is not loaded (it is suspended or discarded). Open it first.' };
    this.sender = sender;
    this.target = { win: w, tab, wc };
    this.reqs.clear(); this.order = []; this.mods.clear();
    this.attachedByUs = false;
    try {
      if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); this.attachedByUs = true; }
      await wc.debugger.sendCommand('Network.enable', { maxPostDataSize: 0 });
      await wc.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: false });
    } catch (e) { this.stop(); return { error: 'Could not attach: ' + (e.message || e) }; }
    this.msg = (_e, method, p) => this.onEvent(method, p);
    wc.debugger.on('message', this.msg);
    this.listener = (ev) => {
      if (ev.kind === 'headers') { const a = this.mods.get(ev.url) || []; a.push(...ev.mods); this.mods.set(ev.url, a.slice(-12)); }
      else if (ev.kind === 'blocked' || ev.kind === 'isolate') this.mods.set(ev.url, [`${ev.kind === 'blocked' ? 'Blocked' : 'Isolated'} by ${ev.list || 'rule'}: ${ev.rule}`]);
    };
    this.app.privacy.taps.add(this.listener);
    return { ok: true, dns: this.dnsMethod() };
  }

  dnsMethod() {
    const p = this.app.settings.get('privacy');
    if (p.proxy) return `Through proxy ${p.proxy} (the proxy resolves names)`;
    if (p.doh === 'off') return 'System DNS (unencrypted)';
    return p.doh === 'secure' ? `DNS-over-HTTPS only — ${p.dohServer}` : `DNS-over-HTTPS when available (${p.dohServer}), otherwise system DNS`;
  }

  onEvent(method, p) {
    let e;
    switch (method) {
      case 'Network.requestWillBeSent': {
        const prev = this.reqs.get(p.requestId);
        if (prev && p.redirectResponse) { prev.status = p.redirectResponse.status; prev.redirectTo = p.request.url; }
        e = { id: p.requestId, url: p.request.url, host: hostOf(p.request.url), method: p.request.method, type: p.type || 'Other', start: p.timestamp, status: 0, protocol: '', ip: '', cache: 'network', size: 0, ms: 0, tls: null, error: '', mods: [] };
        this.reqs.set(p.requestId, e); this.order.push(p.requestId);
        if (this.order.length > MAX) this.reqs.delete(this.order.shift());
        break;
      }
      case 'Network.responseReceived': {
        e = this.reqs.get(p.requestId); if (!e) return;
        const r = p.response;
        e.status = r.status; e.mime = r.mimeType; e.protocol = r.protocol || ''; e.ip = r.remoteIPAddress ? `${r.remoteIPAddress}:${r.remotePort}` : '';
        e.cache = r.fromServiceWorker ? 'service worker' : r.fromPrefetchCache ? 'prefetch cache' : r.fromDiskCache ? 'disk cache' : 'network';
        e.cacheControl = (r.headers && (r.headers['cache-control'] || r.headers['Cache-Control'])) || '';
        if (r.securityDetails) {
          const s = r.securityDetails;
          e.tls = { protocol: s.protocol, cipher: s.cipher, keyExchange: s.keyExchange, issuer: s.issuer, subject: s.subjectName, validFrom: s.validFrom * 1000, validTo: s.validTo * 1000, ct: s.certificateTransparencyCompliance };
        }
        break;
      }
      case 'Network.loadingFinished': {
        e = this.reqs.get(p.requestId); if (!e) return;
        e.size = p.encodedDataLength; e.ms = Math.round((p.timestamp - e.start) * 1000);
        break;
      }
      case 'Network.loadingFailed': {
        e = this.reqs.get(p.requestId); if (!e) return;
        e.error = p.blockedReason ? `blocked (${p.blockedReason})` : p.errorText; e.ms = Math.round((p.timestamp - e.start) * 1000);
        if (/ERR_BLOCKED_BY_CLIENT/.test(p.errorText)) e.error = 'blocked by Nevix';
        break;
      }
      default: return;
    }
    if (e) { e.mods = this.mods.get(e.url) || e.mods; this.schedule(); }
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { if (this.sender && !this.sender.isDestroyed()) this.sender.send('nevix:diag-event', this.summary()); } catch {}
    }, 300);
  }

  summary() {
    const list = this.entries();
    const by = (f) => list.reduce((m, e) => { const k = f(e) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
    return {
      recording: !!this.target, total: list.length, protocols: by((e) => e.protocol), cache: by((e) => e.cache),
      blocked: list.filter((e) => /blocked/.test(e.error)).length, modified: list.filter((e) => e.mods && e.mods.length).length,
      dns: this.dnsMethod(), target: this.target ? { title: this.target.tab.title, url: this.target.tab.displayUrl } : null,
    };
  }

  entries() {
    return this.order.map((id) => this.reqs.get(id)).filter(Boolean).map((e) => ({ ...e, mods: this.mods.get(e.url) || e.mods }));
  }

  clear() { this.reqs.clear(); this.order = []; this.mods.clear(); return true; }

  stop() {
    const t = this.target;
    if (t) {
      try { if (this.msg) t.wc.debugger.removeListener('message', this.msg); } catch {}
      try { if (this.attachedByUs && t.tab.stage !== 'frozen') t.wc.debugger.detach(); } catch {}
    }
    if (this.listener) this.app.privacy.taps.delete(this.listener);
    this.target = null; this.listener = null; this.msg = null;
    return true;
  }

  flush() { this.stop(); }
}

module.exports = { Diagnostics };
