module.exports = async ({ nx, w, check, load, sleep, waitFor, page, path }) => {
  nx.settings.set('extensions.enabled', true);
  const res = await nx.ext.installFromPath(path.join(__dirname, '../fixtures/ext'));
  check('extension installs', res.ok, res);
  const t = await load('http://site.test/extpage');
  await waitFor(async () => (await page('document.documentElement.getAttribute("data-nevix-ext")')) === 'ran', 5000);
  check('content script runs', (await page('document.documentElement.getAttribute("data-nevix-ext")')) === 'ran');
  const item = nx.ext.list().find((x) => x.id === res.id);
  check('listing shows permissions', item && item.name === 'Nevix Test Extension' && Array.isArray(item.permissions) && item.permissions.some((p) => p.id === 'cookies'), item);
  await nx.ext.setBlockedSites(res.id, ['site.test']);
  await load('http://site.test/extpage2');
  await sleep(500);
  check('per-site restriction stops the extension', (await page('document.documentElement.getAttribute("data-nevix-ext")')) !== 'ran');
  check('overhead report present', typeof nx.ext.overhead() === 'object');
  await nx.ext.setEnabled(res.id, false);
  check('disable', nx.ext.list().find((x) => x.id === res.id).enabled === false);
  await nx.ext.remove(res.id);
  check('remove', !nx.ext.list().some((x) => x.id === res.id));
};
