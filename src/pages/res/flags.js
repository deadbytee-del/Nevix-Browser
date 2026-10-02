'use strict';
(() => {
  const { $, el, call, toast, header, confirmDialog } = NX;
  const root = $('#root');
  let data, q = '', cat = 'All';

  async function load() { data = await call('flags:list'); render(); }

  function seg(f) {
    const mk = (state, label) => el('button', { class: 'btn sm' + (f.state === state ? ' primary' : ''), title: state === 'default' ? `Default: ${f.default ? 'enabled' : 'disabled'}` : '', onclick: async () => { await call('flags:set', { id: f.id, state }); toast('Saved'); load(); } }, label);
    return el('div', { class: 'row', style: 'gap:2px' }, mk('default', 'Default'), mk('enabled', 'Enabled'), mk('disabled', 'Disabled'));
  }

  function render() {
    const cats = ['All', ...new Set(data.flags.map((f) => f.category))];
    const list = data.flags.filter((f) => (cat === 'All' || f.category === cat) && (!q || (f.id + ' ' + f.name + ' ' + f.description).toLowerCase().includes(q.toLowerCase())));
    const search = el('input', { type: 'search', placeholder: 'Search flags', value: q, 'aria-label': 'Search flags' });
    search.addEventListener('input', () => { q = search.value; render(); const s = $('input[type=search]'); s.focus(); s.setSelectionRange(q.length, q.length); });
    const changed = data.flags.filter((f) => f.state !== 'default').length;

    root.replaceChildren(
      ...header('nevix://flags', 'Experimental features. Each flag controls real behaviour in the browser; nothing here is cosmetic. Flags marked experimental may be unstable — if Nevix misbehaves, start it with --safe-mode or use Reset all.',
        el('button', { class: 'btn', disabled: changed === 0, onclick: async () => { if (await confirmDialog('Reset all flags?', 'Every flag returns to its default.', { ok: 'Reset all' })) { await call('flags:resetAll'); toast('All flags reset'); load(); } } }, `Reset all${changed ? ` (${changed})` : ''}`)),
      data.safeMode ? el('div', { class: 'notice warn' }, el('b', {}, 'Safe mode is on. '), 'Experimental and changed flags are ignored for this session; the values below are what will apply on a normal start.') : null,
      data.notice && data.notice.crashLoop ? el('div', { class: 'notice danger' }, el('b', {}, 'Nevix crashed repeatedly at startup, '), `so experimental flags were switched off automatically${data.notice.disabledFlags && data.notice.disabledFlags.length ? ' (' + data.notice.disabledFlags.join(', ') + ')' : ''}. You can turn them back on one at a time.`) : null,
      data.restartPending ? el('div', { class: 'notice' }, 'A restart is needed for some changes to take effect. ', el('button', { class: 'btn sm primary', onclick: () => call('flags:restart', {}) }, 'Restart Nevix'), ' ', el('button', { class: 'btn sm', onclick: () => call('flags:restart', { safe: true }) }, 'Restart in safe mode')) : null,
      el('div', { class: 'toolbar' }, search),
      el('div', { class: 'tabsnav' }, cats.map((c) => el('button', { class: c === cat ? 'on' : '', onclick: () => { cat = c; render(); } }, c))),
      list.length ? el('div', { class: 'list' }, list.map((f) => el('div', { class: 'item', style: 'align-items:flex-start;gap:16px' },
        el('div', { class: 'main', style: 'white-space:normal' },
          el('div', { class: 't', style: 'white-space:normal' }, f.name, ' ',
            f.experimental ? el('span', { class: 'badge warn' }, 'experimental') : null, ' ',
            f.restart ? el('span', { class: 'badge' }, 'restart') : null, ' ',
            f.restartPending ? el('span', { class: 'badge primary' }, 'restart pending') : null, ' ',
            f.ignored ? el('span', { class: 'badge danger' }, 'ignored (safe mode)') : null),
          el('div', { class: 'u', style: 'white-space:normal;margin:3px 0' }, f.description),
          el('div', { class: 'u mono' }, f.id, '  ·  default: ', f.default ? 'enabled' : 'disabled', '  ·  now: ', f.effective ? 'on' : 'off')),
        el('div', { class: 'row' }, seg(f),
          el('button', { class: 'btn sm ghost', title: 'Reset this flag', disabled: f.state === 'default', onclick: async () => { await call('flags:reset', { id: f.id }); load(); } }, NX.icon('reset')))))) : el('div', { class: 'empty' }, 'No flags match.'));
  }
  load();
  window.nevix.onChange((t) => { if (t === 'settings') load(); });
})();
