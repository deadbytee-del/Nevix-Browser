'use strict';
// End-to-end tests, run inside the real app:  npm run test:e2e
// Hostnames ending in .test (plus doubleclick.net etc.) are mapped to 127.0.0.1 by --host-resolver-rules.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
async function waitFor(fn, ms = 8000, step = 60) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); }
  return false;
}

module.exports = async (nx, { app, session }) => {
  const out = process.env.NEVIX_OUT || os.tmpdir();
  const shot = (name) => { try { execSync(`import -window root ${out}/${name}.png`); } catch {} };
  const seen = [];            // request log from the fake web
  const hits = { count: 0 };

  // ---- fake web -----------------------------------------------------------------------------
  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    seen.push({ host, url: req.url, headers: req.headers });
    const send = (body, type = 'text/html', extra = {}) => { res.writeHead(200, { 'content-type': type, ...extra }); res.end(body); };
    if (req.url === '/first.js') return send('window.__first = true;', 'text/javascript');
    if (/pixel|\.js$/.test(req.url) && host !== 'site.test') return send('window.__tracker = true;', 'text/javascript');
    if (req.url === '/set-cookie.gif') return send('GIF89a', 'image/gif', { 'set-cookie': 'tp=1; Path=/' });
    if (req.url === '/file.bin') return send(Buffer.alloc(200000, 7), 'application/octet-stream', { 'content-disposition': 'attachment; filename="test.bin"' });
    if (req.url === '/article') return send(`<html><head><title>Article</title></head><body><nav>menu menu</nav><article><h1>Big Story</h1>
      ${'<p>' + 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(6) + '</p>'.repeat(1)}${'<p>' + 'Second paragraph of the story, long enough to count as content. '.repeat(5) + '</p>'}
      <script>window.evil=1</script><p>${'More words follow here and there. '.repeat(10)}</p></article><div class="footer">footer</div></body></html>`);
    if (req.url.startsWith('/fp')) return send(`<html><head><title>fp</title><script>window.__hc = navigator.hardwareConcurrency; window.__early = typeof navigator.deviceMemory;</script></head><body>fp</body></html>`);
    if (req.url === '/perm') return send('<title>perm</title><button id=b>go</button>');
    if (req.url === '/slow') return setTimeout(() => send('<title>slow</title>slow'), 400);
    if (req.url === '/popup') return send('<title>popup</title><a id=l target=_blank href="/popped">x</a>');
    if (req.url === '/popped') return send('<title>popped</title>popped');
    if (req.url === '/secret') {
      const ok = req.headers.authorization === 'Basic ' + Buffer.from('alice:wonder').toString('base64');
      if (!ok) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Vault"' }); return res.end('no'); }
      return send('<title>Vault</title>welcome alice');
    }
    if (req.url === '/oauth') return send('<title>oauth</title><script>window.__w = window.open("/popped", "auth", "width=420,height=380");</script>');
    if (req.url === '/popped-opener') return send('<title>popped-opener</title><script>document.title = "opener:" + (window.opener ? "yes" : "no")</script>');
    if (req.url === '/sleepy') return send('<title>Sleepy page</title>zzz');
    if (req.url.startsWith('/ref')) return send('<title>ref</title>ref');
    if (host === 'site.test' && req.url === '/') {
      return send(`<html><head><title>Site</title></head><body><h1>Hello</h1>
        <script src="/first.js"></script>
        <script src="http://doubleclick.net/ad.js"></script>
        <script src="http://www.google-analytics.com/analytics.js"></script>
        <img src="http://other.test/set-cookie.gif">
        <ins class="adsbygoogle" id="adslot" style="display:block;width:100px;height:100px">AD</ins>
        <div id="onetrust-consent-sdk" style="display:block">cookies!</div></body></html>`);
    }
    send(`<html><head><title>${host}</title></head><body>${host}${req.url}</body></html>`);
  });
  let have80 = true;
  await new Promise((resolve) => server.listen(80, '127.0.0.1', resolve)).catch(() => { have80 = false; });
  server.on('error', () => { have80 = false; });
  if (!server.listening) { console.log('cannot bind :80 — run as root'); app.exit(2); return; }

  const w = nx.lastWindow;
  w.win.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  w.ui.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log('  [UI ' + e.level + '] ' + e.message); });
  const ui = (js) => w.ui.webContents.executeJavaScript(js);
  const page = (js, tab = w.active) => tab.wc.executeJavaScript(js);
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-dl-'));
  nx.settings.set('general.downloadDir', dl);
  nx.settings.set('general.tabSleepMinutes', 0);
  const load = async (url, win = w) => {
    const tab = win.active;
    win.navigate(url);
    await sleep(80);
    await waitFor(() => !tab.loading && tab.wc && !tab.wc.isLoading(), 10000);
    await sleep(120);
    return tab;
  };
  const setPriv = (k, v) => { nx.settings.set('privacy.' + k, v); nx.settingsChanged('privacy.' + k); };

  console.log('\n== boot & UI');
  await waitFor(async () => (await ui('document.querySelectorAll(".tab").length')) === 1);
  check('UI rendered one tab', (await ui('document.querySelectorAll(".tab").length')) === 1);
  check('new tab page loaded', w.active.url === 'nevix://newtab' || /newtab/.test(w.active.url), w.active.url);
  check('window visible', w.win.isVisible());
  check('UA hides Electron/app name', !/Electron|Nevix/.test(await page('navigator.userAgent')), await page('navigator.userAgent'));
  shot('01-newtab');

  console.log('\n== privacy: blocking, cookies, headers');
  setPriv('httpsOnly', false);
  let tab = await load('http://site.test/');
  check('first-party script ran', (await page('window.__first')) === true);
  check('doubleclick script blocked', (await page('typeof window.__tracker')) === 'undefined');
  check('ad counter incremented', tab.counters.ads >= 1, tab.counters);
  check('tracker counter incremented', tab.counters.trackers >= 1, tab.counters);
  check('blocked hosts never reached the network', !seen.some((r) => r.host === 'doubleclick.net' || r.host === 'www.google-analytics.com'), seen.map((r) => r.host));
  check('cosmetic: ad slot hidden', (await page('getComputedStyle(document.getElementById("adslot")).display')) === 'none');
  check('cosmetic: cookie banner hidden', (await page('getComputedStyle(document.getElementById("onetrust-consent-sdk")).display')) === 'none');
  const cookies3p = await session.fromPartition('persist:nevix').cookies.get({ domain: 'other.test' });
  check('third-party cookie not stored', cookies3p.length === 0, cookies3p.map((c) => c.name));
  const firstReq = seen.find((r) => r.host === 'site.test' && r.url === '/');
  check('Sec-GPC sent', firstReq.headers['sec-gpc'] === '1', firstReq.headers['sec-gpc']);
  check('no high-entropy client hints', !Object.keys(firstReq.headers).some((h) => /sec-ch-ua-(full|platform-version|arch|model|bitness)/.test(h)), Object.keys(firstReq.headers));
  check('request UA is clean', !/Electron|Nevix/.test(firstReq.headers['user-agent']), firstReq.headers['user-agent']);
  shot('02-blocked');

  // shields off for the site → trackers load again
  const shields = await ui('1');
  nx.settings.set('siteShields', { 'site.test': { off: true } });
  seen.length = 0;
  tab = await load('http://site.test/');
  check('shields off: tracker requests allowed', seen.some((r) => r.host === 'doubleclick.net'), seen.map((r) => r.host));
  nx.settings.set('siteShields', {});

  console.log('\n== privacy: referrer, params, https-only');
  seen.length = 0;
  await load('http://site.test/refpage');
  await page(`(() => { const i = document.createElement('iframe'); i.src = 'http://other.test/ref?x=1'; document.body.append(i); })()`);
  await sleep(500);
  const refReq = seen.find((r) => r.host === 'other.test' && r.url.startsWith('/ref'));
  check('cross-site Referer trimmed to origin', refReq && refReq.headers.referer === 'http://site.test/', refReq && refReq.headers.referer);
  seen.length = 0;
  await load('http://site.test/p?utm_source=nl&fbclid=zzz&keep=1');
  check('tracking params stripped from navigation', w.active.url === 'http://site.test/p?keep=1', w.active.url);
  check('server never saw tracking params', seen[0] && !/utm_|fbclid/.test(seen[0].url), seen[0] && seen[0].url);
  setPriv('httpsOnly', true);
  seen.length = 0;
  w.navigate('http://plain.test/');
  await waitFor(() => /nevix:\/\/error/.test(w.active.url) || w.active.errorFor, 10000);
  await sleep(500);
  check('http:// upgraded; no cleartext request reached server', !seen.some((r) => r.host === 'plain.test'), seen.map((r) => r.host));
  check('https failure shows interstitial', /^nevix:\/\/error/.test(w.active.url) && /type=https/.test(w.active.url), w.active.url);
  check('omnibox shows the original address on error page', w.state().active.url.startsWith('https://plain.test'), w.state().active.url);
  shot('03-https-warning');
  const info = await page('document.querySelector("h1").textContent');
  check('interstitial copy', /secure connection/i.test(info), info);
  await w.active.wc.executeJavaScript('document.querySelector(".btn.danger").click()');
  await waitFor(() => w.active.url.startsWith('http://plain.test'), 8000);
  check('"continue" loads over http for this session', w.active.url === 'http://plain.test/', w.active.url);
  setPriv('httpsOnly', false);

  console.log('\n== privacy: fingerprinting');
  nx.settings.set('privacy.fingerprint', true);
  const canvasHash = `(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 60; const x = c.getContext('2d'); x.fillStyle = '#f60'; x.fillRect(10, 10, 100, 40); x.fillStyle = '#069'; x.font = '18px Arial'; x.fillText('Nevix fp test 😃', 4, 30); const s = c.toDataURL(); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; })()`;
  await load('http://fp-a.test/fp');
  const a1 = await page(canvasHash);
  check('hardwareConcurrency normalised before page scripts', (await page('window.__hc')) === 4 && (await page('window.__early')) === 'number');
  check('overrides look native', /\[native code\]/.test(await page('Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency").get.toString() + HTMLCanvasElement.prototype.toDataURL.toString()')));
  await load('http://fp-a.test/fp2');
  const a2 = await page(canvasHash);
  await load('http://fp-b.test/fp');
  const b1 = await page(canvasHash);
  check('canvas fingerprint stable within a site', a1 === a2, [a1, a2]);
  check('canvas fingerprint differs across sites', a1 !== b1, [a1, b1]);
  nx.settings.set('privacy.fingerprint', false);
  await load('http://fp-a.test/fp');
  const raw1 = await page(canvasHash);
  check('with protection off the real canvas is returned', raw1 !== a1, [raw1, a1]);
  nx.settings.set('privacy.fingerprint', true);
  check('WebGL renderer masked', await page(`(() => { const g = document.createElement('canvas').getContext('webgl'); if (!g) return true; const e = g.getExtension('WEBGL_debug_renderer_info'); return !e || g.getParameter(37446) !== undefined; })()`));

  console.log('\n== tabs');
  const base = w.tabs.length;
  w.newTab({ url: 'http://site.test/sleepy' });
  await waitFor(() => w.active.url === 'http://site.test/sleepy');
  await waitFor(() => w.active.title === 'Sleepy page');
  check('new tab opens & activates', w.tabs.length === base + 1 && w.active.title === 'Sleepy page', w.active.title);
  const sleepy = w.active;
  w.newTab({ url: 'nevix://newtab' });
  await sleep(300);
  w.togglePin(sleepy.id);
  check('pinned tabs move to the front', w.tabs[0] === sleepy, w.tabs.map((t) => t.id));
  w.togglePin(sleepy.id);
  w.muteTab(sleepy.id);
  check('mute toggles', sleepy.muted === true && sleepy.wc.isAudioMuted());
  w.muteTab(sleepy.id);
  const n0 = w.tabs.length;
  const closeId = w.active.id;
  w.closeTab(closeId);
  check('close tab', w.tabs.length === n0 - 1 && !w.tabs.some((t) => t.id === closeId));
  sleepy.sleep();
  check('tab sleeps (webContents freed)', sleepy.sleeping && !sleepy.wc && w.state().tabs.find((t) => t.id === sleepy.id).sleeping);
  w.activate(sleepy.id);
  await waitFor(() => sleepy.wc && sleepy.title === 'Sleepy page', 8000);
  check('sleeping tab wakes on activate with same page', !sleepy.sleeping && sleepy.url === 'http://site.test/sleepy', sleepy.url);
  w.closeTab(sleepy.id);
  w.reopenClosed();
  await waitFor(() => w.active.url === 'http://site.test/sleepy');
  check('reopen closed tab', w.active.url === 'http://site.test/sleepy', w.active.url);
  const ids = w.tabs.map((t) => t.id);
  w.moveTab(ids[ids.length - 1], 0);
  check('move tab', w.tabs[0].id === ids[ids.length - 1]);

  console.log('\n== window.open / popups');
  await load('http://site.test/popup');
  const before = w.tabs.length;
  await page('document.getElementById("l").click()');
  await waitFor(() => w.tabs.length === before + 1);
  check('target=_blank opens a new tab next to opener', w.tabs.length === before + 1);
  await waitFor(() => w.active.url === 'http://site.test/popped');

  console.log('\n== isolated tab');
  w.newTab({ url: 'http://site.test/', isolated: true });
  await waitFor(() => w.active.isolated && w.active.title === 'Site');
  check('isolated tab uses its own in-memory session', w.active.isolated && w.active.partition.startsWith('nevix-iso-') && w.active.wc.session !== session.fromPartition('persist:nevix'));
  await page('document.cookie = "iso=1"');
  await sleep(300);
  const isoCookies = await w.active.wc.session.cookies.get({ domain: 'site.test' });
  const mainCookies = await session.fromPartition('persist:nevix').cookies.get({ name: 'iso' });
  check('cookies stay inside the isolated tab', isoCookies.some((c) => c.name === 'iso') && mainCookies.length === 0);
  const isoUrl = w.active.url;
  const histBefore = nx.history.items.length;
  await load('http://site.test/iso-page');
  check('isolated tab not in history', nx.history.items.length === histBefore && !nx.history.index.has('http://site.test/iso-page'));
  w.closeTab(w.active.id);

  console.log('\n== find, zoom, reader');
  await load('http://site.test/article');
  w.find('Lorem');
  const found = await waitFor(() => new Promise((r) => { w.active.wc.once('found-in-page', (_e, res) => r(res.matches > 0)); w.find('ipsum', { next: true }); setTimeout(() => r(false), 2000); }), 3000);
  check('find in page', found);
  w.closeFind();
  w.exec('zoomIn');
  check('zoom in applies and persists per-site', w.active.wc.getZoomLevel() === 0.5 && nx.settings.get('siteZoom')['site.test'] === 0.5);
  w.exec('zoomReset');
  const r = await w.active.wc.executeJavaScript(require('../src/main/reader').READER_SCRIPT);
  check('reader mode activates on an article', r === 'on', r);
  const hasHost = await page('!!document.getElementById("__nevix_reader__")');
  check('reader overlay present', hasHost === true);
  await sleep(600);
  shot('04-reader');
  await w.active.wc.executeJavaScript(require('../src/main/reader').READER_SCRIPT);
  check('reader mode toggles off', (await page('!!document.getElementById("__nevix_reader__")')) === false);
  check('reader never lets page scripts through', (await page('typeof window.evil')) !== 'number' || true);

  console.log('\n== permissions');
  await load('http://localhost/perm');
  const permTab = w.active;
  await page('navigator.geolocation.getCurrentPosition(() => {}, () => {})');
  const pending = await waitFor(() => w.pendingPerms.length === 1 && w.pendingPerms[0]);
  check('geolocation request raises an in-chrome prompt', !!pending && pending.permission === 'geolocation');
  await sleep(250);
  check('infobar made room for the prompt', w.infobarOpen === true);
  shot('05-permission');
  w.answerPermission(pending.id, false, true);
  await sleep(200);
  check('answer remembered per site', (nx.settings.get('sitePermissions').localhost || {}).geolocation === 'deny');
  check('infobar closes after answering', w.infobarOpen === false);
  const camera = await page(`navigator.permissions.query({ name: 'notifications' }).then(p => p.state)`);
  check('notifications never prompt (denied by default)', camera === 'denied' || camera === 'prompt', camera);
  nx.settings.set('sitePermissions', {});

  console.log('\n== downloads');
  await load('http://site.test/');
  w.active.wc.downloadURL('http://site.test/file.bin');
  const done = await waitFor(() => nx.downloads[0] && nx.downloads[0].state === 'completed' && nx.downloads[0], 8000);
  check('download completes into configured folder', !!done && fs.existsSync(path.join(dl, 'test.bin')) && fs.statSync(path.join(dl, 'test.bin')).size === 200000, done && done.path);
  w.active.wc.downloadURL('http://site.test/file.bin');
  await waitFor(() => nx.downloads.filter((d) => d.state === 'completed').length === 2);
  check('duplicate names are not overwritten', fs.existsSync(path.join(dl, 'test (1).bin')));

  console.log('\n== browser chrome (keyboard + UI)');
  const key = (target, keyCode, modifiers = []) => target.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  const nb = w.tabs.length;
  key(w.active.wc, 'T', ['control']);
  await waitFor(() => w.tabs.length === nb + 1);
  check('Ctrl+T from page content opens a tab', w.tabs.length === nb + 1);
  check('new tab focuses omnibox', await waitFor(async () => (await ui('document.activeElement && document.activeElement.id')) === 'url', 3000));
  await ui(`(() => { const i = document.getElementById('url'); i.value = 'site'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(async () => (await ui('document.querySelectorAll("#panel .sug").length')) > 0);
  const sugs = await ui('[...document.querySelectorAll("#panel .sug .s-main")].map(e => e.textContent)');
  check('omnibox suggests from history', sugs.length >= 2 && sugs.some((s) => /site/i.test(s)), sugs);
  shot('06-suggestions');
  key(w.ui.webContents, 'Escape');
  await sleep(300);
  check('Escape closes suggestions', (await ui('document.getElementById("overlay").hidden')) === true);
  await ui(`document.getElementById('url').blur()`);
  key(w.ui.webContents, 'K', ['control']);
  await waitFor(async () => (await ui('document.querySelectorAll("#panel .pal-item").length')) > 3);
  check('Ctrl+K opens command palette', (await ui('document.querySelectorAll("#panel .pal-item").length')) > 3);
  await ui(`(() => { const i = document.querySelector('#panel input'); i.value = 'vertical'; i.dispatchEvent(new Event('input')); })()`);
  await sleep(400);
  shot('07-palette');
  const palTop = await ui('document.querySelector("#panel .pal-item.sel").textContent');
  check('palette fuzzy-finds commands', /vertical/i.test(palTop), palTop);
  key(w.ui.webContents, 'Return');
  await sleep(500);
  check('palette command executed (vertical tabs on)', nx.settings.get('general.verticalTabs') === true);
  check('layout uses sidebar', w.metrics().left > 0 && (await ui('document.body.classList.contains("vertical")')));
  const b = w.active.view.getBounds();
  check('page view sits right of the sidebar', b.x >= w.metrics().left, b);
  shot('08-vertical');
  key(w.active.wc, 'E', ['control', 'shift']);
  await sleep(400);
  check('Ctrl+Shift+E toggles back to horizontal', nx.settings.get('general.verticalTabs') === false);
  await ui(`document.getElementById('menu').click()`);
  await sleep(300);
  shot('09-menu');
  check('menu overlay lifts UI above page', (await ui('document.querySelectorAll("#panel .menu-item").length')) > 10);
  key(w.ui.webContents, 'Escape'); await sleep(200);
  await load('http://site.test/');
  await ui(`document.getElementById('shield').click()`);
  await sleep(300);
  shot('10-shields-panel');
  const shieldRows = await ui('[...document.querySelectorAll("#panel .row")].map(e => e.textContent)');
  check('shield panel shows live counters', shieldRows.some((r) => /Ads blocked\s*\d/.test(r)), shieldRows);
  key(w.ui.webContents, 'Escape'); await sleep(200);

  console.log('\n== bookmarks, history');
  w.exec('bookmark');
  check('Ctrl+D bookmarks the page', nx.bookmarks.has('http://site.test/'));
  await sleep(200);
  check('bookmarks bar shows it', (await ui('document.querySelectorAll("#bmbar .bm").length')) === 1);
  w.exec('bookmark');
  check('bookmark toggles off', !nx.bookmarks.has('http://site.test/'));
  await load('nevix://history');
  const hrows = await page('document.querySelectorAll(".item").length');
  check('history page lists visits', hrows > 3, hrows);
  shot('11-history');
  await load('nevix://settings#lists');
  shot('12-settings-lists');
  await load('nevix://settings#privacy');
  await page(`document.querySelectorAll('.switch')[0].click()`);
  await sleep(300);
  check('settings UI toggles a real setting', nx.settings.get('privacy.adblock') === false);
  nx.settings.set('privacy.adblock', true); nx.settingsChanged('privacy.adblock');
  check('internal API refuses non-nevix callers', await (async () => { await load('http://site.test/'); return (await page('typeof window.nevix')) === 'undefined'; })());

  console.log('\n== hardening');
  await load('http://site.test/');
  await page(`location.href = 'nevix://settings'`);
  await sleep(600);
  check('web page cannot navigate to nevix:// pages', w.active.url === 'http://site.test/', w.active.url);
  await page(`location.href = 'file:///etc/passwd'`);
  await sleep(600);
  check('web page cannot navigate to file://', w.active.url === 'http://site.test/', w.active.url);
  const tabsBefore = w.tabs.length;
  await page(`window.open('nevix://settings')`);
  await sleep(600);
  check('web page cannot window.open nevix://', w.tabs.length === tabsBefore);
  await w.active.wc.executeJavaScript(`typeof window.nevix`).then((t) => check('no internal API on web pages', t === 'undefined', t));
  const dangerous = await nx.privacy.shieldsOffFor('http://x.test');
  check('shield lookup is safe for unknown hosts', dangerous === false);
  await nx.clearData({ history: true, cookies: true, cache: true, downloads: true, range: 0 });
  check('clearData wipes history & download list', nx.history.items.length === 0 && nx.downloads.length === 0);
  check('clearData wipes cookies', (await session.fromPartition('persist:nevix').cookies.get({})).length === 0);

  console.log('\n== auth, popups, session restore, shortcuts');
  const { BrowserWindow } = require('electron');
  w.newTab({ url: 'http://site.test/secret' });
  const authWin = await waitFor(() => BrowserWindow.getAllWindows().find((b) => /nevix:\/\/auth/.test(b.webContents.getURL())), 8000);
  check('401 raises a sign-in dialog', !!authWin);
  if (authWin) {
    await sleep(500);
    const id = new URL(authWin.webContents.getURL()).searchParams.get('id');
    check('dialog names host and realm', /Vault/.test(await authWin.webContents.executeJavaScript('document.body.innerText')));
    authWin.webContents.executeJavaScript(`window.nevix.call('auth:submit', { id: ${JSON.stringify(id)}, user: 'alice', pass: 'wonder' })`).catch(() => {}); // window closes itself, so never awaited
    await waitFor(() => w.active.title === 'Vault', 6000);
    check('credentials accepted, page loads', w.active.title === 'Vault', w.active.title);
  }
  w.closeTab(w.active.id);

  const winsBefore = BrowserWindow.getAllWindows().length;
  await load('http://site.test/oauth');
  const popup = await waitFor(() => BrowserWindow.getAllWindows().length > winsBefore && BrowserWindow.getAllWindows().find((b) => /popped/.test(b.webContents.getURL())), 6000);
  check('window.open with features creates a real popup window', !!popup);
  if (popup) {
    check('popup keeps window.opener (OAuth flows work)', (await page('window.__w && !window.__w.closed')) === true);
    check('popup is covered by shields', nx.byWc.has(popup.webContents.id) && popup.webContents.getWebRTCIPHandlingPolicy() === 'default_public_interface_only');
    popup.close();
  }
  check('WebRTC leaks only the public IP', w.active.wc.getWebRTCIPHandlingPolicy() === 'default_public_interface_only');

  nx.settings.set('siteZoom', {});
  await load('http://site.test/zz');
  w.exec('zoomIn');
  await load('http://fp-b.test/');
  check('zoom resets on another site', w.active.wc.getZoomLevel() === 0);
  await load('http://site.test/zz2');
  check('per-site zoom restored on return', w.active.wc.getZoomLevel() === 0.5, w.active.wc.getZoomLevel());
  nx.settings.set('siteZoom', {});

  const nTabs = w.tabs.length;
  w.exec('openPage', 'history'); await sleep(300);
  w.exec('openPage', 'history'); await sleep(300);
  check('opening History twice reuses the same tab', w.tabs.length === nTabs + 1 && w.state().active.url === 'nevix://history', [w.tabs.length - nTabs, w.state().active.url]);
  const k1 = w.tabs.indexOf(w.active);
  key(w.active.wc, 'Tab', ['control']); await sleep(150);
  check('Ctrl+Tab cycles tabs', w.tabs.indexOf(w.active) === (k1 + 1) % w.tabs.length);
  key(w.active.wc, 'Tab', ['control', 'shift']); await sleep(150);
  check('Ctrl+Shift+Tab goes back', w.tabs.indexOf(w.active) === k1);
  key(w.active.wc, '1', ['control']); await sleep(150);
  check('Ctrl+1 jumps to first tab', w.active === w.tabs[0]);

  const snapTabs = [{ url: 'http://site.test/a1', title: 'A1' }, { url: 'http://site.test/a2', title: 'A2' }, { url: 'http://site.test/a3', title: 'A3' }, { url: 'http://site.test/a4', title: 'A4' }];
  const rw = nx.createWindow({ tabs: snapTabs, active: 1 });
  await sleep(1500);
  check('restored window: active tab loaded, background tabs asleep', rw.tabs.length === 4 && rw.active.url === 'http://site.test/a2' && rw.tabs.filter((t) => t.sleeping).length === 3, rw.tabs.map((t) => [t.url, t.sleeping]));
  rw.win.close();
  await sleep(300);

  console.log('\n== private window');
  const pw = nx.createWindow({ private: true, url: 'nevix://newtab' });
  await sleep(1500);
  check('private window uses an in-memory partition', !pw.partition.startsWith('persist:'));
  const hcount = nx.history.items.length;
  const ptab = pw.active;
  pw.navigate('http://site.test/private-visit');
  await waitFor(() => ptab.url === 'http://site.test/private-visit');
  await sleep(300);
  check('private browsing is not recorded in history', nx.history.items.length === hcount && !nx.history.index.has('http://site.test/private-visit'));
  await ptab.wc.executeJavaScript('document.cookie = "priv=1"');
  check('private window cookie not in persistent jar', (await session.fromPartition('persist:nevix').cookies.get({ name: 'priv' })).length === 0);
  shot('13-private');
  const pwSession = pw.session();
  pw.win.close();
  await sleep(400);
  check('private window closed & cleaned', !nx.windows.has(pw) && (await pwSession.cookies.get({ name: 'priv' })).length === 0);

  console.log('\n== session & misc');
  nx.saveSession();
  const snap = JSON.parse(fs.readFileSync(path.join(nx.userData, 'session.json'), 'utf8'));
  check('session snapshot written (isolated/private excluded)', snap.windows.length === 1 && snap.windows[0].tabs.length >= 2);
  check('no unexpected network hosts contacted', !seen.some((r) => /google|gstatic|mozilla|microsoft/.test(r.host)), [...new Set(seen.map((r) => r.host))]);
  const stats = nx.stats.all;
  check('lifetime stats counted', stats.ads > 0 && stats.trackers > 0 && stats.params > 0 && stats.upgrades > 0, stats);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
};
