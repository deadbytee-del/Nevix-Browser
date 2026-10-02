'use strict';
(() => {
  const { $, el, call, toast, header, confirmDialog } = NX;
  const root = $('#root');
  let data, q = '';
  const STATES = [['allow', 'Allow'], ['ask', 'Ask'], ['block', 'Block']];

  async function load() { data = await call('perm:list'); render(); }

  function stateSelect(value, onChange, withDefault) {
    const s = el('select', { class: 'sel' }, withDefault ? el('option', { value: 'default' }, 'Default') : null, STATES.map(([v, l]) => el('option', { value: v, selected: value === v }, l)));
    s.onchange = () => onChange(s.value);
    return s;
  }

  function render() {
    const search = el('input', { type: 'search', placeholder: 'Filter sites', value: q });
    search.addEventListener('input', () => { q = search.value; render(); const s = $('input[type=search]'); s.focus(); s.setSelectionRange(q.length, q.length); });
    const sites = data.sites.filter((s) => !q || s.origin.includes(q.toLowerCase()));
    const origin = el('input', { type: 'text', placeholder: 'https://example.com', style: 'width:230px' });
    const perm = el('select', {}, data.catalog.map((c) => el('option', { value: c.id }, c.label)));
    const st = el('select', {}, STATES.map(([v, l]) => el('option', { value: v }, l)));
    root.replaceChildren(
      ...header('nevix://permissions', 'Permissions are tied to an origin — scheme, host and port — so https://a.com, http://a.com and https://a.com:8443 are different sites. Camera and microphone, location, notifications, clipboard, pop-ups, downloads, autoplay, Bluetooth, USB, motion sensors and MIDI are all managed here.'),
      el('h3', { style: 'margin:6px 0 8px' }, 'Defaults for all sites'),
      el('div', { class: 'list' }, data.catalog.map((c) => el('div', { class: 'item' }, el('div', { class: 'main' }, el('div', { class: 't' }, c.label), el('div', { class: 'u' }, `Sites ${c.verb}`)),
        stateSelect(c.current, async (v) => { await call('perm:setDefault', { perm: c.id, state: v }); toast('Saved'); load(); }, false)))),
      el('h3', { style: 'margin:26px 0 8px' }, 'Site exceptions'),
      el('div', { class: 'toolbar' }, search, origin, perm, st, el('button', { class: 'btn', onclick: async () => { try { const o = new URL(origin.value.trim()).origin; await call('perm:set', { origin: o, perm: perm.value, state: st.value }); load(); } catch { toast('Enter a full origin like https://example.com', true); } } }, 'Add')),
      sites.length ? sites.map((s) => el('div', { class: 'card', style: 'margin-bottom:10px' },
        el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' }, el('b', { class: 'mono' }, s.origin),
          el('div', { class: 'row' }, el('button', { class: 'btn sm', onclick: async () => { await call('perm:reset', { origin: s.origin }); load(); } }, 'Reset permissions'),
            el('button', { class: 'btn sm danger', title: 'Permissions, cookies, storage and cache', onclick: async () => { if (await confirmDialog(`Forget ${s.origin}?`, 'Removes its permissions, cookies, storage and cached files.', { danger: true, ok: 'Forget site' })) { await call('perm:resetSite', { origin: s.origin }); toast('Site forgotten'); load(); } } }, 'Reset all site data…'))),
        el('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px 18px' }, Object.entries(s.perms).map(([id, v]) => { const c = data.catalog.find((x) => x.id === id); return el('div', { class: 'row' }, el('span', { class: 'dim' }, c ? c.label : id), stateSelect(v, async (nv) => { await call('perm:set', { origin: s.origin, perm: id, state: nv }); load(); }, true)); })))) :
        el('div', { class: 'empty' }, 'No saved exceptions. When a site asks for something, you can allow or block it from the prompt and it will appear here.'));
  }
  load();
  window.nevix.onChange((t) => { if (t === 'permissions') load(); });
})();
