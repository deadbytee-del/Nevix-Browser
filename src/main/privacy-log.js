'use strict';
// In-memory, per-site privacy accounting for nevix://privacy. Counters are cheap; the log of blocked requests is capped.
// Nothing here is ever written to disk or sent anywhere.
const { registrable, hostOf } = require('./domain');

const MAX_SITES = 300;
const MAX_HOSTS = 150;
const MAX_BLOCKED = 120;

class PrivacyLog {
  constructor(app) {
    this.app = app;
    this.sites = new Map();
  }

  site(top) {
    let s = this.sites.get(top);
    if (!s) {
      s = {
        site: top, first: 0, third: 0, ads: 0, trackers: 0, fingerprinting: 0, custom: 0, isolated: 0, cookies: 0, upgrades: 0,
        params: 0, bounces: 0, insecure: 0, hosts: new Map(), blocked: [], seen: Date.now(),
      };
      this.sites.set(top, s);
      if (this.sites.size > MAX_SITES) {
        let oldest = null;
        for (const x of this.sites.values()) if (!oldest || x.seen < oldest.seen) oldest = x;
        if (oldest) this.sites.delete(oldest.site);
      }
    }
    s.seen = Date.now();
    return s;
  }

  /** Called for every request, blocked or not. Must stay allocation-light. */
  record(e) {
    const s = this.site(e.top);
    switch (e.kind) {
      case 'req': {
        if (e.third) s.third++; else s.first++;
        if (e.http) s.insecure++;
        let h = s.hosts.get(e.host);
        if (!h) { if (s.hosts.size >= MAX_HOSTS) break; h = { n: 0, third: e.third, blocked: 0 }; s.hosts.set(e.host, h); }
        h.n++;
        break;
      }
      case 'blocked': {
        const k = e.category === 'ads' ? 'ads' : e.category === 'fingerprinting' ? 'fingerprinting' : e.category === 'custom' ? 'custom' : 'trackers';
        s[k]++;
        const h = s.hosts.get(e.host); if (h) h.blocked++;
        s.blocked.unshift({ time: Date.now(), url: e.url.length > 300 ? e.url.slice(0, 300) + '…' : e.url, host: e.host, type: e.type, category: e.category, rule: e.rule, list: e.list, third: e.third });
        if (s.blocked.length > MAX_BLOCKED) s.blocked.pop();
        break;
      }
      case 'isolate': s.isolated++; break;
      case 'cookie': s.cookies++; break;
      case 'upgrade': s.upgrades++; break;
      case 'params': s.params++; break;
      case 'bounce': s.bounces++; break;
      default: break;
    }
  }

  summary() {
    return [...this.sites.values()].sort((a, b) => b.seen - a.seen).map((s) => ({
      site: s.site, first: s.first, third: s.third, ads: s.ads, trackers: s.trackers + s.fingerprinting + s.custom, isolated: s.isolated + s.cookies,
      cookiesBlocked: s.cookies, upgrades: s.upgrades, bounces: s.bounces, hosts: s.hosts.size, seen: s.seen,
    }));
  }

  /** Everything the dashboard shows for one site, including live cookie/permission/storage facts. */
  async detail(site) {
    const s = this.sites.get(site);
    const base = s ? {
      site, first: s.first, third: s.third, ads: s.ads, trackers: s.trackers, fingerprinting: s.fingerprinting, custom: s.custom,
      isolated: s.isolated, cookiesBlocked: s.cookies, upgrades: s.upgrades, params: s.params, bounces: s.bounces, insecure: s.insecure,
      blocked: s.blocked,
      hosts: [...s.hosts].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.blocked - a.blocked || b.n - a.n).slice(0, 80),
    } : { site, first: 0, third: 0, ads: 0, trackers: 0, fingerprinting: 0, custom: 0, isolated: 0, cookiesBlocked: 0, upgrades: 0, params: 0, bounces: 0, insecure: 0, blocked: [], hosts: [] };

    // Live facts: stored cookies, permissions, shield state, active protections.
    const app = this.app;
    let cookies = 0;
    for (const ses of app.allSessions()) {
      try { cookies += (await ses.cookies.get({ domain: site })).length; } catch {}
    }
    const perms = [];
    for (const origin of [`https://${site}`, `https://www.${site}`, `http://${site}`]) {
      for (const p of app.perm.forOrigin(origin)) if (p.stored) perms.push({ origin, id: p.id, label: p.label, state: p.stored });
    }
    const p = app.settings.get('privacy');
    return {
      ...base, cookies, permissions: perms, shieldsOff: app.privacy.rules.shieldsOff(site),
      protections: {
        'Ad blocking': p.adblock, 'Tracker blocking': p.trackers, 'Third-party cookie blocking': p.thirdPartyCookies, 'HTTPS-only': p.httpsOnly,
        'Fingerprint protection': p.fingerprint, 'Strict fingerprint protection': app.flags.on('nevix-enable-strict-fingerprinting-protection'),
        'Strict tracker blocking': app.flags.on('nevix-enable-strict-tracker-blocking'), 'Bounce-tracking protection': app.flags.on('nevix-enable-bounce-tracking-protection'),
        'Referrer reduction': p.referrer !== 'full', 'Tracking-parameter removal': p.stripTrackingParams, 'Global Privacy Control': p.gpc,
      },
    };
  }

  clear(site) { if (site) this.sites.delete(site); else this.sites.clear(); }
}

module.exports = { PrivacyLog };
