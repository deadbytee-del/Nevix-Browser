module.exports = async ({ nx, w, check, sleep, waitFor, consoleErrors, shot }) => {
  const pages = ['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'extensions', 'workspaces', 'snapshots', 'permissions', 'privacy', 'network', 'diagnostics', 'flags', 'performance', 'about'];
  for (const p of pages) {
    w.newTab({ url: 'nevix://' + p });
    const t = w.active;
    const errs = [];
    await waitFor(() => t.wc, 3000);
    t.wc.on('console-message', (e) => { if (e.level === 'error') errs.push(e.message); });
    await waitFor(() => t.wc && !t.wc.isLoading(), 8000);
    await sleep(500);
    const info = await t.wc.executeJavaScript('({h1: !!document.querySelector("h1,h2,header"), len: document.body.innerText.length, bg: getComputedStyle(document.body).backgroundColor})');
    check(`nevix://${p} renders`, info.h1 && info.len > 20, info);
    check(`nevix://${p} uses brand background`, info.bg === 'rgb(31, 23, 29)', info.bg);
    check(`nevix://${p} no console errors`, errs.length === 0, errs);
    if (p === 'settings') shot('pages-settings');
    w.closeTab(t.id);
  }
  w.newTab({ url: 'nevix://settings' });
  const t = w.active; await waitFor(() => !t.wc.isLoading(), 8000); await sleep(400);
  const cats = await t.wc.executeJavaScript('[...document.querySelectorAll("[data-cat],nav a,.cat")].map(e=>e.textContent.trim())');
  check('settings lists the 15 categories', ['General', 'Appearance', 'Tabs', 'Privacy', 'Security', 'Performance', 'Network', 'Downloads', 'Extensions', 'Shortcuts', 'Search', 'Sync', 'Developer', 'Flags', 'Advanced'].every((c) => cats.some((x) => x.includes(c))), cats);
  w.closeTab(t.id);
};
