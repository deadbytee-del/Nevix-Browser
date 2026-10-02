'use strict';
(() => {
  const { $, el, call, ago, toast, header, askText, confirmDialog, hostOf } = NX;
  const root = $('#root');
  const GC = { primary: 'var(--color-primary)', warning: 'var(--color-warning)', success: 'var(--color-success)', danger: 'var(--color-danger-hover)', neutral: 'var(--color-text-secondary)' };

  async function load() {
    const [ws, groups] = await Promise.all([call('ws:list'), call('group:list')]);
    root.replaceChildren(
      ...header('nevix://workspaces', 'A workspace is a named set of tabs, groups and pins you can bring back whenever you like — for a project, a trip, a research session. They are stored only on this device.',
        el('button', { class: 'btn primary', onclick: async () => { const name = await askText('Save current window as a workspace', 'Workspace name', ''); if (name) { const id = await call('ws:save', { name }); toast(id ? 'Workspace saved' : 'Nothing to save', !id); load(); } } }, 'Save current window…')),
      ws.length ? ws.map((w) => el('div', { class: 'card', style: 'margin-bottom:10px' },
        el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, el('div', {}, el('b', {}, w.name), el('span', { class: 'dim', style: 'margin-left:10px' }, `${w.tabs.length} tabs · saved ${ago(w.time)}`)),
          el('div', { class: 'row' },
            el('button', { class: 'btn sm primary', onclick: async () => { await call('ws:restore', { id: w.id, mode: 'append' }); toast('Workspace opened'); } }, 'Open in this window'),
            el('button', { class: 'btn sm', onclick: () => call('ws:restore', { id: w.id, mode: 'window' }) }, 'Open in new window'),
            el('button', { class: 'btn sm', onclick: async () => { const n = await askText('Rename workspace', 'Name', w.name); if (n) { await call('ws:rename', { id: w.id, name: n }); load(); } } }, 'Rename'),
            el('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Delete “${w.name}”?`, 'The saved tabs are removed. Open tabs are not affected.', { danger: true, ok: 'Delete' })) { await call('ws:delete', { id: w.id }); load(); } } }, 'Delete'))),
        w.groups.length ? el('div', { class: 'row', style: 'margin-bottom:6px;flex-wrap:wrap' }, w.groups.map((g) => el('span', { class: 'badge', style: `background:${GC[g.color] || GC.primary};color:var(--color-on-primary)` }, g.name || 'Group'))) : null,
        el('div', { class: 'dim', style: 'font-size:12.5px' }, w.tabs.slice(0, 6).map((t) => (t.pinned ? '📌 ' : '') + (t.title || hostOf(t.url))).join('  ·  '), w.tabs.length > 6 ? `  · +${w.tabs.length - 6} more` : ''))) :
        el('div', { class: 'empty' }, 'No workspaces yet. Open some tabs, then choose “Save current window…” (or run “Save workspace” from the command palette).'),
      el('h3', { style: 'margin:28px 0 8px' }, 'Saved tab groups'),
      groups.length ? el('div', { class: 'list' }, groups.map((g) => el('div', { class: 'item' }, el('span', { class: 'badge', style: `background:${GC[g.color] || GC.primary};color:var(--color-on-primary)` }, g.name),
        el('div', { class: 'main u' }, g.tabs.slice(0, 4).map((t) => t.title || hostOf(t.url)).join(' · '), g.tabs.length > 4 ? ` · +${g.tabs.length - 4}` : ''), el('span', { class: 'when' }, `${g.tabs.length} tabs`),
        el('button', { class: 'btn sm primary', onclick: async () => { await call('group:open', { id: g.id }); toast('Group opened'); } }, 'Open'),
        el('button', { class: 'btn sm', onclick: async () => { await call('group:delete', { id: g.id }); load(); } }, 'Delete')))) : el('div', { class: 'empty', style: 'padding:24px' }, 'Right-click a tab group chip and choose “Save group…” to keep it here.'));
  }
  load();
  window.nevix.onChange((t) => { if (t === 'workspaces') load(); });
})();
