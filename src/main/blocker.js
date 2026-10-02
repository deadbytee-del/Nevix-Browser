'use strict';
const fs = require('fs');
const { registrable } = require('./domain');

/**
 * Domain/path based content blocker. Supports hosts files, plain domain lists and
 * the common ABP network-rule shapes (`||domain^`, `||domain/path`, `@@||domain^`).
 * Rules are third-party-only by design (first-party requests are never blocked),
 * which keeps sites working while stopping the trackers that matter.
 */
class Blocker {
  constructor() {
    this.domains = new Map(); // domain -> category
    this.paths = new Map();   // domain -> [{ prefix, cat }]
    this.allow = new Set();
    this.size = 0;
  }

  clear() { this.domains.clear(); this.paths.clear(); this.allow.clear(); this.size = 0; }

  /** First list to claim a domain decides its category (bundled ad list is loaded first). */
  addDomain(d, category) { if (!this.domains.has(d)) this.domains.set(d, category); }

  loadText(text, category = 'trackers') {
    let added = 0;
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      const cat = /^!#category\s+(\w+)/.exec(line);
      if (cat) { category = cat[1]; continue; }
      if (!line || line[0] === '#' || line[0] === '!' || line[0] === '[') continue;
      if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) continue;

      let m;
      if ((m = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+([^\s#]+)/.exec(line))) {
        if (m[1] !== 'localhost' && m[1].includes('.')) { this.addDomain(m[1].toLowerCase(), category); added++; }
        continue;
      }
      let exception = false;
      if (line.startsWith('@@')) { exception = true; line = line.slice(2); }
      if (line.startsWith('||')) {
        let rule = line.slice(2);
        let opts = '';
        const di = rule.lastIndexOf('$');
        if (di !== -1) { opts = rule.slice(di + 1); rule = rule.slice(0, di); }
        if (opts) {
          const o = opts.split(',');
          // Only keep rules whose options don't narrow them to specific types/domains.
          if (o.some((x) => x !== 'third-party' && x !== '3p' && x !== 'important' && x !== 'all')) continue;
        }
        m = /^([a-z0-9.-]+)(\^|\/.*)?$/i.exec(rule);
        if (!m) continue;
        const dom = m[1].toLowerCase();
        const rest = m[2];
        if (!dom.includes('.')) continue;
        if (!rest || rest === '^') {
          if (exception) this.allow.add(dom); else this.addDomain(dom, category);
          added++;
        } else if (!exception) {
          const prefix = rest.replace(/\^$/, '');
          if (/[*^|]/.test(prefix)) continue;
          if (!this.paths.has(dom)) this.paths.set(dom, []);
          this.paths.get(dom).push({ prefix, cat: category });
          added++;
        }
        continue;
      }
      // Bare domain list.
      if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(line)) { this.addDomain(line.toLowerCase(), category); added++; }
    }
    this.size += added;
    return added;
  }

  loadFile(file, category) {
    try { return this.loadText(fs.readFileSync(file, 'utf8'), category); } catch { return 0; }
  }

  /** Returns the category string if the request should be blocked, else null. */
  match(host, pathname, topHost) {
    if (!host) return null;
    const reg = registrable(host);
    if (topHost && reg === registrable(topHost)) return null; // first-party
    let h = host;
    // Exceptions first.
    for (let d = h; d; d = d.slice(d.indexOf('.') + 1)) {
      if (this.allow.has(d)) return null;
      if (!d.includes('.') || d === reg) break;
    }
    for (let d = h; d; ) {
      const cat = this.domains.get(d);
      if (cat) return cat;
      const pr = this.paths.get(d);
      if (pr) for (const r of pr) if (pathname.startsWith(r.prefix)) return r.cat;
      if (d === reg) break;
      const i = d.indexOf('.');
      if (i === -1) break;
      d = d.slice(i + 1);
    }
    return null;
  }
}

module.exports = { Blocker };
