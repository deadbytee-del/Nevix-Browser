'use strict';
(async () => {
  const { $, el, fav, num, hostOf, call } = NX;
  const tick = () => {
    const d = new Date();
    $('#clock').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const h = d.getHours();
    $('#greet').textContent = h < 5 ? 'Burning the midnight oil?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };
  tick(); setInterval(tick, 20000);
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
    const stat = (n, l) => el('div', { class: 'stat' }, el('b', {}, num(n)), el('span', {}, l));
    $('#stats').replaceChildren(stat(st.ads, 'Ads blocked'), stat(st.trackers, 'Trackers blocked'), stat(st.upgrades, 'HTTPS upgrades'), stat(st.params, 'Links cleaned'));
  };
  render();
  window.nevix.onChange(render);
})();
