'use strict';
// End-to-end suite: runs inside the real application (see test/run-e2e.sh).
// Hostnames ending in .test (and doubleclick.net etc.) are mapped to 127.0.0.1 by --host-resolver-rules.
// Sections live in test/e2e/*.js; select some with SECTIONS=privacy,tabs
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SECTIONS = [
  'boot', 'privacy', 'fingerprint', 'tabs', 'lifecycle', 'groups', 'permissions', 'downloads', 'flags', 'workspaces',
  'omnibox', 'pages', 'extensions', 'diagnostics', 'performance', 'private', 'hardening',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, step = 60) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); }
  return false;
}

// ---- fake web ----------------------------------------------------------------------------------------------------
function makeServer(seen) {
  const WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  return http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    seen.push({ host, url: req.url, headers: req.headers });
    const send = (body, type = 'text/html', extra = {}) => { res.writeHead(200, { 'content-type': type, ...extra }); res.end(body); };
    const u = req.url;
    if (u === '/first.js') return send('window.__first = true;', 'text/javascript');
    if (/pixel|\.js$/.test(u) && host !== 'site.test' && !/^\/(first|ext)/.test(u)) return send('window.__tracker = true;', 'text/javascript');
    if (u === '/set-cookie.gif') return send('GIF89a', 'image/gif', { 'set-cookie': 'tp=1; Path=/' });
    if (u.startsWith('/dl/')) {                                    // /dl/<kb>/<ms total>/<name>
      const [, , kb, ms, name] = u.split('/');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': kb * 1024, 'content-disposition': `attachment; filename="${name || 'file.bin'}"` });
      const chunks = 8, per = Math.floor((kb * 1024) / chunks);
      let i = 0;
      const tick = () => { if (i++ < chunks) { res.write(Buffer.alloc(i === chunks ? kb * 1024 - per * (chunks - 1) : per, 7)); setTimeout(tick, ms / chunks); } else res.end(); };
      return tick();
    }
    if (u === '/file.bin') return send(Buffer.alloc(200000, 7), 'application/octet-stream', { 'content-disposition': 'attachment; filename="test.bin"' });
    if (u === '/setup.exe') return send(Buffer.alloc(5000, 1), 'application/octet-stream', { 'content-disposition': 'attachment; filename="setup.exe"' });
    if (u === '/article') return send(`<html><head><title>Article</title><meta name="author" content="Ada Lovelace"></head><body><nav>menu menu</nav><article><h1>Big Story</h1>${'<p>' + 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(6) + '</p>'}${'<p>' + 'Second paragraph of the story, long enough to count as content. '.repeat(5) + '</p>'}<script>window.evil=1</script><p>${'More words follow here and there. '.repeat(10)}</p></article><div class="footer">footer</div></body></html>`);
    if (u.startsWith('/fp')) return send('<html><head><title>fp</title><script>window.__hc = navigator.hardwareConcurrency; window.__early = typeof navigator.deviceMemory;</script></head><body>fp</body></html>');
    if (u === '/perm') return send('<title>perm</title><button id=b>go</button>');
    if (u === '/popup') return send('<title>popup</title><a id=l target=_blank href="/popped">x</a>');
    if (u === '/popped') return send('<title>popped</title>popped');
    if (u === '/popgate') return send('<title>popgate</title><script>window.__open = window.open("/popped"); window.__openNull = window.__open === null;</script><button id=b onclick="window.__g = !!window.open(\'/popped\')">go</button>');
    if (u === '/autoplay') return send(`<title>autoplay</title><script>
      window.__play = 'pending';
      const a = new Audio('${WAV}'); a.loop = true;
      a.play().then(() => { window.__play = 'played'; }, (e) => { window.__play = 'rejected:' + e.name; });
      const ctx = new AudioContext(); window.__ac = ctx.state;
    </script>`);
    if (u === '/sleepy') return send('<title>Sleepy page</title>zzz');
    if (u === '/counter') return send('<title>counter</title><script>window.__n = 0; setInterval(() => { window.__n++; }, 50);</script>');
    if (u === '/scroll') return send('<title>Scroll</title><div style="height:6000px">tall</div>');
    if (u.startsWith('/ref')) return send('<title>ref</title>ref');
    if (u === '/secret') {
      const ok = req.headers.authorization === 'Basic ' + Buffer.from('alice:wonder').toString('base64');
      if (!ok) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Vault"' }); return res.end('no'); }
      return send('<title>Vault</title>welcome alice');
    }
    if (u === '/oauth') return send('<title>oauth</title><script>window.__w = window.open("/popped", "auth", "width=420,height=380");</script>');
    if (host === 'bnc-a.test' && u === '/start') { res.writeHead(302, { location: 'http://bnc-mid.test/hop' }); return res.end(); }
    if (host === 'bnc-mid.test' && u === '/hop') { res.writeHead(302, { location: 'http://bnc-b.test/end', 'set-cookie': 'bounce=1; Path=/' }); return res.end(); }
    if (host === 'strict.test' && u === '/') return send('<title>strict</title><img src="http://tp.test/pixel.gif?uid=5"><img src="http://tp.test/logo.png">');
    if (host === 'site.test' && u === '/') {
      return send(`<html><head><title>Site</title></head><body><h1>Hello</h1>
        <script src="/first.js"></script>
        <script src="http://doubleclick.net/ad.js"></script>
        <script src="http://www.google-analytics.com/analytics.js"></script>
        <img src="http://other.test/set-cookie.gif">
        <ins class="adsbygoogle" id="adslot" style="display:block;width:100px;height:100px">AD</ins>
        <div id="onetrust-consent-sdk" style="display:block">cookies!</div></body></html>`);
    }
    send(`<html><head><title>${host}</title></head><body>${host}${u}</body></html>`);
  });
}

