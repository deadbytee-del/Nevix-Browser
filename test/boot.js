module.exports = async (nx, { app }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const w = nx.lastWindow;
  await sleep(2500);
  console.log('BOOT OK tabs=', w.tabs.length, 'url=', w.active && w.active.url, 'rules=', nx.privacy.rules.count);
  console.log('state ok', !!w.state());
  app.exit(0);
};
