'use strict';
(() => {
  const { $, el, call, ago, toast, header, askText, confirmDialog } = NX;
  const root = $('#root');
  async function load() {
    const list = await call('snap:list');
    root.replaceChildren(
      ...header('nevix://snapshots', 'A snapshot records every open window — tabs, groups, pins and back/forward history — so you can return to exactly this moment. Private windows are never included.',
        el('button', { class: 'btn primary', onclick: async () => { const name = await askText('Save snapshot', 'Snapshot name', 'Snapshot ' + new Date().toLocaleString()); if (name) { const id = await call('snap:save', { name }); toast(id ? 'Snapshot saved' : 'Nothing to save', !id); load(); } } }, 'Save snapshot…')),
      list.length ? list.map((s) => el('div', { class: 'card', style: 'margin-bottom:10px' },
        el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, el('div', {}, el('b', {}, s.name), el('span', { class: 'dim', style: 'margin-left:10px' }, `${s.windows} window${s.windows > 1 ? 's' : ''} · ${s.tabs} tabs · ${ago(s.time)}`)),
          el('div', { class: 'row' },
            el('button', { class: 'btn sm primary', onclick: async () => { await call('snap:restore', { id: s.id }); toast('Snapshot restored in new windows'); } }, 'Restore'),
            el('button', { class: 'btn sm', onclick: async () => { const n = await askText('Rename snapshot', 'Name', s.name); if (n) { await call('snap:rename', { id: s.id, name: n }); load(); } } }, 'Rename'),
            el('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Delete “${s.name}”?`, 'This snapshot is removed permanently.', { danger: true, ok: 'Delete' })) { await call('snap:delete', { id: s.id }); load(); } } }, 'Delete'))),
        el('div', { class: 'dim', style: 'font-size:12.5px' }, s.preview.join('  ·  ')))) : el('div', { class: 'empty' }, 'No snapshots yet.'),
      el('p', { class: 'dim', style: 'margin-top:14px;font-size:12.5px' }, 'Restoring opens the snapshot’s windows alongside your current ones — nothing is closed. Pages are reloaded from the network; Nevix does not keep copies of page content.'));
  }
  load();
  window.nevix.onChange((t) => { if (t === 'snapshots') load(); });
})();
