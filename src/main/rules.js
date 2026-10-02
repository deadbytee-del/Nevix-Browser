'use strict';
// Network filtering engine.
//
// Rule sources: bundled lists, optional downloaded lists (EasyList, EasyPrivacy, hosts files…) and the user's custom
// rules. Everything is compiled once into indexed structures so a request costs a handful of Map lookups:
//
//   * domain table   — `||example.com^` and hosts-file entries, matched by walking the host's suffixes
//   * path table     — `||example.com/path` prefixes, keyed by host
//   * token index    — every other URL pattern is filed under its rarest literal token; a request is tokenised and only
//                      the rules filed under its tokens are tested (the approach used by uBlock Origin / Brave)
//   * fallback list  — the few rules with no usable token
//
// Actions: block, allow (exceptions, `@@`), isolate (request goes through, but without cookies or referrer).
// Every decision carries the list and rule that produced it, so the privacy dashboard can explain it.
const fs = require('fs');
const { registrable } = require('./domain');

const TYPE_BITS = {
  mainFrame: 1, subFrame: 2, stylesheet: 4, script: 8, image: 16, font: 32, object: 64, xhr: 128, ping: 256,
  media: 512, webSocket: 1024, other: 2048, cspReport: 4096,
};
const ABP_TYPES = {
  document: 'mainFrame', subdocument: 'subFrame', stylesheet: 'stylesheet', script: 'script', image: 'image', font: 'font',
  object: 'object', xmlhttprequest: 'xhr', ping: 'ping', media: 'media', websocket: 'webSocket', other: 'other',
};
const ALL_SUBRESOURCE = 0xffff & ~TYPE_BITS.mainFrame;

const MAX_URL_TOKENS = 48;
const tokenize = (s) => {
  const out = new Set();
  for (const t of s.toLowerCase().split(/[^a-z0-9]+/)) if (t.length >= 3 && out.size < MAX_URL_TOKENS) out.add(t);
  return out;
};

/** Pick the longest literal run of the pattern that is safe to use as an index key. */
function pickToken(pattern) {
  let best = '';
  const re = /[a-z0-9]{3,}/gi;
  let m;
  while ((m = re.exec(pattern))) {
    const before = pattern[m.index - 1];
    const after = pattern[m.index + m[0].length];
    // A run touching a wildcard (or the open edge of an unanchored pattern) could be part of a longer URL token.
    if (before === '*' || after === '*') continue;
    if (before === undefined && !pattern.startsWith('||') && !pattern.startsWith('|')) continue;
    if (after === undefined && !pattern.endsWith('|')) continue;
    if (m[0].length > best.length) best = m[0];
  }
  return best.toLowerCase();
}

