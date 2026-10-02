'use strict';
// Reader mode: injected into the page, extracts the main article and shows it in a clean overlay.
// Toggling again removes the overlay. Content is rebuilt through a strict allow-list (no scripts,
// no attributes except href/src/alt) so it can't carry anything active.
const READER_SCRIPT = `(() => {
  const ID = '__nevix_reader__';
  const old = document.getElementById(ID);
  if (old) { old.remove(); document.documentElement.style.overflow = ''; return 'off'; }
  const clean = (n) => (n.textContent || '').replace(/\\s+/g, ' ').trim();
  const bad = /comment|footer|sidebar|nav|menu|promo|social|share|related|advert|banner|cookie|popup|modal/i;
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
      if (tag === 'IMG') { const s = c.currentSrc || c.src; if (!s || !/^https?:/.test(s)) continue; e.setAttribute('src', s); e.setAttribute('alt', c.alt || ''); e.loading = 'lazy'; e.referrerPolicy = 'no-referrer'; }
      build(c, e);
      dst.appendChild(e);
    }
  };
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;';
  const root = host.attachShadow({ mode: 'closed' });
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const st = document.createElement('style');
  st.textContent = \`
    :host{all:initial}
    .wrap{min-height:100%;background:\${dark ? '#15151b' : '#faf8f4'};color:\${dark ? '#dcdce4' : '#26262c'};font:19px/1.7 Georgia,'Iowan Old Style',serif}
    article{max-width:700px;margin:0 auto;padding:64px 24px 120px}
    h1{font:700 2.1em/1.2 system-ui,sans-serif;margin:0 0 .4em}
    h2,h3,h4{font-family:system-ui,sans-serif;line-height:1.3;margin:1.6em 0 .5em}
    img{max-width:100%;height:auto;border-radius:8px;margin:1em auto;display:block}
    a{color:\${dark ? '#9d8fff' : '#5b45e6'}}
    pre{overflow:auto;background:\${dark ? '#1e1e26' : '#eee9e0'};padding:14px;border-radius:8px;font-size:15px}
    blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #8b7cff;opacity:.85}
    .bar{position:fixed;top:12px;right:16px;display:flex;gap:6px;font:13px system-ui}
    .bar button{border:0;border-radius:8px;padding:8px 12px;cursor:pointer;background:\${dark ? '#2a2a35' : '#e7e2d8'};color:inherit}
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
  build(best, art);
  wrap.append(bar, art); root.append(st, wrap);
  document.documentElement.appendChild(host);
  document.documentElement.style.overflow = 'hidden';
  return 'on';
})()`;
module.exports = { READER_SCRIPT };
