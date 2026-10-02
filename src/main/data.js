'use strict';
const path = require('path');
const { Store } = require('./store');

class History {
  constructor(dir) {
    this.store = new Store(path.join(dir, 'history.json'), { items: [] });
    this.items = this.store.data.items; // [{url,title,visits,last,first}]
    this.index = new Map(this.items.map((i) => [i.url, i]));
    this.max = 10000;
  }
  add(url, title) {
    if (!/^https?:/.test(url)) return;
    let it = this.index.get(url);
    const now = Date.now();
    if (it) { it.visits++; it.last = now; if (title) it.title = title; }
    else {
      it = { url, title: title || '', visits: 1, first: now, last: now };
      this.items.push(it); this.index.set(url, it);
      if (this.items.length > this.max) this.prune();
    }
    this.store.save();
  }
  setTitle(url, title) {
    const it = this.index.get(url);
    if (it && title) { it.title = title; this.store.save(); }
  }
  prune() {
    this.items.sort((a, b) => b.last - a.last);
    for (const d of this.items.splice(Math.floor(this.max * 0.9))) this.index.delete(d.url);
  }
  score(it, now = Date.now()) {
    const ageDays = (now - it.last) / 864e5;
    return Math.log2(it.visits + 1) * 10 / (1 + ageDays / 7);
  }
  top(n = 8) {
    const hosts = new Set(); const out = [];
    for (const it of [...this.items].sort((a, b) => this.score(b) - this.score(a))) {
      let h; try { h = new URL(it.url).hostname; } catch { continue; }
      if (hosts.has(h)) continue;
      hosts.add(h); out.push(it);
      if (out.length >= n) break;
    }
    return out;
  }
  search(q, limit = 200) {
    q = (q || '').toLowerCase();
    const res = [];
    for (const it of [...this.items].sort((a, b) => b.last - a.last)) {
      if (!q || it.url.toLowerCase().includes(q) || (it.title || '').toLowerCase().includes(q)) {
        res.push(it);
        if (res.length >= limit) break;
      }
    }
    return res;
  }
  remove(url) {
    if (this.index.delete(url)) {
      const i = this.items.findIndex((x) => x.url === url);
      if (i !== -1) this.items.splice(i, 1);
      this.store.save();
    }
  }
  clear(sinceMs = 0) {
    const cutoff = sinceMs ? Date.now() - sinceMs : Infinity;
    const keep = sinceMs ? this.items.filter((i) => i.last < cutoff) : [];
    this.items.length = 0; this.items.push(...keep);
    this.index = new Map(this.items.map((i) => [i.url, i]));
    this.store.save();
  }
}

class Bookmarks {
  constructor(dir) {
    this.store = new Store(path.join(dir, 'bookmarks.json'), { items: [] });
    this.items = this.store.data.items; // [{id,title,url,added}]
  }
  has(url) { return this.items.some((b) => b.url === url); }
  add(url, title) {
    if (!url || this.has(url)) return;
    this.items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: title || url, url, added: Date.now() });
    this.store.save();
  }
  remove(idOrUrl) {
    const i = this.items.findIndex((b) => b.id === idOrUrl || b.url === idOrUrl);
    if (i !== -1) { this.items.splice(i, 1); this.store.save(); }
  }
  toggle(url, title) { if (this.has(url)) this.remove(url); else this.add(url, title); return this.has(url); }
  rename(id, title) { const b = this.items.find((x) => x.id === id); if (b) { b.title = title; this.store.save(); } }
  move(id, toIndex) {
    const i = this.items.findIndex((b) => b.id === id);
    if (i === -1) return;
    const [b] = this.items.splice(i, 1);
    this.items.splice(Math.max(0, Math.min(toIndex, this.items.length)), 0, b);
    this.store.save();
  }
  exportHtml() {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
      this.items.map((b) => `    <DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.floor(b.added / 1000)}">${esc(b.title)}</A>`).join('\n') + '\n</DL><p>\n';
  }
  importHtml(html) {
    let n = 0;
    const re = /<A\s[^>]*HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi;
    let m;
    const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    while ((m = re.exec(html))) {
      const url = unesc(m[1]);
      if (/^https?:/i.test(url) && !this.has(url)) { this.add(url, unesc(m[2]).trim() || url); n++; }
    }
    return n;
  }
}

class Stats {
  constructor(dir) {
    this.store = new Store(path.join(dir, 'stats.json'), { ads: 0, trackers: 0, upgrades: 0, params: 0, bounces: 0, since: Date.now() });
  }
  bump(k) { this.store.data[k] = (this.store.data[k] || 0) + 1; this.store.save(); }
  get all() { return this.store.data; }
}

module.exports = { History, Bookmarks, Stats };
