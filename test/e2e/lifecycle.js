module.exports = async ({ nx, w, page, check, load, sleep, waitFor, ui, shot }) => {
  // helper: a background tab at a given page
  const bg = async (url) => { const t = w.newTab({ url, background: true }); await waitFor(() => t.wc && !t.wc.isLoading() && t.title, 8000); await sleep(150); return t; };
  nx.life; // make sure the manager exists
  nx.settings.set('performance.idleAfterMinutes', 1); nx.settings.set('performance.freezeAfterMinutes', 5); nx.settings.set('performance.suspendAfterMinutes', 20); nx.settings.set('performance.discardAfterMinutes', 120);

  // ---- freezing really stops page timers ---------------------------------------------------------------------------
  const ct = await bg('http://site.test/counter');
  const n1 = await ct.wc.executeJavaScript('window.__n'); await sleep(2300); const n2 = await ct.wc.executeJavaScript('window.__n');
  check('background tab still runs its timers (throttled by the engine) before freezing', n2 > n1, [n1, n2]);
  const n0 = await ct.wc.executeJavaScript('window.__n');
  check('freezeTab() freezes it', await nx.life.freezeTab(w, ct.id) && ct.stage === 'frozen');
  // JavaScript cannot be evaluated in a frozen page, so prove it from the outside: while frozen for 1.4 s a 50 ms timer must not tick.
  const probe = ct.wc.executeJavaScript('window.__n').then((v) => ({ v }), () => ({ v: -1 }));
  await sleep(1400);
  const stillPending = await Promise.race([probe.then(() => false), sleep(50).then(() => true)]);
  check('a frozen tab cannot run JavaScript (evaluation stays pending)', stillPending === true);
  w.activate(ct.id);
  const resumed = await probe;
  await sleep(200);
  const n3 = await ct.wc.executeJavaScript('window.__n');
  check('activating a frozen tab resumes it instantly — same page, state intact', ct.stage === 'active' && resumed.v >= n0 && resumed.v - n0 < 12 && n3 > resumed.v, [n0, resumed.v, n3]);
  w.activate(w.tabs[0].id);

  // ---- suspending keeps history and scroll ----------------------------------------------------------------------------
  const st = await bg('http://site.test/h1');
  st.load('http://site.test/scroll'); await waitFor(() => st.title === 'Scroll', 8000); await sleep(200);
  await st.wc.executeJavaScript('window.scrollTo(0, 1500)'); await sleep(200);
  const before = process.memoryUsage().rss;
  check('suspendTab() releases the renderer', await nx.life.suspendTab(w, st.id) && st.stage === 'suspended' && !st.wc);
  check('suspended tab keeps its URL, title and back/forward history', st.url === 'http://site.test/scroll' && st.restore && st.restore.entries.length >= 2, st.restore && st.restore.entries.map((e) => e.url));
  check('suspended tab is marked in the UI state', w.state().tabs.find((t) => t.id === st.id).stage === 'suspended');
  w.activate(st.id);
  await waitFor(() => st.wc && !st.wc.isLoading() && st.title === 'Scroll', 8000); await sleep(500);
  check('waking restores history', st.canBack === true || st.wc.navigationHistory.canGoBack());
  const sy = await st.wc.executeJavaScript('window.scrollY');
  check('waking restores the scroll position', sy > 1000, sy);
  w.activate(w.tabs[0].id);

  // ---- discarding keeps only URL + title -----------------------------------------------------------------------------------
  const dt = await bg('http://site.test/sleepy');
  check('discarded stage drops history but keeps URL and title', dt.discard() && dt.stage === 'discarded' && dt.restore === null && dt.url === 'http://site.test/sleepy' && dt.title === 'Sleepy page');
  w.activate(dt.id); await waitFor(() => dt.wc && dt.title === 'Sleepy page' && !dt.wc.isLoading(), 8000);
  check('a discarded tab reloads when opened', dt.stage === 'active' && dt.wc);
  w.activate(w.tabs[0].id);

  // ---- the scheduler walks tabs through the stages by age (no polling) -------------------------------------------------
  const t = await bg('http://site.test/sleepy');
  const stage = async (ageMin) => { t.lastActive = Date.now() - ageMin * 60000; await nx.life.tick(); return t.stage; };
  check('stage: young background tab stays active', (await stage(0.2)) === 'active');
  check('stage: idle after 1 minute', (await stage(2)) === 'idle');
  check('stage: frozen after 5 minutes', (await stage(6)) === 'frozen');
  check('stage: suspended after 20 minutes', (await stage(25)) === 'suspended' && !t.wc);
  check('stage: never discarded automatically without the flag', (await stage(500)) === 'suspended');
  nx.flags.set('nevix-enable-experimental-tab-discarding', 'enabled');
  check('stage: discarded after 120 minutes with the flag', (await stage(500)) === 'discarded');
  nx.flags.set('nevix-enable-experimental-tab-discarding', 'default');
  w.closeTab(t.id);

  // ---- exemptions ---------------------------------------------------------------------------------------------------------
  const pinned = await bg('http://site.test/sleepy'); w.togglePin(pinned.id);
  pinned.lastActive = Date.now() - 500 * 60000; nx.flags.set('nevix-enable-experimental-tab-discarding', 'enabled'); await nx.life.tick();
  check('pinned tabs are never discarded', pinned.stage !== 'discarded');
  nx.flags.set('nevix-enable-experimental-tab-discarding', 'default'); w.closeTab(pinned.id);
  const media = await bg('http://site.test/sleepy'); media.usesMedia = true; media.lastActive = Date.now() - 100 * 60000; await nx.life.tick();
  check('a tab using the camera/microphone is never throttled', media.stage === 'active');
  w.closeTab(media.id);
  const dev = await bg('http://site.test/sleepy'); dev.wc.openDevTools({ mode: 'detach' }); await sleep(800); dev.lastActive = Date.now() - 100 * 60000; await nx.life.tick();
  check('a tab with developer tools open is never throttled', dev.stage === 'active');
  dev.wc.closeDevTools(); w.closeTab(dev.id);
  const internal = await bg('nevix://about'); internal.lastActive = Date.now() - 100 * 60000; await nx.life.tick();
  check('internal pages are not suspended', !internal.sleeping);
  w.closeTab(internal.id);

  // ---- aggressive freezing flag ----------------------------------------------------------------------------------------------
  const base = nx.life.thresholds();
  nx.flags.set('nevix-enable-aggressive-tab-freezing', 'enabled');
  const fast = nx.life.thresholds();
  check('aggressive flag shortens every stage (÷4, minimum 15 s)', Math.abs(fast.freeze - base.freeze / 4) < 1e-9 && Math.abs(fast.suspend - base.suspend / 4) < 1e-9 && fast.idle >= 0.25);
  nx.flags.set('nevix-enable-aggressive-tab-freezing', 'default');

  // ---- scheduler arms a single timer only when needed ------------------------------------------------------------------------
  for (const x of [...w.tabs].slice(1)) w.closeTab(x.id);
  nx.life.reschedule();
  check('no timers while there are no background tabs', nx.life.timer === null && nx.life.memTimer === null);
  const later = await bg('http://site.test/sleepy'); nx.life.reschedule();
  check('one timer armed for the next transition when a background tab exists', nx.life.timer !== null);
  w.closeTab(later.id);

  // ---- memory pressure manager (flag) ------------------------------------------------------------------------------------------
  const m1 = await bg('http://site.test/sleepy'); m1.lastActive = Date.now() - 2 * 60000;
  const osm = require('os'); const realFree = osm.freemem;
  nx.flags.set('nevix-enable-memory-pressure-manager', 'enabled'); nx.life.reschedule();
  check('memory-pressure checks run only with the flag on', nx.life.memTimer !== null);
  osm.freemem = () => osm.totalmem() * 0.05;
  await nx.life.memoryCheck();
  osm.freemem = realFree;
  check('under memory pressure the oldest background tab is frozen first', m1.stage === 'frozen' || m1.stage === 'suspended', m1.stage);
  nx.flags.set('nevix-enable-memory-pressure-manager', 'default'); nx.life.reschedule();
  check('no memory-pressure timer when the flag is off', nx.life.memTimer === null);
  w.closeTab(m1.id);

  // ---- renderer prewarm (flag) ---------------------------------------------------------------------------------------------------
  check('no spare renderer by default', nx.life.spare === null);
  nx.flags.set('nevix-enable-renderer-prewarm', 'enabled'); nx.life.reschedule();
  await waitFor(() => nx.life.spare, 4000);
  check('prewarm keeps one hidden, loaded new-tab renderer', !!nx.life.spare && !nx.life.spare.webContents.isDestroyed());
  const spareId = nx.life.spare && nx.life.spare.webContents.id;
  const nt = w.newTab({ url: 'nevix://newtab' });
  check('a new tab adopts the prewarmed renderer', nt.wc && nt.wc.id === spareId);
  await waitFor(() => !nt.wc.isLoading(), 6000);
  check('the adopted tab is fully working', (await page('document.querySelector(".brand").textContent', nt)) === 'Nevix');
  await waitFor(() => nx.life.spare, 4000);
  check('a replacement spare is prepared afterwards', !!nx.life.spare && nx.life.spare.webContents.id !== spareId);
  nx.flags.set('nevix-enable-renderer-prewarm', 'default'); nx.life.reschedule();
  check('turning the flag off releases the spare', nx.life.spare === null);
  w.closeTab(nt.id);
  shot('04-lifecycle');
};
