'use strict';
const { DARK, LIGHT } = require('./theme');
// Reader mode: injected into the page, extracts the main article and shows it in a clean overlay.
// Toggling again removes the overlay. Content is rebuilt through a strict allow-list (no scripts,
// no attributes except href/src/alt) so it can't carry anything active.
const READER_SCRIPT = `(() => {
  const T = { dark: ${JSON.stringify(DARK)}, light: ${JSON.stringify(LIGHT)} };
  const ID = '__nevix_reader__';
  let BYLINE = '';
  const old = document.getElementById(ID);
  if (old) { old.remove(); document.documentElement.style.overflow = ''; return 'off'; }
  const clean = (n) => (n.textContent || '').replace(/\\s+/g, ' ').trim();
  const bad = /comment|footer|sidebar|nav|menu|promo|social|share|related|advert|banner|cookie|popup|modal/i;
  /*PICK*/
  let best = null, bestScore = 0;
  const candidates = document.querySelectorAll('article, main, [role=main], section, div');
  for (const el of candidates) {
    if (bad.test(el.className + ' ' + el.id)) continue;
    let score = 0;
    for (const p of el.querySelectorAll(':scope > p, :scope > div > p, :scope > section > p')) {
      const len = clean(p).length;
      if (len > 60) score += Math.min(len, 400);
    }
    if (el.tagName === 'ARTICLE') score *= 1.3;
    if (score > bestScore) { bestScore = score; best = el; }
  }
  if (!best || bestScore < 200) return 'unsupported';
  const title = (document.querySelector('h1') || {}).textContent || document.title;
  /*ENDPICK*/
  const ALLOW = new Set(['P','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','PRE','CODE','EM','STRONG','B','I','A','IMG','FIGURE','FIGCAPTION','BR','HR','TABLE','THEAD','TBODY','TR','TD','TH','SUB','SUP']);
  const build = (src, dst) => {
    for (const c of src.childNodes) {
      if (c.nodeType === 3) { dst.appendChild(document.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName;
      if (tag === 'H1' && clean(c) === title.trim()) continue; // the title is rendered separately
      if (bad.test(c.className + ' ' + c.id) && tag !== 'FIGURE') continue;
      if (!ALLOW.has(tag)) { if (!/^(SCRIPT|STYLE|IFRAME|FORM|NAV|ASIDE|FOOTER|HEADER|BUTTON|INPUT|SVG|NOSCRIPT)$/.test(tag)) build(c, dst); continue; }
      const e = document.createElement(tag.toLowerCase());
      if (tag === 'A') { const h = c.getAttribute('href'); if (h && /^https?:|^\\//.test(h)) e.setAttribute('href', new URL(h, location.href).href); e.rel = 'noreferrer noopener'; }
      if (tag === 'IMG') { const s = c.currentSrc || c.src || c.getAttribute('data-src') || c.getAttribute('data-lazy-src') || c.getAttribute('data-original'); if (!s || !/^https?:/.test(s)) continue; e.setAttribute('src', s); e.setAttribute('alt', c.alt || ''); e.loading = 'lazy'; e.referrerPolicy = 'no-referrer'; }
      build(c, e);
      dst.appendChild(e);
    }
  };
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;';
  const root = host.attachShadow({ mode: 'closed' });
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const P = dark ? T.dark : T.light;
  const st = document.createElement('style');
  st.textContent = \`
    :host{all:initial}
    .wrap{min-height:100%;background:\${P['color-background']};color:\${P['color-text']};font:19px/1.7 Georgia,'Iowan Old Style',serif}
    article{max-width:700px;margin:0 auto;padding:64px 24px 120px}
    h1{font:700 2.1em/1.2 system-ui,sans-serif;margin:0 0 .4em}
    h2,h3,h4{font-family:system-ui,sans-serif;line-height:1.3;margin:1.6em 0 .5em}
    img{max-width:100%;height:auto;margin:1em auto;display:block}
    a{color:\${P['color-primary-text']}}
    pre{overflow:auto;background:\${P['color-surface']};padding:14px;border-radius:4px;font-size:15px}
    blockquote{margin:1em 0;padding-left:1em;border-left:3px solid \${P['color-primary']};opacity:.85}
    .bar{position:fixed;top:12px;right:16px;display:flex;gap:6px;font:13px system-ui}
    .bar button{border:1px solid \${P['color-border']};border-radius:4px;padding:7px 12px;cursor:pointer;background:\${P['color-surface-secondary']};color:inherit}
  \`;
  const wrap = document.createElement('div'); wrap.className = 'wrap';
  const bar = document.createElement('div'); bar.className = 'bar';
  let size = 19;
  const mk = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; bar.appendChild(b); };
  mk('A−', () => { size = Math.max(14, size - 1); wrap.style.fontSize = size + 'px'; });
  mk('A+', () => { size = Math.min(32, size + 1); wrap.style.fontSize = size + 'px'; });
  mk('Close', () => { host.remove(); document.documentElement.style.overflow = ''; });
  const art = document.createElement('article');
  const h1 = document.createElement('h1'); h1.textContent = title.trim(); art.appendChild(h1);
  if (typeof BYLINE !== 'undefined' && BYLINE) { const by = document.createElement('p'); by.style.cssText = 'font:14px system-ui,sans-serif;opacity:.7;margin:-.6em 0 1.6em'; by.textContent = BYLINE; art.appendChild(by); }
  build(best, art);
  wrap.append(bar, art); root.append(st, wrap);
  document.documentElement.appendChild(host);
  document.documentElement.style.overflow = 'hidden';
  return 'on';
})()`;