module.exports = async (nx, { app, session }) => {
  const out = process.env.NEVIX_OUT || os.tmpdir();
  const seen = [];
  let pass = 0, fail = 0;
  const failures = [];
  let current = '';
  const ctx = {
    nx, app, session, seen, out, sleep, waitFor, os, fs, path,
    check(name, cond, extra) {
      if (cond) { pass++; console.log('  ok   ' + name); }
      else { fail++; failures.push(`${current}: ${name}`); console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
    },
    shot(name) { try { execSync(`import -window root ${out}/${name}.png`); } catch {} },
  };

  const server = makeServer(seen);
  await new Promise((resolve) => server.listen(80, '127.0.0.1', resolve)).catch(() => {});
  if (!server.listening) { console.log('cannot bind :80 — run as root'); app.exit(2); return; }
  ctx.server = server;

  const w = nx.lastWindow;
  w.win.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  ctx.w = w;
  w.ui.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('  [UI error] ' + e.message); });
  ctx.ui = (js) => w.ui.webContents.executeJavaScript(js);
  ctx.page = (js, tab = w.active) => tab.wc.executeJavaScript(js);
  ctx.dl = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-dl-'));
  nx.settings.set('general.downloadDir', ctx.dl);
  ctx.load = async (url, win = w) => {
    const tab = win.active;
    win.navigate(url);
    await sleep(80);
    await waitFor(() => !tab.loading && tab.wc && !tab.wc.isLoading(), 10000);
    await sleep(120);
    return tab;
  };
  ctx.key = (target, keyCode, modifiers = []) => target.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  ctx.setPriv = (k, v) => { nx.settings.set('privacy.' + k, v); nx.settingsChanged('privacy.' + k); };
  ctx.setFlag = (id, state) => { nx.flags.set(id, state); nx.settingsChanged(''); if (nx.lazyModules.life) nx.life.touch(); };
  ctx.internal = (cmd, arg) => nx.ipcInternal(cmd, arg);
  ctx.consoleErrors = (wc) => { const errs = []; wc.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); }); return errs; };

  const only = process.env.SECTIONS ? process.env.SECTIONS.split(',') : SECTIONS;
  for (const name of SECTIONS) {
    if (!only.includes(name)) continue;
    current = name;
    ctx.setPriv('httpsOnly', false);
    console.log(`\n== ${name}`);
    try { await require(`./e2e/${name}.js`)(ctx); }
    catch (e) { fail++; failures.push(`${name}: threw ${e.message}`); console.log('  FAIL section threw: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')); }
    // every section starts from the same state
    ctx.setPriv('httpsOnly', false); nx.privacy.rules.setSite('site.test', false);
    while (nx.windows.size > 1) { const extra = [...nx.windows].find((x) => x !== w); extra.win.close(); await sleep(200); }
    for (const t of [...w.tabs].slice(1)) w.closeTab(t.id);
    await sleep(150);
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) console.log('Failures:\n  ' + failures.join('\n  '));
  app.exit(fail ? 1 : 0);
};
