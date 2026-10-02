module.exports = async ({ nx, check, ui }) => {
  const F = nx.flags;
  const list = F.list();
  check('flags have ids, defaults and descriptions', list.length >= 8 && list.every((f) => f.id && typeof f.default === 'boolean' && f.description));
  check('ids are unique', new Set(list.map((f) => f.id)).size === list.length);
  const f = list.find((x) => x.restart) || list[0];
  const before = F.on(f.id);
  F.set(f.id, before ? 'disabled' : 'enabled');
  check('set flips effective value', F.on(f.id) === !before);
  const l2 = F.list().find((x) => x.id === f.id);
  check('restart indicator shown for restart flags', !f.restart || l2.restartPending === true, l2);
  F.reset(f.id);
  check('reset restores default', F.on(f.id) === f.default && F.state(f.id) === 'default');
  F.set(f.id, f.default ? 'disabled' : 'enabled');
  F.safeMode = true;
  check('safe mode ignores user overrides', F.on(f.id) === f.default);
  F.safeMode = false;
  F.resetAll();
  check('reset all', F.list().every((x) => x.state === 'default'));
  let threw = false; try { F.set('nope', 'enabled'); } catch { threw = true; }
  check('unknown flag rejected', threw);
  const exp = list.find((x) => x.experimental);
  if (exp) { F.set(exp.id, exp.default ? 'disabled' : 'enabled'); const hit = F.disableExperimental(); check('crash recovery disables experimental flags', hit.includes(exp.id) && F.state(exp.id) === 'default'); F.resetAll(); }
};