// v2: link-density scoring, byline/date detection. Used when the "Reader mode v2" flag is on.
const V2_PICK = `
  const POS = /article|content|post|entry|story|body|main|text|blog/i;
  const NEG = /comment|footer|sidebar|nav|menu|promo|social|share|related|advert|banner|cookie|popup|modal|widget|breadcrumb|pagination|newsletter|subscribe/i;
  const linkDensity = (el) => { const t = clean(el).length || 1; let l = 0; for (const a of el.querySelectorAll('a')) l += clean(a).length; return l / t; };
  let best = null, bestScore = 0;
  for (const el of document.querySelectorAll('article, main, [role=main], section, div')) {
    const id = el.className + ' ' + el.id;
    if (NEG.test(id) && !POS.test(id)) continue;
    const paras = el.querySelectorAll('p');
    if (paras.length < 2) continue;
    let text = 0;
    for (const p of paras) { const n = clean(p).length; if (n > 40) text += n; }
    let score = text * Math.pow(1 - Math.min(0.95, linkDensity(el)), 2);
    if (POS.test(id)) score *= 1.25;
    if (el.tagName === 'ARTICLE') score *= 1.3;
    // prefer the innermost container that still holds most of the text
    const depthPenalty = el.querySelectorAll('div').length * 2;
    score -= depthPenalty;
    if (score > bestScore) { bestScore = score; best = el; }
  }
  const meta = (n) => (document.querySelector('meta[property="' + n + '"], meta[name="' + n + '"]') || {}).content || '';
  const authorEl = document.querySelector('[rel=author], .byline, .author, [itemprop=author]');
  const timeEl = document.querySelector('time[datetime]');
  const when = timeEl ? new Date(timeEl.getAttribute('datetime')) : (meta('article:published_time') ? new Date(meta('article:published_time')) : null);
  BYLINE = [meta('author') || (authorEl ? clean(authorEl).slice(0, 80) : ''), when && !isNaN(when) ? when.toLocaleDateString() : '', meta('og:site_name')].filter(Boolean).join(' · ');
  if (!best || bestScore < 150) return 'unsupported';
  const title = meta('og:title') || (document.querySelector('h1') || {}).textContent || document.title;
`;
const READER_SCRIPT_V2 = READER_SCRIPT.replace(/\/\*PICK\*\/[\s\S]*\/\*ENDPICK\*\//, V2_PICK);

module.exports = { READER_SCRIPT, READER_SCRIPT_V2 };
