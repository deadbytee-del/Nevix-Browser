module.exports = async ({ nx, w, page, seen, session, check, shot, load, setPriv, sleep, waitFor }) => {
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
  check('Sec-GPC sent', firstReq.headers['sec-gpc'] === '1');
  check('no high-entropy client hints', !Object.keys(firstReq.headers).some((h) => /sec-ch-ua-(full|platform-version|arch|model|bitness)/.test(h)));
  check('request UA is clean', !/Electron|Nevix/.test(firstReq.headers['user-agent']));

  // ---- dashboard data ------------------------------------------------------------------------------------------
  const sum = nx.ipcInternal('privacy:summary');
  const row = sum.sites.find((s) => s.site === 'site.test');
  check('dashboard lists the site with counts', row && row.ads >= 1 && row.trackers >= 1 && row.third >= 3 && row.first >= 1, row);
  const det = await nx.ipcInternal('privacy:detail', { site: 'site.test' });
  const blockedHosts = det.blocked.map((b) => b.host);
  check('dashboard explains each block (rule, list, category)', det.blocked.length >= 2 && det.blocked.every((b) => b.rule && b.list && b.category && b.url), det.blocked[0]);
  check('dashboard knows which hosts were contacted', det.hosts.some((h) => h.host === 'doubleclick.net' && h.blocked >= 1 && h.third), det.hosts);
  check('dashboard reports protections and cookies', det.protections['Ad blocking'] === true && typeof det.cookies === 'number' && det.blocked.some((b) => /doubleclick/.test(b.host)));
  check('dashboard record counts the isolated third-party cookie', det.cookiesBlocked >= 1 || det.isolated >= 1, [det.cookiesBlocked, det.isolated]);
  check('rule tester agrees with the dashboard', nx.ipcInternal('network:test', { url: 'http://doubleclick.net/ad.js', top: 'site.test', type: 'script' }).action === 'block');
  shot('02-blocked');

  // ---- custom rules: allow (per site), block (first-party), isolate ------------------------------------------------
  nx.privacy.rules.setCustomText('@@||doubleclick.net^$domain=site.test\n');
  seen.length = 0;
  tab = await load('http://site.test/');
  check('custom allow rule overrides the built-in list for that site', (await page('window.__tracker')) === true && seen.some((r) => r.host === 'doubleclick.net'));
  nx.privacy.rules.setCustomText('block ||site.test/first.js\n');
  tab = await load('http://site.test/');
  check('custom block rule can block first-party requests', (await page('typeof window.__first')) === 'undefined');
  nx.privacy.rules.setCustomText('isolate ||other.test^\n');
  seen.length = 0;
  tab = await load('http://site.test/');
  const c2 = await session.fromPartition('persist:nevix').cookies.get({ domain: 'other.test' });
  check('isolate rule lets the request through without cookies', seen.some((r) => r.host === 'other.test' && !r.headers.cookie) && c2.length === 0);
  nx.privacy.rules.setCustomText('');
  check('custom rules export/import round-trip', nx.ipcInternal('network:customGet') === '');

  // ---- per-site shields: permanent & temporary ----------------------------------------------------------------------
  nx.privacy.rules.setSite('site.test', true);
  seen.length = 0;
  tab = await load('http://site.test/');
  check('shields off: tracker requests allowed', seen.some((r) => r.host === 'doubleclick.net'));
  nx.privacy.rules.setSite('site.test', false);
  nx.privacy.rules.allowTemporarily('site.test', 0.02);
  seen.length = 0; tab = await load('http://site.test/');
  check('temporary allowlist lets trackers through', seen.some((r) => r.host === 'doubleclick.net'));
  await sleep(1400);
  check('temporary allowlist expires by itself (no timers needed)', nx.privacy.rules.shieldsOff('site.test') === false && nx.privacy.rules.tempList().length === 0);
  seen.length = 0; tab = await load('http://site.test/');
  check('shields back on after expiry', !seen.some((r) => r.host === 'doubleclick.net'));

  // ---- headers, params, https -----------------------------------------------------------------------------------------
  seen.length = 0;
  await load('http://site.test/refpage');
  await page(`(() => { const i = document.createElement('iframe'); i.src = 'http://other.test/ref?x=1'; document.body.append(i); })()`);
  await sleep(500);
  const refReq = seen.find((r) => r.host === 'other.test' && r.url.startsWith('/ref'));
  check('cross-site Referer trimmed to origin', refReq && refReq.headers.referer === 'http://site.test/', refReq && refReq.headers.referer);
  seen.length = 0;
  await load('http://site.test/p?utm_source=nl&fbclid=zzz&keep=1');
  check('tracking params stripped from navigation', w.active.url === 'http://site.test/p?keep=1', w.active.url);
  check('server never saw tracking params', seen[0] && !/utm_|fbclid/.test(seen[0].url));
  setPriv('httpsOnly', true);
  seen.length = 0;
  w.navigate('http://plain.test/');
  await waitFor(() => /nevix:\/\/error/.test(w.active.url), 10000);
  await sleep(500);
  check('http:// upgraded; no cleartext request reached the server', !seen.some((r) => r.host === 'plain.test'));
  check('https failure shows interstitial', /type=https/.test(w.active.url) && w.state().active.url.startsWith('https://plain.test') && w.state().active.secure === false, w.state().active);
  shot('03-https-warning');
  await w.active.wc.executeJavaScript('document.querySelector(".btn.danger").click()');
  await waitFor(() => w.active.url.startsWith('http://plain.test'), 8000);
  check('"continue" loads over http for this session', w.active.url === 'http://plain.test/');
  setPriv('httpsOnly', false);

  // ---- strict tracker blocking (flag) -----------------------------------------------------------------------------------
  seen.length = 0;
  await load('http://strict.test/');
  const looseHit = seen.some((r) => r.host === 'tp.test' && r.url.startsWith('/pixel.gif'));
  check('without the strict flag a third-party pixel is allowed', looseHit);
  nx.flags.set('nevix-enable-strict-tracker-blocking', 'enabled');
  seen.length = 0;
  await load('http://strict.test/');
  check('strict flag blocks third-party pixels carrying identifiers', !seen.some((r) => r.host === 'tp.test' && r.url.startsWith('/pixel.gif')));
  check('strict flag leaves ordinary third-party images alone', seen.some((r) => r.host === 'tp.test' && r.url === '/logo.png'));
  const sd = await nx.ipcInternal('privacy:detail', { site: 'strict.test' });
  check('strict block is explained in the dashboard', sd.blocked.some((b) => /strict mode/.test(b.list) && /identifier/.test(b.rule)), sd.blocked);
  nx.flags.set('nevix-enable-strict-tracker-blocking', 'default');

  // ---- bounce tracking protection --------------------------------------------------------------------------------------------
  const ses = session.fromPartition('persist:nevix');
  w.navigate('http://bnc-a.test/start');
  await waitFor(() => w.active.url === 'http://bnc-b.test/end', 8000);
  check('redirect chain completed', w.active.url === 'http://bnc-b.test/end', w.active.url);
  const had = await ses.cookies.get({ domain: 'bnc-mid.test' });
  await sleep(2200);
  const after = await ses.cookies.get({ domain: 'bnc-mid.test' });
  check('bounce tracker cookie purged after the redirect', after.length === 0 && nx.stats.all.bounces >= 1, { had: had.length, after: after.length, bounces: nx.stats.all.bounces });
  nx.history.add('http://bnc-mid.test/hop', 'visited by the user');
  w.navigate('http://bnc-a.test/start');
  await waitFor(() => w.active.url === 'http://bnc-b.test/end', 8000);
  await sleep(2200);
  const kept = await ses.cookies.get({ domain: 'bnc-mid.test' });
  check('a site the user has visited is not treated as a bounce tracker', kept.length >= 1, kept.length);
  nx.flags.set('nevix-enable-bounce-tracking-protection', 'disabled');
  await ses.cookies.remove('http://bnc-mid.test/', 'bounce').catch(() => {});
  nx.history.remove('http://bnc-mid.test/hop');
  w.navigate('http://bnc-a.test/start');
  await waitFor(() => w.active.url === 'http://bnc-b.test/end', 8000);
  await sleep(2200);
  check('flag off: nothing is purged', (await ses.cookies.get({ domain: 'bnc-mid.test' })).length >= 1);
  nx.flags.set('nevix-enable-bounce-tracking-protection', 'default');
  await ses.clearStorageData();

  // ---- redirect abuse -------------------------------------------------------------------------------------------------------------
  const loop = require('http').createServer((req, res) => { res.writeHead(302, { location: '/r?' + Math.random() }); res.end(); });
  await new Promise((r) => loop.listen(0, '127.0.0.1', r));
  const lp = loop.address().port;
  w.navigate(`http://localhost:${lp}/r`);
  await waitFor(() => w.active.errorFor || /error/.test(w.active.url), 10000);
  await sleep(300);
  check('endless redirect loop is stopped', !!w.active.errorFor || /nevix:\/\/error/.test(w.active.url), w.active.url);
  loop.close();
  check('lifetime stats counted', nx.stats.all.ads > 0 && nx.stats.all.trackers > 0 && nx.stats.all.params > 0 && nx.stats.all.upgrades > 0, nx.stats.all);
};
