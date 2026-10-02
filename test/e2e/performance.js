module.exports = async ({ nx, w, check, load, sleep }) => {
  await load('http://site.test/');
  const s = await nx.perf.snapshot();
  check('snapshot has memory + processes + tabs', s && s.browser && s.system && s.processes && s.tabList, Object.keys(s || {}));
  check('snapshot lists the active tab', s.tabList.some((t) => t.active));
  const st = nx.perf.startup();
  check('startup measurement recorded', st && typeof st === 'object', st);
  check('advice is an array', Array.isArray(nx.perf.advice(s.tabList, 0.5)));
  const t0 = Date.now(); await nx.perf.snapshot(); check('snapshot < 500ms', Date.now() - t0 < 500);
};
