'use strict';
(() => {
  const { $, el, fav, call, bytes, dur, ago, toast, header, confirmDialog } = NX;
  const root = $('#root');
  let items = [], q = '', sort = 'time', desc = true, filter = 'all';
  const FILTERS = [['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['failed', 'Failed'], ['danger', 'Flagged']];

  async function load() { items = await call('downloads:list'); render(); }

  function render() {
    let list = items.filter((d) => (!q || (d.name + ' ' + d.url + ' ' + d.domain).toLowerCase().includes(q.toLowerCase())) &&
      (filter === 'all' || (filter === 'active' && ['progressing', 'queued', 'paused'].includes(d.state)) || (filter === 'completed' && d.state === 'completed') ||
       (filter === 'failed' && ['interrupted', 'cancelled', 'blocked'].includes(d.state)) || (filter === 'danger' && d.danger)));
    const key = { time: (d) => d.time, name: (d) => d.name.toLowerCase(), size: (d) => d.total || d.received, domain: (d) => d.domain, state: (d) => d.state }[sort];
    list.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
    const search = el('input', { type: 'search', placeholder: 'Search downloads', value: q });
    search.addEventListener('input', () => { q = search.value; render(); const s = $('input[type=search]'); s.focus(); s.setSelectionRange(q.length, q.length); });
    const sel = el('select', { onchange: (e) => { const [k, d] = e.target.value.split(':'); sort = k; desc = d === 'desc'; render(); } }, [['time:desc', 'Newest first'], ['time:asc', 'Oldest first'], ['name:asc', 'Name A–Z'], ['size:desc', 'Largest first'], ['domain:asc', 'Source'], ['state:asc', 'Status']].map(([v, l]) => el('option', { value: v, selected: v === `${sort}:${desc ? 'desc' : 'asc'}` }, l)));
    const active = items.filter((d) => ['progressing', 'queued', 'paused'].includes(d.state));
    root.replaceChildren(
      ...header('nevix://downloads', 'Files go to your downloads folder. Nevix never uploads or scans them with an outside service. Programs and scripts ask for confirmation before they open.',
        el('button', { class: 'btn', onclick: async () => { await call('downloads:action', { action: 'clear' }); load(); } }, 'Clear completed')),
      active.length ? el('div', { class: 'notice' }, `${active.length} in progress · ${bytes(active.reduce((n, d) => n + (d.speed || 0), 0))}/s total`) : null,
      el('div', { class: 'toolbar' }, search, sel),
      el('div', { class: 'tabsnav' }, FILTERS.map(([id, l]) => el('button', { class: id === filter ? 'on' : '', onclick: () => { filter = id; render(); } }, l))),
      list.length ? el('div', { class: 'list' }, list.map(row)) : el('div', { class: 'empty' }, q || filter !== 'all' ? 'No downloads match.' : 'No downloads yet.'));
  }

  function row(d) {
    const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0;
    const live = d.state === 'progressing';
    const act = (action, label, cls = '') => el('button', { class: 'btn sm ' + cls, onclick: async () => { await call('downloads:action', { id: d.id, action }); load(); } }, label);
    const stateBadge = { completed: ['ok', 'done'], progressing: ['primary', 'downloading'], queued: ['', 'queued'], paused: ['warn', 'paused'], interrupted: ['danger', 'failed'], cancelled: ['', 'cancelled'], blocked: ['danger', 'blocked'] }[d.state] || ['', d.state];
    return el('div', { class: 'item', style: 'align-items:flex-start' }, fav(d.domain),
      el('div', { class: 'main' },
        el('div', { class: 't' }, d.name, ' ', d.danger ? el('span', { class: 'badge ' + (d.danger.level === 'danger' ? 'danger' : 'warn'), title: d.danger.reasons.join('; ') }, d.danger.level === 'danger' ? 'may be unsafe' : 'caution') : null),
        el('div', { class: 'u' }, `${d.domain} · ${d.url}`),
        d.path ? el('div', { class: 'u mono', style: 'font-size:11.5px' }, d.path) : null,
        d.danger ? el('div', { class: 'u warn-text', style: 'white-space:normal' }, d.danger.reasons.join('; ') + '.') : null,
        live || d.state === 'paused' || d.state === 'queued' ? el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })) : null,
        live ? el('div', { class: 'u mono' }, `${bytes(d.received)}${d.total > 0 ? ' / ' + bytes(d.total) : ''} · ${bytes(d.speed || 0)}/s${d.eta ? ' · ' + dur(d.eta) + ' left' : ''}`) : null),
      el('div', { style: 'text-align:right' }, el('span', { class: 'badge ' + stateBadge[0] }, stateBadge[1]), el('div', { class: 'when', style: 'margin-top:4px' }, d.state === 'completed' ? bytes(d.total || d.received) + ' · ' + ago(d.done || d.time) : ago(d.time))),
      el('div', { class: 'row', style: 'flex-wrap:wrap;justify-content:flex-end;max-width:240px' },
        d.state === 'completed' ? [act('open', 'Open'), act('show', 'Show in folder'), act('delete-file', 'Delete file', 'danger')] : null,
        live ? [act('pause', 'Pause'), act('cancel', 'Cancel')] : null,
        d.state === 'paused' || d.state === 'queued' ? [act('resume', d.state === 'queued' ? 'Start now' : 'Resume'), act('cancel', 'Cancel')] : null,
        ['interrupted', 'cancelled', 'blocked'].includes(d.state) ? act('retry', 'Retry') : null,
        act('remove', '✕')));
  }

  load();
  window.nevix.onChange((t) => { if (t === 'downloads') load(); });
})();
