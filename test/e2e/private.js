module.exports = async ({ nx, w, check, load, sleep, waitFor, page }) => {
  const pw = nx.createWindow({ private: true });
  await sleep(600);
  pw.navigate('http://site.test/priv'); await waitFor(() => pw.active.title === 'site.test', 8000);
  const ptab = pw.active;
  await ptab.wc.executeJavaScript('document.cookie="pc=1; path=/"; localStorage.p="1"');
  const hist = nx.history.items.length;
  check('private tab uses a different session', ptab.wc.session !== w.active.wc.session);
  check('private browsing leaves no history', !nx.history.items.some((h) => /\/priv/.test(h.url)));
  const t = await load('http://site.test/');
  check('private cookies not visible to normal session', (await page('document.cookie')).indexOf('pc=1') < 0 && (await page('localStorage.p || "none"')) === 'none');
  pw.win.close(); await sleep(400);
  check('private window closed', ![...nx.windows].includes(pw));
};
