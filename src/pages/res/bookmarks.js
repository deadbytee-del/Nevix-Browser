'use strict';
(() => {
  const { $, el, fav, call, icon } = NX;
  const root = $('#root');
  let q = '';
  async function render() {
    const all = await call('bookmarks:list');
    const items = all.filter((b) => !q || (b.title + b.url).toLowerCase().includes(q.toLowerCase()));
    const search = el('input', { type: 'search', placeholder: 'Search bookmarks', value: q });
    search.addEventListener('input', () => { q = search.value; render(); });
    root.replaceChildren(el('h1', {}, 'Bookmarks'), el('p', { class: 'sub' }, all.length + ' saved · import and export use the standard HTML format every browser understands.'),
      el('div', { class: 'toolbar' }, search,
        el('button', { class: 'btn', onclick: async () => { const n = await call('bookmarks:import'); if (n) render(); } }, 'Import…'),
        el('button', { class: 'btn', onclick: () => call('bookmarks:export') }, 'Export…')));
    if (!items.length) { root.append(el('div', { class: 'empty' }, 'Nothing here yet. Press Ctrl/⌘+D on any page.')); }
    else {
      const list = el('div', { class: 'list' });
      for (const b of items) {
        const title = el('input', { type: 'text', value: b.title, style: 'background:none;border:0;padding:0;font-weight:550;width:100%' });
        title.addEventListener('change', () => call('bookmarks:rename', { id: b.id, title: title.value }));
        list.append(el('div', { class: 'item' }, fav(b.url), el('div', { class: 'main' }, title, el('div', { class: 'u' }, el('a', { href: b.url, style: 'color:inherit' }, b.url))),
          el('button', { class: 'btn sm x', title: 'Remove', onclick: async () => { await call('bookmarks:remove', b.id); render(); } }, icon('x'))));
      }
      root.append(list);
    }
    if (document.activeElement === document.body && q) { const s = $('input[type=search]'); s.focus(); s.setSelectionRange(q.length, q.length); }
  }
  render();
  window.nevix.onChange((t) => { if (t === 'bookmarks') render(); });
})();
