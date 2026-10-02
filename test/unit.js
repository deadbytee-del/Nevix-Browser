'use strict';
// Unit tests for the pure logic. Run with: npm test   (no Electron needed)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Rules, tokenize, pickToken } = require('../src/main/rules');
const { registrable, isLocalHost } = require('../src/main/domain');
const { stripTracking } = require('../src/main/privacy');
const { resolveInput, suggest } = require('../src/main/omnibox');
const { tryCalc } = require('../src/main/calc');
const { tryConvert } = require('../src/main/units');
const { Store } = require('../src/main/store');
const { History, Bookmarks } = require('../src/main/data');
const { SETTINGS } = require('../src/main/defaults');
const { Flags, FLAGS } = require('../src/main/flags');
const { Recovery } = require('../src/main/recovery');
const { normalizeAccel, display } = require('../src/main/commands');
const { assess, safeName } = require('../src/main/downloads');
const { encrypt, decrypt } = require('../src/main/portability');
const { median, pct } = require('../src/main/perf');
const { SCHEMA, CATEGORIES, getDefault } = require('../src/main/settings-schema');
const theme = require('../src/main/theme');
const { toCatalog } = require('../src/main/permissions');
const { trimNav } = require('../src/main/window');

let n = 0, failed = 0;
const t = (name, fn) => { try { fn(); n++; console.log('  ok  ', name); } catch (e) { failed++; console.error('  FAIL', name, '\n      ', e.message.split('\n').join('\n       ')); process.exitCode = 1; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nx-unit-'));

// ---- domains & URLs --------------------------------------------------------------------------------------------
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
t('strip tracking params', () => {
  assert.strictEqual(stripTracking('https://a.com/p?utm_source=x&id=5&fbclid=abc'), 'https://a.com/p?id=5');
  assert.strictEqual(stripTracking('https://a.com/p?q=hello'), 'https://a.com/p?q=hello');
  assert.strictEqual(stripTracking('https://a.com/?gclid=1'), 'https://a.com/');
  assert.strictEqual(stripTracking('https://a.com/watch?v=1&si=zz'), 'https://a.com/watch?v=1&si=zz');
  assert.strictEqual(stripTracking('https://youtu.be/abc?si=zz'), 'https://youtu.be/abc');
});

// ---- rules engine ----------------------------------------------------------------------------------------------
const q = (r, u, top, type = 'script') => { const x = new URL(u); return r.check({ url: u, host: x.hostname, path: x.pathname + x.search, topHost: top, type }); };
t('rules: host, path, token, option and exception rules', () => {
  const r = new Rules();
  r.load('||ads.example.com^\n||cdn.thing.com/pixel/\n/banner/*/img^\n||track.io^$third-party,script\n@@||ok.ads.example.com^\n/adserver.$image,domain=news.com|~safe.news.com\n||x.com^$important\n0.0.0.0 h.evil.net\n/ads/*.js$script\n', { listId: 't' });
  assert.strictEqual(q(r, 'https://ads.example.com/a.js', 'site.com').action, 'block');
  assert.strictEqual(q(r, 'https://sub.ads.example.com/a.js', 'site.com').action, 'block');
  assert.strictEqual(q(r, 'https://ok.ads.example.com/a.js', 'site.com').action, 'allow');
  assert.strictEqual(q(r, 'https://cdn.thing.com/pixel/1.gif', 'site.com', 'image').action, 'block');
  assert.strictEqual(q(r, 'https://cdn.thing.com/lib.js', 'site.com'), null);
  assert.strictEqual(q(r, 'https://track.io/t.js', 'site.com', 'script').action, 'block');
  assert.strictEqual(q(r, 'https://track.io/t.png', 'site.com', 'image'), null, 'type option respected');
  assert.strictEqual(q(r, 'https://foo.net/adserver.gif', 'news.com', 'image').action, 'block');
  assert.strictEqual(q(r, 'https://foo.net/adserver.gif', 'safe.news.com', 'image'), null, '~domain exclusion');
  assert.strictEqual(q(r, 'https://foo.net/adserver.gif', 'other.com', 'image'), null, 'domain= restricts');
  assert.strictEqual(q(r, 'https://h.evil.net/', 'x.com').action, 'block');
  assert.strictEqual(q(r, 'https://ads.example.com/a.js', 'example.com'), null, 'first-party is never blocked by bundled-style lists');
  assert.strictEqual(q(r, 'https://foo.net/ads/lib.js', 'site.com', 'script').action, 'block');
  assert.strictEqual(q(r, 'https://foo.net/ads/lib.css', 'site.com', 'stylesheet'), null);
  assert.strictEqual(q(r, 'https://localhost/', 'site.com'), null);
});
t('rules: decisions explain themselves', () => {
  const r = new Rules();
  r.load('||tracker.net^', { listId: 'my-list', category: 'trackers' });
  const d = q(r, 'https://tracker.net/x.js', 'site.com');
  assert.deepStrictEqual([d.action, d.category, d.list, d.rule], ['block', 'trackers', 'my-list', '||tracker.net^']);
});
t('rules: custom rules — actions, first-party and exceptions', () => {
  const r = new Rules({ thirdPartyOnly: false });
  r.load('block ||own.example.com/ads/\nisolate ||widgets.net^\nallow ||cdn.net^\n||everything.org^\n', { listId: 'custom', category: 'custom', custom: true });
  assert.strictEqual(q(r, 'https://own.example.com/ads/1.js', 'own.example.com').action, 'block', 'custom rules can block first-party');
  assert.strictEqual(q(r, 'https://widgets.net/w.js', 'site.com').action, 'isolate');
  assert.strictEqual(q(r, 'https://cdn.net/lib.js', 'site.com'), null);
  assert.strictEqual(q(r, 'https://everything.org/x', 'everything.org').action, 'block');
});
t('rules: token index is selective and complete', () => {
  assert.strictEqual(pickToken('/banner/*/img^'), 'banner');
  assert.strictEqual(pickToken('||example.com^'), 'example');
  assert.strictEqual(pickToken('ads*'), '', 'edge runs of unanchored patterns are unsafe');
  assert(tokenize('https://a.b.com/path/to-file.js?x=1').has('path'));
  const r = new Rules();
  const lines = [];
  for (let i = 0; i < 20000; i++) lines.push(`/segment${i}/track*pixel.gif`);
  lines.push('/needle/track*pixel.gif');
  r.load(lines.join('\n'), { listId: 'big' });
  const t0 = process.hrtime.bigint();
  let hits = 0;
  for (let i = 0; i < 2000; i++) if (q(r, 'https://cdn.x.com/needle/track-1-pixel.gif?i=' + i, 'site.com', 'image')) hits++;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(hits, 2000);
  assert(ms < 400, `2000 lookups against 20k rules took ${ms.toFixed(0)} ms`);
});
t('bundled lists load and block well-known trackers', () => {
  const b = new Rules();
  b.loadFile(path.join(__dirname, '../src/main/data/core-rules.txt'), { listId: 'core' });
  b.loadFile(path.join(__dirname, '../src/main/data/pgl-hosts.txt'), { listId: 'pgl', category: 'ads' });
  assert(b.count > 3000, 'rules ' + b.count);
  assert.strictEqual(q(b, 'https://www.google-analytics.com/a.js', 'news.com').category, 'trackers');
  assert.strictEqual(q(b, 'https://doubleclick.net/a.js', 'news.com').category, 'ads');
  assert.strictEqual(q(b, 'https://www.google.com/pagead/1', 'news.com').category, 'ads');
  assert.strictEqual(q(b, 'https://connect.facebook.net/en_US/sdk.js', 'news.com'), null, 'login SDK must not be blocked');
  for (const h of ['wikipedia.org', 'github.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'cloudflare.com']) assert.strictEqual(q(b, `https://${h}/x.js`, 'x.com'), null, h);
});

// ---- omnibox, calculator, units --------------------------------------------------------------------------------
const settings = new Store(path.join(tmp(), 's.json'), SETTINGS);
t('omnibox resolve', () => {
  assert.strictEqual(resolveInput('', settings), 'nevix://newtab');
  assert.strictEqual(resolveInput('example.com', settings), 'https://example.com');
  assert.strictEqual(resolveInput('localhost:3000/a', settings), 'http://localhost:3000/a');
  assert.strictEqual(resolveInput('about:settings', settings), 'nevix://settings');
  assert.strictEqual(resolveInput('about:flags', settings), 'nevix://flags');
  assert.strictEqual(resolveInput('hello world', settings), 'https://duckduckgo.com/?q=hello%20world');
  assert.strictEqual(resolveInput('w nevix browser', settings), 'https://en.wikipedia.org/w/index.php?search=nevix%20browser');
  assert(resolveInput('javascript:alert(1)', settings).startsWith('https://duckduckgo.com/?q='), 'javascript: is never navigated');
});
t('calculator', () => {
  const v = (s) => { const r = tryCalc(s); return r && r.result; };
  assert.strictEqual(v('128 * 64'), 8192);
  assert.strictEqual(v('2+2'), 4);
  assert.strictEqual(v('(3+4)*5^2'), 175);
  assert.strictEqual(v('2**10'), 1024);
  assert.strictEqual(v('sqrt(144)+1'), 13);
  assert.strictEqual(v('20% of 150'), 30);
  assert.strictEqual(v('5!'), 120);
  assert.strictEqual(v('7 mod 4'), 3);
  assert.strictEqual(v('pow(2,8)'), 256);
  assert.strictEqual(v('1,000*3'), 3000);
  assert.strictEqual(v('-5+2'), -3);
  assert.strictEqual(tryCalc('128 * 64').display, '8,192');
  for (const bad of ['hello', '2024', '555-1234', '2024-10-02', '1/0', 'alert(1)', 'process.exit()', '2+', '((2)', 'require("fs")', 'constructor.constructor("x")()']) assert.strictEqual(tryCalc(bad), null, bad);
});
t('unit conversion', () => {
  const v = (s) => { const r = tryConvert(s); return r && +r.value.toFixed(4); };
  assert.strictEqual(v('12 km in miles'), 7.4565);
  assert.strictEqual(v('98.6 f to c'), 37);
  assert.strictEqual(v('100 c in f'), 212);
  assert.strictEqual(v('2.5 gb to mb'), 2500);
  assert.strictEqual(v('3 hours in minutes'), 180);
  assert.strictEqual(v('1 gib to mb'), 1073.7418);
  assert.strictEqual(tryConvert('10 kg in m'), null, 'incompatible units');
  assert.strictEqual(tryConvert('5 usd in eur'), null, 'currencies need the network and are not offered');
});
t('omnibox suggestions: answers, prefixes, local data', () => {
  const h = new History(tmp()); h.add('https://github.com/nevix', 'Nevix on GitHub'); h.add('https://example.com/', 'Example');
  const b = new Bookmarks(tmp()); b.add('https://news.test/', 'News');
  const cmds = { describe: () => [{ id: 'clearSiteData', title: 'Clear site data for this site', category: 'Privacy', shortcuts: [] }, { id: 'newTab', title: 'New tab', category: 'Tabs', shortcuts: ['Ctrl+T'] }] };
  const spaces = { listWorkspaces: () => [{ id: 'w1', name: 'Minecraft', tabs: [{}] }] };
  const flags = { on: () => true };
  const ctx = { history: h, bookmarks: b, settings, commands: cmds, spaces, flags, tabs: [{ id: 1, win: 1, title: 'GitHub — Nevix', url: 'https://github.com/nevix' }, { id: 2, win: 1, title: 'Other', url: 'https://other.test/' }] };
  assert.strictEqual(suggest('128 * 64', ctx)[0].type, 'calc');
  assert.strictEqual(suggest('128 * 64', ctx)[0].value, '8,192');
  assert.strictEqual(suggest('12 km in miles', ctx)[0].type, 'convert');
  const tabs = suggest('tabs github', ctx); assert(tabs.length === 1 && tabs[0].type === 'tab' && tabs[0].tabId === 1, JSON.stringify(tabs));
  const ws = suggest('workspace mine', ctx); assert(ws[0].type === 'workspace' && ws[0].arg.id === 'w1');
  const st = suggest('settings privacy', ctx); assert(st.length > 3 && st.every((s) => s.type === 'setting'), 'settings provider');
  assert(st.some((s) => /nevix:\/\/settings/.test(s.url)));
  assert(suggest('>clear site', ctx).some((s) => s.type === 'command' && s.cmd === 'clearSiteData'));
  const plain = suggest('nevix', ctx); assert.strictEqual(plain[0].type, 'search'); assert(plain.some((s) => s.type === 'history'));
  assert(suggest('clear site', ctx).some((s) => s.type === 'command'), 'plain words can also find commands');
});

// ---- storage ---------------------------------------------------------------------------------------------------
t('store merges defaults and persists atomically', () => {
  const f = path.join(tmp(), 's.json');
  fs.writeFileSync(f, JSON.stringify({ general: { theme: 'light' }, extra: 1 }));
  const s = new Store(f, SETTINGS);
  assert.strictEqual(s.get('general.theme'), 'light');
  assert.strictEqual(s.get('general.searchEngine'), 'duckduckgo');
  assert.strictEqual(s.get('performance.freezeAfterMinutes'), 5);
  s.set('privacy.clearOnExit.cookies', true); s.flush();
  assert.strictEqual(new Store(f, SETTINGS).get('privacy.clearOnExit.cookies'), true);
});
t('history & bookmarks', () => {
  const dir = tmp();
  const h = new History(dir);
  h.add('https://a.com/', 'A'); h.add('https://a.com/', 'A'); h.add('https://b.com/x', 'B'); h.add('about:blank', 'no'); h.add('nevix://settings', 'no');
  assert.strictEqual(h.items.length, 2);
  assert.strictEqual(h.top(5)[0].url, 'https://a.com/');
  h.remove('https://a.com/'); assert.strictEqual(h.items.length, 1);
  h.clear(); assert.strictEqual(h.items.length, 0);
  const b = new Bookmarks(dir);
  assert.strictEqual(b.toggle('https://x.com', 'X'), true); assert.strictEqual(b.toggle('https://x.com', 'X'), false);
  b.add('https://y.com/?a=1&b=2', 'Y "quoted" <tag>');
  const b2 = new Bookmarks(tmp());
  assert.strictEqual(b2.importHtml(b.exportHtml()), 1);
  assert.strictEqual(b2.items[0].title, 'Y "quoted" <tag>');
});

// ---- flags & recovery ------------------------------------------------------------------------------------------
t('flags: registry integrity', () => {
  const ids = FLAGS.map((f) => f.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'unique ids');
  for (const f of FLAGS) {
    assert(/^nevix-enable-[a-z0-9-]+$/.test(f.id), f.id);
    assert(f.name && f.name.length >= 3, f.id + ' name'); assert(f.description && f.description.length > 20, f.id + ' description'); assert(f.category, f.id + ' category');
    assert.strictEqual(typeof f.default, 'boolean'); assert.strictEqual(typeof f.experimental, 'boolean'); assert.strictEqual(typeof f.restart, 'boolean');
  }
  // every flag must be referenced by real code
  const src = ['window', 'app', 'lifecycle', 'privacy', 'commands', 'reader', 'flags', 'ipc'].map((f) => fs.readFileSync(path.join(__dirname, `../src/main/${f}.js`), 'utf8')).join('\n') + fs.readFileSync(path.join(__dirname, '../src/main/perf.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../src/preload/page.js'), 'utf8');
  for (const f of FLAGS) {
    const uses = (src.match(new RegExp(f.id, 'g')) || []).length;
    assert(uses >= 2, `${f.id} is declared but never used by the code`);
  }
});
t('flags: persistence, safe mode, malformed files, recovery', () => {
  const dir = tmp(), f = path.join(dir, 'flags.json');
  fs.writeFileSync(f, '{broken json');
  let fl = new Flags(f);
  assert.strictEqual(fl.on('nevix-enable-workspaces'), true, 'defaults survive a corrupt file');
  assert(fs.existsSync(f + '.corrupt'));
  fl.set('nevix-enable-renderer-prewarm', 'enabled'); fl.set('nevix-enable-workspaces', 'disabled');
  fl = new Flags(f);
  assert.strictEqual(fl.on('nevix-enable-renderer-prewarm'), true); assert.strictEqual(fl.on('nevix-enable-workspaces'), false);
  const safe = new Flags(f, { safeMode: true });
  assert.strictEqual(safe.on('nevix-enable-renderer-prewarm'), false); assert.strictEqual(safe.on('nevix-enable-workspaces'), true, 'safe mode ignores all flags');
  assert.deepStrictEqual(fl.disableExperimental(), ['nevix-enable-renderer-prewarm']);
  assert.strictEqual(fl.on('nevix-enable-workspaces'), false, 'user choices on stable flags are kept');
  fs.writeFileSync(f, JSON.stringify({ states: { bogus: 'enabled', 'nevix-enable-snapshots': 'maybe', 'nevix-enable-experimental-reader': 'enabled' } }));
  assert.deepStrictEqual(new Flags(f).states, { 'nevix-enable-experimental-reader': 'enabled' });
  assert.throws(() => fl.set('nope', 'enabled')); assert.throws(() => fl.set('nevix-enable-snapshots', 'maybe'));
  fl.resetAll(); assert.deepStrictEqual(fl.states, {});
  const fl2 = new Flags(f); fl2.set('nevix-enable-experimental-http3', 'enabled');
  assert(fl2.switches().some(([k]) => k === 'origin-to-force-quic-on'));
  const rp = new Flags(f); rp.states['nevix-enable-startup-lazy-init'] = 'disabled';
  assert.strictEqual(rp.list().find((x) => x.id === 'nevix-enable-startup-lazy-init').restartPending, true);
});
t('recovery: crash detection and crash loops', () => {
  const dir = tmp();
  let r = new Recovery(dir); assert.strictEqual(r.crashed, false); r.arm();
  r = new Recovery(dir); assert.strictEqual(r.crashed, true); assert.strictEqual(r.consecutive, 1); assert.strictEqual(r.crashLoop, false); r.arm();
  r = new Recovery(dir); assert.strictEqual(r.crashLoop, true, 'two unclean starts in a row');
  r.healthy(); r.arm();
  r = new Recovery(dir); assert.strictEqual(r.consecutive, 1, 'healthy run resets the counter');
  r.disarm();
  r = new Recovery(dir); assert.strictEqual(r.crashed, false); assert.strictEqual(r.consecutive, 0);
});

// ---- commands, settings, theme ---------------------------------------------------------------------------------
t('accelerators', () => {
  assert.strictEqual(normalizeAccel('Mod+Shift+P'), 'Mod+Shift+P');
  assert.strictEqual(normalizeAccel('Ctrl+Tab'), process.platform === 'darwin' ? 'Ctrl+Tab' : 'Mod+Tab');
  assert.strictEqual(normalizeAccel('Mod++'), 'Mod++');
  assert.strictEqual(normalizeAccel('Mod+Shift+='), normalizeAccel('Mod+='), 'shift is implied by symbols');
  assert(/Shift\+P$/.test(display('Mod+Shift+P')));
});
t('settings schema: complete, valid, every setting has a safe default', () => {
  const keys = SCHEMA.filter((s) => s.key).map((s) => s.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate settings');
  for (const s of SCHEMA) {
    assert(CATEGORIES.includes(s.category), s.title + ' → ' + s.category);
    assert(s.title && s.description, `${s.key || s.title} needs a title and description`);
    if (s.key) { assert.notStrictEqual(getDefault(s.key), undefined, s.key + ' has no default'); assert(s.type, s.key); }
    if (s.type === 'select') assert(s.options.some(([v]) => v === getDefault(s.key)), s.key + ' default is not an option');
  }
  for (const c of CATEGORIES) assert(SCHEMA.some((s) => s.category === c), 'category without settings: ' + c);
  assert.deepStrictEqual(CATEGORIES, ['General', 'Appearance', 'Tabs', 'Privacy', 'Security', 'Performance', 'Network', 'Downloads', 'Extensions', 'Shortcuts', 'Search', 'Sync', 'Developer', 'Flags', 'Advanced']);
});
t('theme: brand colours and contrast', () => {
  assert.strictEqual(theme.DARK['color-primary'], '#9D64A3'); assert.strictEqual(theme.DARK['color-background'], '#1F171D'); assert.strictEqual(theme.DARK['color-danger'], '#783124');
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q2) => q2 - p); return (x + 0.05) / (y + 0.05); };
  for (const [name, set] of [['dark', theme.DARK], ['light', theme.LIGHT]]) {
    assert(cr(set['color-text'], set['color-background']) >= 7, name + ' body text');
    assert(cr(set['color-text-secondary'], set['color-surface']) >= 4.5, name + ' secondary text');
    assert(cr(set['color-primary-text'], set['color-background']) >= 4.5, name + ' primary text');
    assert(cr(set['color-on-primary'], set['color-primary']) >= 4.5, name + ' text on primary buttons');
    assert(cr(set['color-danger-text'], set['color-background']) >= 4.5, name + ' danger text');
  }
  const css = theme.css('#112233');
  assert(css.includes('--color-primary:#112233')); assert(css.includes('prefers-color-scheme: light')); assert(!theme.css('javascript:alert(1)').includes('javascript'));
  // no stray hard-coded hex colours in the UI layer (tokens only), apart from the intentional white web canvas
  for (const f of ['src/ui/ui.css', 'src/pages/res/base.css', 'src/pages/res/settings.css', 'src/pages/res/newtab.css']) {
    const hex = (fs.readFileSync(path.join(__dirname, '..', f), 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g) || []);
    assert.deepStrictEqual(hex, [], f + ' hard-codes colours: ' + hex.join(','));
  }
});
t('no references to the old logo or brand colours', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(__dirname, '../src')).filter((x) => /\.(js|css|html|json)$/.test(x))) {
    const s = fs.readFileSync(f, 'utf8');
    assert(!/(^|[^\w-])icon\.(svg|png)|logo\.(svg|png)/.test(s), f + ' references a logo asset');
    assert(!/#8b7cff|#a99bff|#62d4ff|linear-gradient|backdrop-filter/i.test(s), f + ' contains old-theme styling');
  }
  assert(!fs.existsSync(path.join(__dirname, '../assets/icon.svg')) && !fs.existsSync(path.join(__dirname, '../assets/icon.png')));
});

