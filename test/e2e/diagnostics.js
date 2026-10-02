module.exports = async ({ nx, w, check, load, sleep, waitFor }) => {
  const t = await load('http://site.test/');
  const r = await nx.diag.start(w.id, t.id, { send() {}, isDestroyed: () => false });
  check('diagnostics attach', r.ok, r);
  await load('http://site.test/diag2');
  await sleep(600);
  const sum = nx.diag.summary();
  check('records requests', sum.total >= 1, sum);
  check('reports protocol + dns method', Object.keys(sum.protocols).length >= 1 && !!sum.dns, sum);
  const ent = nx.diag.entries();
  check('entries have url/status', ent.every((e) => e.url) && ent.some((e) => e.status === 200), ent[0]);
  nx.diag.stop();
  check('stop detaches debugger', !t.wc.debugger.isAttached());
  check('devtools still available', typeof t.wc.openDevTools === 'function');
};
