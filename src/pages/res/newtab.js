'use strict';
(async () => {
  const { $, el, fav, num, hostOf, call } = NX;
  const tick = () => {
    const d = new Date();
    $('#clock').textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '  ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  // Re-arm on the minute boundary only while the page is visible (no idle polling).
  let timer;
  const arm = () => { clearTimeout(timer); if (!document.hidden) timer = setTimeout(() => { tick(); arm(); }, 60000 - (Date.now() % 60000)); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); arm(); });
  arm();
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('#q').value.trim();
    if (t) location.href = await call('resolve', t);
  });
  const render = async () => {
    const [sites, st] = await Promise.all([call('topsites'), call('stats:get')]);
    const tiles = $('#tiles');
    tiles.replaceChildren();
    tiles.classList.toggle('empty-hint', !sites.length);
    if (!sites.length) tiles.textContent = 'Your most visited sites will show up here. Nevix keeps this list on your device only.';
    for (const s of sites) tiles.append(el('a', { class: 'tile', href: s.url }, fav(s.url), el('span', { class: 'n' }, s.title || hostOf(s.url))));
    const stat = (n, l) => el('div', { class: 'stat1' }, el('b', {}, num(n)), el('span', {}, l));
    $('#stats').replaceChildren(stat(st.ads, 'ads blocked'), stat(st.trackers, 'trackers blocked'), stat(st.upgrades, 'https upgrades'), stat(st.params, 'links cleaned'));
  };
  call('app:info').then((i) => {
    if (!i.firstRun) return;
    const bar = el('div', { class: 'notice', style: 'text-align:left;margin:0 0 18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
      el('span', { style: 'flex:1' }, 'Coming from another browser? Nevix can import your bookmarks (and history) from this computer — nothing leaves your device.'),
      el('a', { class: 'btn sm primary', href: 'nevix://settings?s=import-browser#General' }, 'Import…'),
      el('button', { class: 'btn sm', onclick: async () => { await call('newtab:dismissImport'); bar.remove(); } }, 'Not now'));
    $('main').prepend(bar);
  }).catch(() => {});
  render();
  window.nevix.onChange(render);
})();
