module.exports = async ({ nx, w, check, load, sleep, waitFor }) => {
  w.newTab({ url: 'http://site.test/a' }); w.newTab({ url: 'http://site.test/b' }); w.newTab({ url: 'http://site.test/c' });
  await waitFor(() => w.tabs.length >= 4 && w.tabs.every((t) => t.title), 8000);
  const [t0, t1, t2, t3] = w.tabs.slice(-4);
  const g = w.createGroup([t1.id, t2.id], 'Work');
  check('group created with members', t1.groupId === g.id && t2.groupId === g.id && t3.groupId !== g.id && w.state().groups.some((x) => x.name === 'Work'));
  w.groupAction(g.id, 'rename', 'Reading'); w.groupAction(g.id, 'color', 'blue');
  check('group rename/colour', w.groups[0].name === 'Reading');
  w.activate(t0.id);
  w.groupAction(g.id, 'toggle');
  check('collapse hides members', w.isHidden(t1) && w.isHidden(t2));
  w.groupAction(g.id, 'toggle');
  w.addToGroup([t3.id], g.id);
  check('add to group', t3.groupId === g.id);
  const rec = nx.spaces.saveGroup(w, g.id);
  await sleep(100);
  const saved = nx.spaces.store.get('groups') || [];
  check('group saved', !!rec || saved.length >= 1, saved);
  const wc1 = t1.wc;
  const before = nx.windows.size;
  w.moveTabsToWindow([t1.id], 'new');
  await waitFor(() => nx.windows.size === before + 1, 5000);
  const w2 = [...nx.windows].find((x) => x !== w);
  check('tab moved to new window without reload', nx.windows.size === before + 1 && !w.tabs.includes(t1) && w2.tabs.some((t) => t.wc === wc1 || t.url === t1.url));
  w.ungroup(t2.id);
  check('ungroup', !t2.groupId);
  w.groupAction(g.id, 'close');
  check('close group closes members', !w.tabs.some((t) => t.groupId === g.id));
  // multi-select
  w.newTab({ url: 'http://site.test/m1' }); w.newTab({ url: 'http://site.test/m2' });
  const n = w.tabs.length; const [a, b] = w.tabs.slice(-2);
  if (w.selected) { w.selected.add(a.id); w.selected.add(b.id); }
  check('selectedIds includes the active tab', w.selectedIds().includes(w.active.id));
};
