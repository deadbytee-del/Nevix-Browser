module.exports = async ({ nx, w, page, check, load, sleep, waitFor, setPriv }) => {
  const P = nx.perm;
  const o = 'http://site.test';
  check('default for camera is ask or block', ['ask', 'block'].includes(P.state(o, 'camera')));
  P.set(o, 'camera', 'allow');
  check('stored allow applies', P.state(o, 'camera') === 'allow');
  check('other origin unaffected', P.state('http://other.test', 'camera') !== 'allow');
  P.set(o, 'camera', 'block', { persist: false });
  check('session override beats stored', P.state(o, 'camera') === 'block');
  P.set(o, 'camera', 'default');
  P.set(o, 'camera', 'default', { persist: true });
  check('default clears stored', P.stored(o, 'camera') === undefined);
  P.allowOnce('t1', o, 'microphone');
  check('allow once applies to that tab only', P.state(o, 'microphone', 't1') === 'allow' && P.state(o, 'microphone', 't2') !== 'allow');
  P.forgetTab('t1');
  check('allow once forgotten with the tab', P.state(o, 'microphone', 't1') !== 'allow');
  P.set(o, 'notifications', 'block'); P.set(o, 'geolocation', 'allow');
  P.reset(o);
  check('reset removes all decisions for the origin', P.stored(o, 'notifications') === undefined && P.stored(o, 'geolocation') === undefined);
  let threw = false; try { P.set(o, 'nonsense', 'allow'); } catch { threw = true; }
  check('unknown permission rejected', threw);
  check('catalog covers required permissions', ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard', 'popups', 'downloads', 'autoplay', 'bluetooth', 'usb', 'sensors', 'midi'].every((id) => P.catalog.some((c) => c.id === id)));

  // popups
  P.set(o, 'popups', 'block');
  const t = await load(o + '/popgate');
  check('popup blocked by policy', (await page('window.__openNull')) === true);
  P.set(o, 'popups', 'default');

  // clear site data
  await page('document.cookie = "a=1; path=/"; localStorage.x = "1"');
  P.set(o, 'camera', 'allow');
  await P.resetSite(o);
  await sleep(200);
  check('resetSite drops permission', P.stored(o, 'camera') === undefined);
  check('resetSite drops cookies', (await t.wc.session.cookies.get({ domain: 'site.test', name: 'a' })).length === 0);
};
