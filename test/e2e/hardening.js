module.exports = async ({ nx, w, check, load, sleep, page }) => {
  const t = await load('http://site.test/');
  const nav = async (u) => { await page(`location.href = ${JSON.stringify(u)}`).catch(() => {}); await sleep(600); return w.active.url; };
  check('web page cannot navigate to nevix://', !/^nevix:\/\/settings/.test(await nav('nevix://settings')));
  await load('http://site.test/');
  check('web page cannot navigate to file://', !/^file:/.test(await nav('file:///etc/passwd')));
  await load('http://site.test/');
  check('web page has no internal nevix bridge for settings', (await page('typeof window.nevix === "object" ? typeof window.nevix.settings : "none"')) !== 'function');
  check('no remote code in chrome UI', await w.ui.webContents.executeJavaScript('[...document.scripts].every(s => !s.src || s.src.startsWith("nevix://"))'));
};