function toRegex(p) {
  let src = p;
  let start = '', end = '';
  if (src.startsWith('||')) { start = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#]*\\.)?'; src = src.slice(2); }
  else if (src.startsWith('|')) { start = '^'; src = src.slice(1); }
  if (src.endsWith('|')) { end = '$'; src = src.slice(0, -1); }
  src = src.replace(/[.+?${}()[\]\\/]/g, '\\$&').replace(/\*+/g, '.*').replace(/\^/g, '(?:[^\\w\\-.%]|$)');
  try { return new RegExp(start + src + end, 'i'); } catch { return null; }
}

class Rules {
  /** @param {{thirdPartyOnly?: boolean}} opts bundled lists only ever act on third parties; custom rules may hit anything */
  constructor(opts = {}) {
    this.thirdPartyOnly = opts.thirdPartyOnly !== false;
    this.reset();
  }

  reset() {
    this.domains = new Map();        // host -> { c, l, a }  (a = action)
    this.allowDomains = new Map();   // host -> list idx
    this.paths = new Map();          // host -> [{ p, c, l, a }]
    this.tokens = new Map();         // token -> [rule]
    this.fallback = [];
    this.exTokens = new Map();       // exceptions (allow) by token
    this.exFallback = [];
    this.count = 0;
    this.lists = new Map();          // id -> { name, count }
    this.listNames = [];             // index -> id (rules store the index)
  }

  listIndex(id) {
    let i = this.listNames.indexOf(id);
    if (i === -1) { i = this.listNames.length; this.listNames.push(id); }
    return i;
  }

  // ---- parsing ------------------------------------------------------------------------------------------
  /**
   * @param {string} text  list contents
   * @param {object} opts  { category, listId, name, custom }  custom lists accept `block|allow|isolate <rule>` prefixes
   */
  load(text, opts = {}) {
    const { listId = 'list', custom = false } = opts;
    let category = opts.category || 'trackers';
    const li = this.listIndex(listId);
    let added = 0;
    for (let raw of text.split(/\r?\n/)) {
      let line = raw.trim();
      if (!line) continue;
      const cat = /^!#category\s+(\w+)/.exec(line);
      if (cat) { category = cat[1]; continue; }
      if (line[0] === '#' || line[0] === '!' || line[0] === '[') continue;
      if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) continue;
      added += this.addLine(line, category, li, custom);
    }
    this.count += added;
    const prev = this.lists.get(listId);
    this.lists.set(listId, { name: opts.name || listId, count: (prev && opts.append ? prev.count : 0) + added });
    return added;
  }

  /** Same as load() but yields to the event loop so a 100k-rule list never blocks the UI. */
  async loadAsync(text, opts = {}) {
    const lines = text.split(/\r?\n/);
    const CH = 4000;
    let added = 0;
    const o = { ...opts, append: true };
    this.lists.delete(opts.listId);
    for (let i = 0; i < lines.length; i += CH) {
      added += this.load(lines.slice(i, i + CH).join('\n'), o);
      await new Promise((r) => setImmediate(r));
    }
    return added;
  }

  loadFile(file, opts) {
    try { return this.load(fs.readFileSync(file, 'utf8'), opts); } catch { return 0; }
  }

  addLine(line, category, li, custom) {
    let m;
    let action = 'block';
    if (custom) {
      m = /^(block|allow|isolate)\s+(\S.*)$/i.exec(line);
      if (m) { action = m[1].toLowerCase(); line = m[2]; if (action === 'allow') line = '@@' + line.replace(/^@@/, ''); }
    }
    // hosts file
    if ((m = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+([^\s#]+)/.exec(line))) {
      if (m[1] !== 'localhost' && m[1].includes('.')) { this.addDomain(m[1].toLowerCase(), category, li, action); return 1; }
      return 0;
    }
    let exception = false;
    if (line.startsWith('@@')) { exception = true; line = line.slice(2); }
    // options
    let opts = '';
    const di = line.lastIndexOf('$');
    if (di > 0 && /^[~a-z0-9_,=|.\-]+$/i.test(line.slice(di + 1))) { opts = line.slice(di + 1); line = line.slice(0, di); }
    const o = this.parseOptions(opts);
    if (o === null) return 0;                    // unsupported option → skip rather than mis-block
    if (!line) return 0;
    let pattern = line;

    const simple = !o.types && o.tp === -1 && !o.dom && !o.important;
    // `||host^` fast path
    if ((m = /^\|\|([a-z0-9.-]+)\^?$/i.exec(pattern)) && m[1].includes('.')) {
      const host = m[1].toLowerCase();
      if (simple || (o.tp === 1 && !o.types && !o.dom)) {
        if (exception) this.allowDomains.set(host, li); else this.addDomain(host, category, li, action);
        return 1;
      }
    }
    // `||host/path` prefix fast path (no wildcards)
    if ((m = /^\|\|([a-z0-9.-]+)(\/[^*^|]*)\^?$/i.exec(pattern)) && simple && !exception) {
      const host = m[1].toLowerCase();
      if (!this.paths.has(host)) this.paths.set(host, []);
      this.paths.get(host).push({ p: m[2], c: category, l: li, a: action, src: line });
      return 1;
    }
    if (pattern.length < 4 && !pattern.includes('.')) return 0;
    const rule = { pattern, re: null, types: o.types, tp: o.tp, dom: o.dom, important: o.important, c: category, l: li, a: exception ? 'allow' : action, src: ruleText(line, opts) };
    const token = pickToken(pattern.toLowerCase());
    const [idx, fb] = exception ? [this.exTokens, this.exFallback] : [this.tokens, this.fallback];
    if (token) { if (!idx.has(token)) idx.set(token, []); idx.get(token).push(rule); }
    else if (fb.length < 4000) fb.push(rule);
    else return 0;
    return 1;
  }

  addDomain(host, category, li, action) {
    const cur = this.domains.get(host);
    if (!cur) this.domains.set(host, { c: category, l: li, a: action });
  }

  parseOptions(str) {
    const o = { types: 0, tp: -1, dom: null, important: false };
    if (!str) return { types: 0, tp: -1, dom: null, important: false };
    let neg = 0;
    for (const part of str.split(',')) {
      const p = part.trim().toLowerCase();
      if (!p) continue;
      if (p === 'third-party' || p === '3p') o.tp = 1;
      else if (p === '~third-party' || p === '1p' || p === 'first-party') o.tp = 0;
      else if (p === 'important') o.important = true;
      else if (p === 'all') o.types = 0;
      else if (p.startsWith('domain=')) {
        const inc = new Set(), exc = new Set();
        for (const d of p.slice(7).split('|')) { if (d.startsWith('~')) exc.add(d.slice(1)); else if (d) inc.add(d); }
        o.dom = { inc, exc };
      } else if (ABP_TYPES[p.replace(/^~/, '')]) {
        const bit = TYPE_BITS[ABP_TYPES[p.replace(/^~/, '')]];
        if (p[0] === '~') neg |= bit; else o.types |= bit;
      } else if (p === 'match-case' || p === 'badfilter' || p === 'redirect' || p.startsWith('redirect=') || p.startsWith('removeparam') || p.startsWith('csp') ||
                 p === 'popup' || p === 'generichide' || p === 'elemhide' || p === 'specifichide' || p === 'inline-script' || p === 'denyallow' || p.startsWith('denyallow=')) {
        return null;
      } else { return null; }
    }
    if (neg && !o.types) o.types = ALL_SUBRESOURCE & ~neg;
    return o;
  }

  // ---- matching -----------------------------------------------------------------------------------------
  /**
   * @param {{url:string, host:string, path:string, topHost:string, type:string}} q
   * @returns {null | {action:'block'|'isolate'|'allow', category:string, list:string, rule:string}}
   */
  check(q) {
    const host = q.host;
    if (!host) return null;
    const reg = registrable(host);
    const topReg = q.topHost ? registrable(q.topHost) : '';
    const third = !!topReg && reg !== topReg;
    if (this.thirdPartyOnly && !third) return null;          // bundled lists only ever act on third parties
    const bit = TYPE_BITS[q.type] || TYPE_BITS.other;

    let hit = null;
    // 1) domain table
    for (let d = host; ; ) {
      const e = this.domains.get(d);
      if (e) { hit = { action: e.a, category: e.c, l: e.l, rule: '||' + d + '^' }; break; }
      if (d === reg) break;
      const i = d.indexOf('.');
      if (i === -1) break;
      d = d.slice(i + 1);
    }
    // 2) path prefixes
    if (!hit && this.paths.size) {
      for (let d = host; ; ) {
        const pr = this.paths.get(d);
        if (pr) { for (const r of pr) if (q.path.startsWith(r.p)) { hit = { action: r.a, category: r.c, l: r.l, rule: r.src }; break; } }
        if (hit || d === reg) break;
        const i = d.indexOf('.');
        if (i === -1) break;
        d = d.slice(i + 1);
      }
    }
    // 3) token index
    if (!hit) {
      const tokens = tokenize(q.url);
      for (const t of tokens) {
        const rs = this.tokens.get(t);
        if (rs) { for (const r of rs) if (this.ruleMatches(r, q, bit, third, topReg)) { hit = { action: r.a, category: r.c, l: r.l, rule: r.src, important: r.important }; break; } }
        if (hit) break;
      }
      if (!hit) for (const r of this.fallback) if (this.ruleMatches(r, q, bit, third, topReg)) { hit = { action: r.a, category: r.c, l: r.l, rule: r.src, important: r.important }; break; }
    }
    if (!hit) return null;
    if (hit.action === 'allow') return { action: 'allow', category: hit.category, list: this.listNames[hit.l], rule: hit.rule };
    if (!hit.important) {
      const ex = this.exception(q, hit.category);
      if (ex) return ex;
    }
    return { action: hit.action, category: hit.category, list: this.listNames[hit.l], rule: hit.rule };
  }

  /** Does an exception (`@@`) rule in THIS rule set cover the request? Used by check() and by RuleSet to let custom exceptions beat bundled blocks. */
  exception(q, category = 'trackers') {
    const host = q.host;
    const reg = registrable(host);
    const topReg = q.topHost ? registrable(q.topHost) : '';
    const third = !!topReg && reg !== topReg;
    const bit = TYPE_BITS[q.type] || TYPE_BITS.other;
    for (let d = host; ; ) {
      const ai = this.allowDomains.get(d);
      if (ai !== undefined) return { action: 'allow', category, list: this.listNames[ai], rule: '@@||' + d + '^' };
      if (d === reg) break;
      const i = d.indexOf('.');
      if (i === -1) break;
      d = d.slice(i + 1);
    }
    if (this.exTokens.size || this.exFallback.length) {
      for (const t of tokenize(q.url)) {
        const rs = this.exTokens.get(t);
        if (rs) for (const r of rs) if (this.ruleMatches(r, q, bit, third, topReg)) return { action: 'allow', category, list: this.listNames[r.l], rule: '@@' + r.src };
      }
      for (const r of this.exFallback) if (this.ruleMatches(r, q, bit, third, topReg)) return { action: 'allow', category, list: this.listNames[r.l], rule: '@@' + r.src };
    }
    return null;
  }

  ruleMatches(r, q, bit, third, topReg) {
    if (r.types && !(r.types & bit)) return false;
    if (r.tp === 1 && !third) return false;
    if (r.tp === 0 && third) return false;
    if (r.dom) {
      const top = q.topHost || '';
      const inSet = (set) => { for (let d = top; d; ) { if (set.has(d)) return true; const i = d.indexOf('.'); if (i === -1) break; d = d.slice(i + 1); } return false; };
      if (r.dom.exc.size && inSet(r.dom.exc)) return false;
      if (r.dom.inc.size && !inSet(r.dom.inc)) return false;
    }
    if (!r.re) { r.re = toRegex(r.pattern) || /(?!)/; }
    return r.re.test(q.url);
  }
}

/** Human-readable rule text shown in the dashboard. */
function ruleText(line, opts) { return opts ? `${line}$${opts}` : line; }

module.exports = { Rules, TYPE_BITS, tokenize, pickToken };
