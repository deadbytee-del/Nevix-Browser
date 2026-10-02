'use strict';
(() => {
  const { $, el, fav, hostOf, call, icon } = NX;
  const root = $('#root');
  let q = '';
  const dayLabel = (t) => {
    const d = new Date(t); const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  };
  async function render() {
    const items = await call('history:list', { q });
    const search = el('input', { type: 'search', placeholder: 'Search history', value: q, autofocus: true });
    search.addEventListener('input', () => { q = search.value; clearTimeout(render.t); render.t = setTimeout(render, 150); });
    const clear = el('select', {}, el('option', { value: '' }, 'Clear…'), el('option', { value: '1' }, 'Last hour'), el('option', { value: '24' }, 'Last 24 hours'), el('option', { value: '168' }, 'Last 7 days'), el('option', { value: 'all' }, 'All time'));
    clear.addEventListener('change', async () => { if (!clear.value) return; await call('history:clear', clear.value === 'all' ? 0 : +clear.value); render(); });
    const wasFocused = document.activeElement && document.activeElement.type === 'search';
    root.replaceChildren(el('h1', {}, 'History'), el('p', { class: 'sub' }, 'Stored only on this device. Private windows and isolated tabs never appear here.'),
      el('div', { class: 'toolbar' }, search, clear));
    if (!items.length) { root.append(el('div', { class: 'empty' }, q ? 'No matches.' : 'No browsing history.')); }
    let day = '', list;
    for (const it of items) {
      const l = dayLabel(it.last);
      if (l !== day) { day = l; root.append(el('div', { class: 'day' }, l)); list = el('div', { class: 'list' }); root.append(list); }
      list.append(el('div', { class: 'item' }, fav(it.url),
        el('div', { class: 'main' }, el('div', { class: 't' }, el('a', { href: it.url, style: 'color:inherit' }, it.title || it.url)), el('div', { class: 'u' }, it.url)),
        el('span', { class: 'when' }, new Date(it.last).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })),
        el('button', { class: 'btn sm x', title: 'Remove', onclick: async () => { await call('history:remove', it.url); render(); } }, icon('x'))));
    }
    if (wasFocused) { const s = $('input[type=search]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  render();
  window.nevix.onChange((t) => { if (t === 'history') render(); });
})();
