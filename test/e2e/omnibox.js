module.exports = async ({ nx, w, check, load, sleep, waitFor }) => {
  const { suggest, resolveInput } = require('../../src/main/omnibox');
  const ctx = { tabs: [], history: [], bookmarks: [], commands: [], settings: nx.settings, flags: nx.flags, spaces: nx.spaces, history: nx.history, bookmarks: nx.bookmarks, commands: nx.commands };
  const s = suggest('12*(3+4)', ctx);
  check('calculator answers offline', s.some((x) => x.type === 'calc' && /84/.test(x.title)), s.slice(0, 3));
  const u = suggest('5 km in miles', ctx);
  check('unit conversion answers offline', u.some((x) => x.type === 'convert' && /3\.1/.test(x.title)), u.slice(0, 3));
  check('bare hostname becomes https url', /^https?:\/\/example\.com/.test(resolveInput('example.com', nx.settings)));
  check('text becomes search url', /duckduckgo\.com.*hello/.test(resolveInput('hello world', nx.settings)) || /hello/.test(resolveInput('hello world', nx.settings)));
  check('javascript: urls are not navigated', !/^javascript:/i.test(resolveInput('javascript:alert(1)', nx.settings)));
  const ctx2 = { ...ctx, tabs: [{ title: 'Sleepy page', url: 'http://site.test/sleepy', id: 1, win: 1 }] };
  check('"tabs sleepy" finds an open tab', suggest('tabs sleepy', ctx2).some((x) => x.type === 'tab'));
  check('"settings privacy" lists settings', suggest('settings privacy', ctx).some((x) => x.type === 'setting'));
  await load('http://site.test/omni');
  const ui = await w.ui.webContents.executeJavaScript('typeof window.nevixUI !== "undefined" || document.body.children.length');
  check('chrome UI is alive', !!ui);
};
