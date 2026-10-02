'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Blocker } = require('../src/main/blocker');
const { registrable, isLocalHost } = require('../src/main/domain');
const { stripTracking } = require('../src/main/privacy');
const { resolveInput } = require('../src/main/omnibox');
const { Store } = require('../src/main/store');
const { History, Bookmarks } = require('../src/main/data');
const { SETTINGS } = require('../src/main/defaults');

let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; } };

t('registrable domain', () => {
  assert.strictEqual(registrable('a.b.example.com'), 'example.com');
  assert.strictEqual(registrable('www.bbc.co.uk'), 'bbc.co.uk');
  assert.strictEqual(registrable('user.github.io'), 'user.github.io');
  assert.strictEqual(registrable('foo.user.github.io'), 'user.github.io');
  assert.strictEqual(registrable('127.0.0.1'), '127.0.0.1');
});
t('local hosts', () => {
  for (const h of ['localhost', 'foo.localhost', '192.168.1.5', '10.0.0.2', 'printer', 'nas.local']) assert(isLocalHost(h), h);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1']) assert(!isLocalHost(h), h);
});
t('blocker: hosts, ABP domain, path, exceptions', () => {
  const b = new Blocker();
  b.loadText('# c\n0.0.0.0 ads.evil.com\n127.0.0.1 localhost\n||tracker.net^\n||cdn.thing.com/pixel/\n@@||ok.tracker.net^\n||narrow.com^$script\nplain.example.org\n! comment\nexample.com##.ad\n', 'ads');
  assert.strictEqual(b.match('ads.evil.com', '/x', 'site.com'), 'ads');
  assert.strictEqual(b.match('sub.ads.evil.com', '/x', 'site.com'), 'ads');
  assert.strictEqual(b.match('tracker.net', '/', 'site.com'), 'ads');
  assert.strictEqual(b.match('a.tracker.net', '/', 'site.com'), 'ads');
  assert.strictEqual(b.match('ok.tracker.net', '/', 'site.com'), null, 'exception');
  assert.strictEqual(b.match('cdn.thing.com', '/pixel/1.gif', 'site.com'), 'ads');
  assert.strictEqual(b.match('cdn.thing.com', '/lib.js', 'site.com'), null);
  assert.strictEqual(b.match('narrow.com', '/', 'site.com'), null, 'type-restricted rules are skipped');
  assert.strictEqual(b.match('plain.example.org', '/', 'site.com'), 'ads');
  assert.strictEqual(b.match('ads.evil.com', '/', 'evil.com'), null, 'first-party is never blocked');
  assert.strictEqual(b.match('notevil.com', '/', 'site.com'), null);
  assert.strictEqual(b.match('localhost', '/', 'site.com'), null);
});
t('bundled lists load and block well-known trackers', () => {
  const b = new Blocker();
  b.loadFile(path.join(__dirname, '../src/main/data/core-rules.txt'), 'trackers');
  b.loadFile(path.join(__dirname, '../src/main/data/pgl-hosts.txt'), 'ads');
  assert(b.size > 3000, 'size ' + b.size);
  for (const h of ['doubleclick.net', 'stats.g.doubleclick.net', 'www.google-analytics.com', 'connect.facebook.net']) {
    if (h === 'connect.facebook.net') { assert.strictEqual(b.match(h, '/en_US/sdk.js', 'news.com'), null, 'FB SDK (login) must not be blocked'); continue; }
    assert(b.match(h, '/', 'news.com'), h);
  }
  assert.strictEqual(b.match('connect.facebook.net', '/signals/config/1', 'news.com'), 'trackers');
  assert.strictEqual(b.match('www.google.com', '/pagead/1', 'news.com'), 'ads');
  assert.strictEqual(b.match('www.google.com', '/search', 'news.com'), null);
  assert.strictEqual(b.match('www.google-analytics.com', '/a.js', 'news.com'), 'trackers');
  assert.strictEqual(b.match('doubleclick.net', '/a.js', 'news.com'), 'ads');
  for (const h of ['wikipedia.org', 'github.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'cloudflare.com']) assert.strictEqual(b.match(h, '/', 'x.com'), null, h);
});
t('strip tracking params', () => {
  assert.strictEqual(stripTracking('https://a.com/p?utm_source=x&id=5&fbclid=abc'), 'https://a.com/p?id=5');
  assert.strictEqual(stripTracking('https://a.com/p?q=hello'), 'https://a.com/p?q=hello');
  assert.strictEqual(stripTracking('https://a.com/?gclid=1'), 'https://a.com/');
  assert.strictEqual(stripTracking('https://a.com/watch?v=1&si=zz'), 'https://a.com/watch?v=1&si=zz', 'si only stripped on share hosts');
  assert.strictEqual(stripTracking('https://youtu.be/abc?si=zz'), 'https://youtu.be/abc');
});
t('omnibox resolve', () => {
  const settings = new Store(path.join(os.tmpdir(), 'nx-unit-' + process.pid + '.json'), SETTINGS);
  assert.strictEqual(resolveInput('', settings), 'nevix://newtab');
  assert.strictEqual(resolveInput('example.com', settings), 'https://example.com');
  assert.strictEqual(resolveInput('localhost:3000/a', settings), 'http://localhost:3000/a');
  assert.strictEqual(resolveInput('192.168.1.1', settings), 'http://192.168.1.1');
  assert.strictEqual(resolveInput('http://x.org', settings), 'http://x.org');
  assert.strictEqual(resolveInput('about:settings', settings), 'nevix://settings');
  assert.strictEqual(resolveInput('hello world', settings), 'https://duckduckgo.com/?q=hello%20world');
  assert.strictEqual(resolveInput('w nevix browser', settings), 'https://en.wikipedia.org/w/index.php?search=nevix%20browser');
  assert.strictEqual(resolveInput('g cats', settings), 'https://www.google.com/search?q=cats');
  assert(resolveInput('javascript:alert(1)', settings).startsWith('https://duckduckgo.com/?q='), 'javascript: is never navigated');
  assert.strictEqual(resolveInput('what is 1.5 times 2', settings).startsWith('https://duckduckgo.com'), true);
  assert.strictEqual(resolveInput('node.js', settings), 'https://node.js');
});
t('store merges defaults and persists atomically', () => {
  const f = path.join(os.tmpdir(), 'nx-store-' + process.pid + '.json');
  fs.writeFileSync(f, JSON.stringify({ general: { theme: 'dark' }, extra: 1 }));
  const s = new Store(f, SETTINGS);
  assert.strictEqual(s.get('general.theme'), 'dark');
  assert.strictEqual(s.get('general.searchEngine'), 'duckduckgo');
  assert.strictEqual(s.get('extra'), 1);
  s.set('privacy.clearOnExit.cookies', true); s.flush();
  const again = new Store(f, SETTINGS);
  assert.strictEqual(again.get('privacy.clearOnExit.cookies'), true);
  fs.unlinkSync(f);
});
t('history & bookmarks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-data-'));
  const h = new History(dir);
  h.add('https://a.com/', 'A'); h.add('https://a.com/', 'A'); h.add('https://b.com/x', 'B'); h.add('about:blank', 'no'); h.add('nevix://settings', 'no');
  assert.strictEqual(h.items.length, 2);
  assert.strictEqual(h.index.get('https://a.com/').visits, 2);
  assert.strictEqual(h.top(5)[0].url, 'https://a.com/');
  assert.strictEqual(h.search('b.com').length, 1);
  h.remove('https://a.com/'); assert.strictEqual(h.items.length, 1);
  h.clear(); assert.strictEqual(h.items.length, 0);
  const b = new Bookmarks(dir);
  assert.strictEqual(b.toggle('https://x.com', 'X'), true);
  assert.strictEqual(b.toggle('https://x.com', 'X'), false);
  b.add('https://y.com/?a=1&b=2', 'Y "quoted" <tag>');
  const html = b.exportHtml();
  const b2 = new Bookmarks(fs.mkdtempSync(path.join(os.tmpdir(), 'nx-data-')));
  assert.strictEqual(b2.importHtml(html), 1);
  assert.strictEqual(b2.items[0].url, 'https://y.com/?a=1&b=2');
  assert.strictEqual(b2.items[0].title, 'Y "quoted" <tag>');
});
console.log(`\n${n} tests passed`);
