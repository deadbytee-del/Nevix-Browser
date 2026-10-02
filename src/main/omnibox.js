'use strict';
const { SEARCH_ENGINES, KEYWORDS } = require('./defaults');

const HOSTLIKE = /^(localhost|(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d{1,5})?(?:[/?#].*)?$/i;
const ALIASES = {
  'about:blank': 'about:blank',
  'about:newtab': 'nevix://newtab', 'about:settings': 'nevix://settings', 'about:history': 'nevix://history',
  'about:bookmarks': 'nevix://bookmarks', 'about:downloads': 'nevix://downloads', 'about:privacy': 'nevix://settings#privacy',
};

function engineUrl(settings, q) {
  const g = settings.get('general');
  const eng = SEARCH_ENGINES[g.searchEngine] || SEARCH_ENGINES.duckduckgo;
  let tpl = g.searchEngine === 'custom' ? g.customSearchUrl : eng.url;
  if (!tpl || !tpl.includes('%s')) tpl = SEARCH_ENGINES.duckduckgo.url;
  return tpl.replace('%s', encodeURIComponent(q));
}

/** Turn whatever the user typed into a loadable URL. */
function resolveInput(text, settings) {
  text = (text || '').trim();
  if (!text) return 'nevix://newtab';
  const lower = text.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  if (/^(javascript|vbscript):/i.test(text)) return engineUrl(settings, text);
  if (/^(https?|file|nevix|view-source|ftp):/i.test(text)) return text;
  if (/^data:text\/html/i.test(text)) return text;

  // keyword shortcuts: "w cats", "yt lofi", "ddg foo"
  const sp = text.indexOf(' ');
  if (sp > 0) {
    const kw = text.slice(0, sp).toLowerCase();
    const rest = text.slice(sp + 1).trim();
    if (rest) {
      if (KEYWORDS[kw]) return KEYWORDS[kw].replace('%s', encodeURIComponent(rest));
      for (const e of Object.values(SEARCH_ENGINES)) {
        if (e.keyword === kw && e.url) return e.url.replace('%s', encodeURIComponent(rest));
      }
    }
  }
  if (!/\s/.test(text) && HOSTLIKE.test(text)) {
    const local = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[)/i.test(text);
    return (local ? 'http://' : 'https://') + text;
  }
  return engineUrl(settings, text);
}

function suggest(q, { history, bookmarks, tabs, settings }) {
  q = (q || '').trim();
  const out = [];
  const seen = new Set();
  const push = (s) => { const k = s.type + s.url; if (!seen.has(k)) { seen.add(k); out.push(s); } };
  if (!q) return out;
  const ql = q.toLowerCase();
  const hit = (url, title) => url.toLowerCase().includes(ql) || (title || '').toLowerCase().includes(ql);

  const first = resolveInput(q, settings);
  const isUrl = first.startsWith('http') && !first.startsWith(engineUrl(settings, q).split('?')[0]);
  push({ type: isUrl ? 'url' : 'search', title: isUrl ? q : `Search for “${q}”`, url: first });

  for (const t of tabs) if (hit(t.url, t.title)) push({ type: 'tab', title: t.title || t.url, url: t.url, tabId: t.id });
  for (const b of bookmarks.items) if (hit(b.url, b.title)) push({ type: 'bookmark', title: b.title, url: b.url });
  const scored = [];
  for (const it of history.items) {
    if (!hit(it.url, it.title)) continue;
    let s = history.score(it);
    const bare = it.url.replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
    if (bare.startsWith(ql)) s += 25;
    scored.push([s, it]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  for (const [, it] of scored.slice(0, 6)) push({ type: 'history', title: it.title || it.url, url: it.url });
  if (isUrl === false && out.length < 2) { /* search entry already present */ }
  return out.slice(0, 9);
}

module.exports = { resolveInput, suggest, engineUrl };