// ---- permissions, downloads, portability, perf, window helpers ----------------------------------------------------
t('permission mapping', () => {
  assert.deepStrictEqual(toCatalog('media', { mediaTypes: ['video', 'audio'] }), ['camera', 'microphone']);
  assert.deepStrictEqual(toCatalog('media', { mediaTypes: ['audio'] }), ['microphone']);
  assert.deepStrictEqual(toCatalog('geolocation'), ['geolocation']);
  assert.strictEqual(toCatalog('hid'), null);
});
t('download safety', () => {
  assert.strictEqual(assess('setup.exe', 'https://a.com/setup.exe').level, 'danger');
  assert.strictEqual(assess('notes.pdf', 'https://a.com/n.pdf'), null);
  assert.strictEqual(assess('archive.zip', 'https://a.com/a.zip').level, 'caution');
  assert.strictEqual(assess('archive.zip', 'http://a.com/a.zip').level, 'danger', 'risky type over plain http');
  assert(assess('invoice.pdf.exe', 'https://a.com/x').reasons.some((r) => /double/.test(r)));
  assert(assess('x.exe', 'https://a.com/x', 'image/png').reasons.some((r) => /content type/.test(r)));
  assert.strictEqual(safeName('../../etc/passwd'), 'passwd');
  assert.strictEqual(safeName('evil‮gnp.exe'), 'evil_gnp.exe', 'bidi override stripped');
  assert.strictEqual(safeName('CON.txt'), '_CON.txt'); assert.strictEqual(safeName('a<b>:c?.txt'), 'a_b__c_.txt'); assert.strictEqual(safeName('name. '), 'name');
});
t('encrypted backup', () => {
  const data = { bookmarks: [{ url: 'https://a.com', title: 'é ünïcode 😀' }], n: 1 };
  const blob = encrypt(data, 'correct horse battery');
  assert(!blob.includes('a.com'), 'ciphertext does not leak content');
  assert.deepStrictEqual(decrypt(blob, 'correct horse battery'), data);
  assert.throws(() => decrypt(blob, 'wrong passphrase'), /Wrong passphrase/);
  const tampered = JSON.parse(blob); tampered.data = Buffer.from('x' + Buffer.from(tampered.data, 'base64').toString('binary').slice(1), 'binary').toString('base64');
  assert.throws(() => decrypt(JSON.stringify(tampered), 'correct horse battery'));
  assert.throws(() => decrypt('not json', 'x'), /not a Nevix backup/);
  assert.notStrictEqual(encrypt(data, 'pw-pw-pw-pw'), encrypt(data, 'pw-pw-pw-pw'), 'fresh salt and IV every time');
});
t('stats helpers', () => { assert.strictEqual(median([3, 1, 2]), 2); assert.strictEqual(median([1, 2, 3, 4]), 2.5); assert.strictEqual(pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10); assert.strictEqual(median([]), 0); });
t('history trimming keeps the current entry', () => {
  const e = Array.from({ length: 40 }, (_, i) => ({ url: 'u' + i }));
  const r = trimNav(e, 30); assert.strictEqual(r.entries.length, 12); assert.strictEqual(r.entries[r.index].url, 'u30');
  assert.strictEqual(trimNav(e, 0).entries[0].url, 'u0'); assert.strictEqual(trimNav(e.slice(0, 3), 1).index, 1);
});

console.log(`\n${n} passed${failed ? `, ${failed} FAILED` : ''}`);
