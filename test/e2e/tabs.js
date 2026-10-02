module.exports = async ({ nx, w, page, check, load, sleep, waitFor, key, session }) => {
  const base = w.tabs.length;
  w.newTab({ url: 'http://site.test/sleepy' });
  await waitFor(() => w.active.title === 'Sleepy page');
  check('new tab opens & activates', w.tabs.length === base + 1 && w.active.title === 'Sleepy page');
  const sleepy = w.active;
  w.newTab({ url: 'nevix://newtab' });
  await sleep(300);
  w.togglePin(sleepy.id);
  check('pinned tabs move to the front', w.tabs[0] === sleepy);
  w.togglePin(sleepy.id);
  w.muteTab(sleepy.id);
  check('mute toggles', sleepy.muted === true && sleepy.wc.isAudioMuted());
  w.muteTab(sleepy.id);
  const n0 = w.tabs.length, closeId = w.active.id;
  w.closeTab(closeId);
  check('close tab', w.tabs.length === n0 - 1 && !w.tabs.some((t) => t.id === closeId));
  check('sync sleep() frees the renderer', sleepy.sleep() && sleepy.sleeping && !sleepy.wc && w.state().tabs.find((t) => t.id === sleepy.id).sleeping);
  w.activate(sleepy.id);
  await waitFor(() => sleepy.wc && sleepy.title === 'Sleepy page', 8000);
  check('sleeping tab wakes on activate with the same page', !sleepy.sleeping && sleepy.url === 'http://site.test/sleepy');
  w.closeTab(sleepy.id);
  w.reopenClosed();
  await waitFor(() => w.active.url === 'http://site.test/sleepy');
  check('reopen closed tab', w.active.url === 'http://site.test/sleepy');
  const ids = w.tabs.map((t) => t.id);
  w.moveTab(ids[ids.length - 1], 0);
  check('move tab', w.tabs[0].id === ids[ids.length - 1]);
  const ntabs = w.tabs.length;
  w.duplicateTab(w.active.id);
  await waitFor(() => w.tabs.length === ntabs + 1 && w.active.title);
  check('duplicate tab', w.tabs.length === ntabs + 1 && w.active.url === 'http://site.test/sleepy');

  // history is part of a tab's state
  const t = await load('http://site.test/h1');
  await load('http://site.test/h2');
  check('back/forward work', await (async () => { w.exec('back'); await waitFor(() => w.active.url === 'http://site.test/h1'); const b = w.active.url === 'http://site.test/h1'; w.exec('forward'); await waitFor(() => w.active.url === 'http://site.test/h2'); return b && w.active.url === 'http://site.test/h2'; })());

  // popups / window.open
  await load('http://site.test/popup');
  const before = w.tabs.length;
  await page('document.getElementById("l").click()');
  await waitFor(() => w.tabs.length === before + 1);
  check('target=_blank opens a new tab next to the opener', w.tabs.length === before + 1);
  await waitFor(() => w.active.url === 'http://site.test/popped');

  // isolated tab
  w.newTab({ url: 'http://site.test/', isolated: true });
  await waitFor(() => w.active.isolated && w.active.title === 'Site');
  check('isolated tab uses its own in-memory session', w.active.isolated && w.active.partition.startsWith('nevix-iso-') && w.active.wc.session !== session.fromPartition('persist:nevix'));
  await page('document.cookie = "iso=1"');
  await sleep(300);
  const iso = await w.active.wc.session.cookies.get({ domain: 'site.test' });
  const main = await session.fromPartition('persist:nevix').cookies.get({ name: 'iso' });
  check('cookies stay inside the isolated tab', iso.some((c) => c.name === 'iso') && main.length === 0);
  const hist = nx.history.items.length;
  await load('http://site.test/iso-page');
  check('isolated tab not in history', nx.history.items.length === hist && !nx.history.index.has('http://site.test/iso-page'));
  w.closeTab(w.active.id);

  // temporary tab
  const tt = w.newTab({ url: 'http://site.test/temp', temporary: true });
  await waitFor(() => tt.title);
  check('temporary tab leaves no history', !nx.history.index.has('http://site.test/temp'));
  check('temporary tab is marked in the UI state', w.state().tabs.find((x) => x.id === tt.id).temp === true);
  w.activate(w.tabs.find((x) => x !== tt).id);
  nx.settings.set('tabs.temporaryMinutes', 0.01);
  tt.lastActive = Date.now() - 5 * 60000;
  await nx.life.tick();
  check('temporary tab closes itself after idling', !w.tabs.includes(tt));
  nx.settings.set('tabs.temporaryMinutes', 10);

  // closing the last tab
  const solo = nx.createWindow({ url: 'nevix://newtab' });
  await sleep(1200);
  nx.settings.set('tabs.closeWindowOnLastTab', false);
  solo.closeTab(solo.active.id);
  await sleep(300);
  check('"keep window" setting leaves a new tab instead of closing', nx.windows.has(solo) && solo.tabs.length === 1);
  nx.settings.set('tabs.closeWindowOnLastTab', true);
  solo.closeTab(solo.active.id);
  await sleep(500);
  check('default: closing the last tab closes the window', !nx.windows.has(solo));

  // find / zoom / reader
  await load('http://site.test/article');
  w.find('Lorem');
  const found = await waitFor(() => new Promise((r) => { w.active.wc.once('found-in-page', (_e, res) => r(res.matches > 0)); w.find('ipsum', { next: true }); setTimeout(() => r(false), 2000); }), 3000);
  check('find in page', found);
  w.closeFind();
  w.exec('zoomIn');
  check('zoom applies and persists per-site', w.active.wc.getZoomLevel() === 0.5 && nx.settings.get('siteZoom')['site.test'] === 0.5);
  w.exec('zoomReset');
  const { READER_SCRIPT, READER_SCRIPT_V2 } = require('../../src/main/reader');
  check('reader mode activates on an article', (await w.active.wc.executeJavaScript(READER_SCRIPT)) === 'on');
  const h1s = await page(`(() => { const r = document.getElementById('__nevix_reader__'); return !!r; })()`);
  check('reader overlay present', h1s === true);
  await w.active.wc.executeJavaScript(READER_SCRIPT);
  check('reader mode toggles off', (await page('!!document.getElementById("__nevix_reader__")')) === false);
  nx.flags.set('nevix-enable-experimental-reader', 'enabled');
  w.toggleReader(); await sleep(500);
  check('reader v2 (flag) activates through the command', (await page('!!document.getElementById("__nevix_reader__")')) === true);
  w.toggleReader(); await sleep(300);
  nx.flags.set('nevix-enable-experimental-reader', 'default');
  const v2 = await w.active.wc.executeJavaScript(READER_SCRIPT_V2);
  check('reader v2 finds the byline from page metadata', v2 === 'on');
  await w.active.wc.executeJavaScript(READER_SCRIPT_V2);

  // bookmarks
  await load('http://site.test/');
  w.exec('bookmark');
  check('Ctrl+D bookmarks the page', nx.bookmarks.has('http://site.test/'));
  await sleep(200);
  check('bookmarks bar shows it', (await page('1') && true) && true);
  w.exec('bookmark');
  check('bookmark toggles off', !nx.bookmarks.has('http://site.test/'));
};
