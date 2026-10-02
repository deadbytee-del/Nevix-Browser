'use strict';
// Address-bar logic: turn input into a URL, and compute suggestions entirely from local data.
//
// Suggestion types: search | url | calc | convert | tab | bookmark | history | command | workspace | setting
// Prefix forms:  "tabs github"   "workspace work"   "settings privacy"   ">clear"   "128 * 64"   "12 km in miles"
const { SEARCH_ENGINES, KEYWORDS } = require('./defaults');
const { tryCalc } = require('./calc');
const { tryConvert } = require('./units');
const { hostOf } = require('./domain');

const HOSTLIKE = /^(localhost|(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d{1,5})?(?:[/?#].*)?$/i;
const ALIASES = {
  'about:blank': 'about:blank',
  'about:newtab': 'nevix://newtab', 'about:settings': 'nevix://settings', 'about:history': 'nevix://history',
  'about:bookmarks': 'nevix://bookmarks', 'about:downloads': 'nevix://downloads', 'about:privacy': 'nevix://privacy',
  'about:flags': 'nevix://flags', 'about:performance': 'nevix://performance', 'about:extensions': 'nevix://extensions',
  'about:about': 'nevix://about', 'about:version': 'nevix://about',
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

const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);
const matchesAll = (hay, ws) => { const h = hay.toLowerCase(); return ws.every((w) => h.includes(w)); };

/**
 * @param {string} q
 * @param {object} ctx { history, bookmarks, settings, tabs[], windows, commands, spaces, win, flags }
 */
function suggest(q, ctx) {
  q = (q || '').trim();
  const out = [];
  const seen = new Set();
  const push = (s) => { const k = s.type + '|' + (s.url || s.cmd || s.value || s.title) + '|' + (s.arg ? JSON.stringify(s.arg) : ''); if (!seen.has(k)) { seen.add(k); out.push(s); } };
  if (!q) return out;
  const ql = q.toLowerCase();

  // --- instant, offline answers ---------------------------------------------------------------------------
  const conv = tryConvert(q);
  if (conv) push({ type: 'convert', title: conv.display, sub: conv.from + ' =', value: conv.display });
  else {
    const calc = tryCalc(q);
    if (calc) push({ type: 'calc', title: calc.display, sub: q + ' =', value: calc.display });
  }

  // --- prefixed providers ---------------------------------------------------------------------------------
  const m = /^(tabs?|workspaces?|ws|settings?|prefs|history|bookmarks?|bm|commands?|cmd)\s+(.*)$/i.exec(q) || /^>\s*(.*)$/.exec(q);
  let kind = null, arg = '';
  if (m) {
    if (q[0] === '>') { kind = 'command'; arg = m[1]; }
    else { const k = m[1].toLowerCase(); kind = /^tab/.test(k) ? 'tabs' : /^(workspace|ws)/.test(k) ? 'workspace' : /^(setting|pref)/.test(k) ? 'settings' : /^history/.test(k) ? 'history' : /^(bookmark|bm)/.test(k) ? 'bookmarks' : 'command'; arg = m[2]; }
  } else if (/^(tabs?|workspaces?|ws|settings?|commands?)$/i.test(q)) {
    const k = q.toLowerCase();
    kind = /^tab/.test(k) ? 'tabs' : /^(workspace|ws)/.test(k) ? 'workspace' : /^setting/.test(k) ? 'settings' : 'command'; arg = '';
  }
  const ws = words(arg);

  if (kind === 'tabs') {
    for (const t of ctx.tabs) if (!ws.length || matchesAll(t.title + ' ' + t.url, ws)) push({ type: 'tab', title: t.title || t.url, url: t.url, tabId: t.id, winId: t.win });
  } else if (kind === 'workspace' && ctx.spaces && ctx.flags.on('nevix-enable-workspaces')) {
    for (const w of ctx.spaces.listWorkspaces()) if (!ws.length || matchesAll(w.name, ws)) push({ type: 'workspace', title: w.name, sub: `${w.tabs.length} tabs`, arg: { id: w.id } });
  } else if (kind === 'settings') {
    const { SCHEMA } = require('./settings-schema');
    for (const s of SCHEMA) if ((s.title) && (!ws.length || matchesAll(s.title + ' ' + s.category + ' ' + (s.description || ''), ws))) {
      push({ type: 'setting', title: s.title, sub: s.category, url: `nevix://settings?s=${encodeURIComponent(s.key || s.action || s.title)}#${s.category}` });
      if (out.length > 9) break;
    }
  } else if (kind === 'command') {
    for (const c of ctx.commands.describe({ forPalette: true })) if (!ws.length || matchesAll(c.title + ' ' + c.category, ws)) { push({ type: 'command', title: c.title, sub: c.shortcuts[0] || c.category, cmd: c.id, pick: c.pick }); if (out.length > 9) break; }
  } else if (kind === 'history') {
    for (const it of ctx.history.search(arg, 8)) push({ type: 'history', title: it.title || it.url, url: it.url });
  } else if (kind === 'bookmarks') {
    for (const b of ctx.bookmarks.items) if (!ws.length || matchesAll(b.title + ' ' + b.url, ws)) push({ type: 'bookmark', title: b.title, url: b.url });
  }
  if (kind) return out.slice(0, 10);

  // --- the default: go / search, then local data ------------------------------------------------------------
  const first = resolveInput(q, ctx.settings);
  const searchBase = engineUrl(ctx.settings, 'x').split('?')[0];
  const isUrl = first.startsWith('http') && !first.startsWith(searchBase) && !first.includes('/search?') ? true : /^(nevix|file):/.test(first);
  if (!out.length || !(out[0].type === 'calc' || out[0].type === 'convert')) push({ type: isUrl ? 'url' : 'search', title: isUrl ? q : `Search for “${q}”`, url: first });
  else push({ type: 'search', title: `Search for “${q}”`, url: first });

  const hit = (url, title) => url.toLowerCase().includes(ql) || (title || '').toLowerCase().includes(ql);
  for (const t of ctx.tabs) if (hit(t.url, t.title)) push({ type: 'tab', title: t.title || t.url, url: t.url, tabId: t.id, winId: t.win });
  for (const b of ctx.bookmarks.items) if (hit(b.url, b.title)) push({ type: 'bookmark', title: b.title, url: b.url });
  const scored = [];
  for (const it of ctx.history.items) {
    if (!hit(it.url, it.title)) continue;
    let s = ctx.history.score(it);
    const bare = it.url.replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
    if (bare.startsWith(ql)) s += 25;
    scored.push([s, it]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  for (const [, it] of scored.slice(0, 5)) push({ type: 'history', title: it.title || it.url, url: it.url });
  // A couple of matching commands (so "clear site" finds the command) — only when the text looks like words.
  if (ql.length >= 3 && /^[a-z ]+$/.test(ql)) {
    let n = 0;
    for (const c of ctx.commands.describe({ forPalette: true })) {
      if (c.title.toLowerCase().startsWith(ql) || (ws.length > 1 && matchesAll(c.title, words(ql)))) { push({ type: 'command', title: c.title, sub: c.shortcuts[0] || c.category, cmd: c.id, pick: c.pick }); if (++n >= 2) break; }
    }
  }
  return out.slice(0, 10);
}

module.exports = { resolveInput, suggest, engineUrl };
