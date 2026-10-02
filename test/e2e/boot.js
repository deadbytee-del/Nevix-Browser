module.exports = async ({ nx, w, ui, page, check, shot, waitFor, sleep }) => {
  await waitFor(async () => (await ui('document.querySelectorAll(".tab").length')) === 1);
  check('UI rendered one tab', (await ui('document.querySelectorAll(".tab").length')) === 1);
  check('new tab page loaded', /newtab/.test(w.active.url), w.active.url);
  check('window visible', w.win.isVisible());
  check('UA hides Electron/app name', !/Electron|Nevix/.test(await page('navigator.userAgent')), await page('navigator.userAgent'));
  check('startup marks recorded', nx.marks.processCreated && nx.marks.firstWindowShown && nx.marks.firstWindowShown >= nx.marks.ready, nx.marks);
  const t = await ui(`(() => { const s = getComputedStyle(document.documentElement); return [s.getPropertyValue('--color-primary').trim().toLowerCase(), s.getPropertyValue('--color-background').trim().toLowerCase(), s.getPropertyValue('--color-danger').trim().toLowerCase()]; })()`);
  check('brand design tokens reach the chrome', t[0] === '#9d64a3' && t[1] === '#1f171d' && t[2] === '#783124', t);
  const pageTokens = await page(`(() => { const s = getComputedStyle(document.documentElement); return s.getPropertyValue('--color-primary').trim().toLowerCase(); })()`);
  check('brand design tokens reach internal pages', pageTokens === '#9d64a3', pageTokens);
  check('new-tab page shows the name as text, no logo image', (await page(`document.querySelectorAll('img, svg image').length === 0 && document.querySelector('.brand').textContent === 'Nevix'`)) === true);
  check('lazy modules are not loaded at startup', !nx.lazyModules.ext && !nx.lazyModules.diag && !nx.lazyModules.io && !nx.lazyModules.spaces, Object.keys(nx.lazyModules));
  shot('01-newtab');
};
