'use strict';
(() => {
  const { $, el, fav, call, bytes } = NX;
  const root = $('#root');
  async function render() {
    const items = await call('downloads:list');
    root.replaceChildren(el('h1', {}, 'Downloads'), el('p', { class: 'sub' }, 'Files are saved to your downloads folder. Nevix never uploads or scans them.'),
      el('div', { class: 'toolbar' }, el('span', { class: 'dim', style: 'flex:1' }, items.length + ' items'), el('button', { class: 'btn', onclick: async () => { await call('downloads:action', { action: 'clear' }); render(); } }, 'Clear finished')));
    if (!items.length) { root.append(el('div', { class: 'empty' }, 'No downloads yet.')); return; }
    const list = el('div', { class: 'list' });
    for (const d of items) {
      const pct = d.total > 0 ? Math.min(100, d.received / d.total * 100) : 0;
      const act = (action, label, cls = '') => el('button', { class: 'btn sm ' + cls, onclick: async () => { await call('downloads:action', { id: d.id, action }); render(); } }, label);
      list.append(el('div', { class: 'item' }, fav(d.url || d.name),
        el('div', { class: 'main' }, el('div', { class: 't' }, d.name), el('div', { class: 'u' }, d.url),
          d.state === 'progressing' || d.state === 'paused' ? el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })) : null),
        el('span', { class: 'when' }, d.state === 'completed' ? bytes(d.total || d.received) : d.state === 'progressing' ? Math.round(pct) + '%' : d.state),
        d.state === 'completed' ? [act('open', 'Open'), act('show', 'Show')] : d.state === 'progressing' ? [act('pause', 'Pause'), act('cancel', 'Cancel')] : d.state === 'paused' ? [act('resume', 'Resume'), act('cancel', 'Cancel')] : null,
        act('remove', '✕')));
    }
    root.append(list);
  }
  render();
  window.nevix.onChange((t) => { if (t === 'downloads') render(); });
})();
