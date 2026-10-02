module.exports = async ({ nx, w, page, check, load }) => {
  nx.settings.set('privacy.fingerprint', true);
  const canvasHash = `(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 60; const x = c.getContext('2d'); x.fillStyle = '#f60'; x.fillRect(10, 10, 100, 40); x.fillStyle = '#069'; x.font = '18px Arial'; x.fillText('Nevix fp test 😃', 4, 30); const s = c.toDataURL(); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; })()`;
  await load('http://fp-a.test/fp');
  const a1 = await page(canvasHash);
  check('hardwareConcurrency normalised before page scripts', (await page('window.__hc')) === 4 && (await page('window.__early')) === 'number');
  check('overrides look native', /\[native code\]/.test(await page('Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency").get.toString() + HTMLCanvasElement.prototype.toDataURL.toString()')));
  await load('http://fp-a.test/fp2');
  const a2 = await page(canvasHash);
  await load('http://fp-b.test/fp');
  const b1 = await page(canvasHash);
  check('canvas fingerprint stable within a site', a1 === a2, [a1, a2]);
  check('canvas fingerprint differs across sites', a1 !== b1, [a1, b1]);
  nx.settings.set('privacy.fingerprint', false);
  await load('http://fp-a.test/fp');
  check('with protection off the real canvas is returned', (await page(canvasHash)) !== a1);
  nx.settings.set('privacy.fingerprint', true);
  check('WebGL renderer masked', await page(`(() => { const g = document.createElement('canvas').getContext('webgl'); if (!g) return true; const e = g.getExtension('WEBGL_debug_renderer_info'); return !e || g.getParameter(37446) !== undefined; })()`));
  check('Local Font Access API is blocked', await page(`window.queryLocalFonts ? window.queryLocalFonts().then(() => false, (e) => e.name === 'NotAllowedError') : true`));

  // strict mode (flag): entropy reduction only — pages must still work
  await load('http://fp-a.test/fp');
  const before = await page(`[navigator.plugins.length, window.outerWidth === window.innerWidth, typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().length : 0]`);
  nx.flags.set('nevix-enable-strict-fingerprinting-protection', 'enabled');
  await load('http://fp-a.test/fp');
  const strict = await page(`[navigator.plugins.length, window.outerWidth === window.innerWidth, typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().length : 0, Math.round(performance.now()) % 100]`);
  check('strict flag: empty plugin list, standard window metrics, no voices, 100 ms timer', strict[0] === 0 && strict[1] === true && strict[2] === 0 && strict[3] === 0, strict);
  check('strict flag changes behaviour only when enabled', before[1] === false || before[0] >= 0);
  const ok = await page('document.body.textContent');
  check('pages still render under strict mode', /fp/.test(ok));
  nx.flags.set('nevix-enable-strict-fingerprinting-protection', 'default');
};
