'use strict';
(() => {
  const { $, el, call, icon, toast, confirmDialog, bytes } = NX;
  const root = $('#root');
  const isMac = /Mac/i.test(navigator.platform);
  let D;                 // { categories, schema, values, ... }
  let cat = 'General', q = '', highlight = '';
  const params = new URLSearchParams(location.search);

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const set = async (key, value) => { try { await call('settings:set', { key, value }); D.values[key] = value; toast('Saved'); } catch (e) { toast(String(e.message || e).replace(/^.*Error: /, ''), true); } };
  const reset = async (key) => { await call('settings:reset', { key }); await load(); toast('Reset to default'); };

  function resetBtn(s) {
    const cur = D.values[s.key];
    const changed = s.default !== undefined && !same(cur, s.default);
    return el('button', { class: 'btn sm ghost rs', title: 'Reset to default', style: changed ? '' : 'visibility:hidden', onclick: () => reset(s.key) }, icon('reset'));
  }

  function control(s) {
    const v = D.values[s.key];
    switch (s.type) {
      case 'toggle': { const sw = el('button', { class: 'switch' + (v ? ' on' : ''), role: 'switch', 'aria-checked': String(!!v), 'aria-label': s.title }); sw.onclick = async () => { await set(s.key, !D.values[s.key]); sw.classList.toggle('on', !!D.values[s.key]); sw.setAttribute('aria-checked', String(!!D.values[s.key])); }; return sw; }
      case 'select': { const x = el('select', { 'aria-label': s.title }, s.options.map(([val, label]) => el('option', { value: val, selected: String(v) === String(val) }, label))); x.onchange = () => set(s.key, x.value); return x; }
      case 'number': { const x = el('input', { type: 'number', value: v, min: s.min, max: s.max, 'aria-label': s.title }); x.onchange = () => set(s.key, +x.value); return x; }
      case 'text': { const x = el('input', { type: 'text', value: v || '', placeholder: s.placeholder || '', spellcheck: 'false', 'aria-label': s.title }); x.onchange = () => set(s.key, x.value.trim()); return x; }
      case 'color': { const x = el('input', { type: 'color', value: v || '#9d64a3', 'aria-label': s.title }); x.onchange = () => { set(s.key, x.value); document.documentElement.style.setProperty('--color-primary', x.value); }; return el('div', { class: 'ctl' }, x, v ? el('button', { class: 'btn sm', onclick: async () => { await call('settings:set', { key: s.key, value: '' }); document.documentElement.style.removeProperty('--color-primary'); load(); } }, 'Use Nevix palette') : el('span', { class: 'dim' }, 'Nevix palette')); }
      case 'folder': return el('div', { class: 'ctl' }, el('span', { class: 'dim mono', style: 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, v || 'System Downloads'), el('button', { class: 'btn sm', onclick: async () => { if (await call('download:dir')) load(); } }, 'Change…'));
      case 'link': return el('a', { class: 'btn sm', href: s.href }, s.label || 'Open');
      case 'action': return el('button', { class: 'btn sm' + (s.danger ? ' danger' : ''), onclick: () => runAction(s) }, s.label);
      default: return null;
    }
  }

  async function runAction(s) {
    switch (s.action) {
      case 'default-browser': { const r = await call('action:run', { action: 'default-browser' }); toast(r === 'opened' ? 'Choose Nevix in the Windows settings window' : r === 'set' ? 'Nevix is now the default' : 'Could not change the default — use your system settings', r === 'failed'); break; }
      case 'open-profile': await call('action:run', { action: 'open-profile' }); break;
      case 'reset-settings': if (await confirmDialog('Reset all settings?', 'Every setting returns to its default. Bookmarks, history and flags are not touched.', { danger: true, ok: 'Reset settings' })) { await call('settings:resetAll'); await load(); toast('Settings reset'); } break;
      case 'clear-data': case 'import-browser': inline = inline === s.action ? null : s.action; render(); break;
      default: break;
    }
  }
  let inline = null;

  // ---- inline panels ---------------------------------------------------------------------------------
  function clearPanel() {
    const boxes = { history: true, cookies: true, cache: true, downloads: false };
    const labels = { history: 'Browsing history', cookies: 'Cookies and site data', cache: 'Cached files', downloads: 'Download list' };
    const range = el('select', {}, el('option', { value: 1 }, 'Last hour'), el('option', { value: 24 }, 'Last 24 hours'), el('option', { value: 168 }, 'Last 7 days'), el('option', { value: 0, selected: true }, 'All time'));
    return el('div', { class: 'panelbox' }, el('div', { class: 'checks' }, Object.keys(boxes).map((k) => el('label', {}, el('input', { type: 'checkbox', checked: boxes[k], onchange: (e) => { boxes[k] = e.target.checked; } }), labels[k]))),
      el('div', { class: 'row', style: 'padding:0 16px 8px' }, el('span', { class: 'dim' }, 'Time range'), range,
        el('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Clear this data?', 'This cannot be undone.', { danger: true, ok: 'Clear' })) { await call('data:clear', { ...boxes, range: +range.value }); toast('Cleared'); } } }, 'Clear data')));
  }

  function importPanel() {
    const box = el('div', { class: 'panelbox' }, el('span', { class: 'dim' }, 'Looking for browsers on this computer…'));
    call('import:scan').then((found) => {
      if (!found.length) { box.replaceChildren(el('span', { class: 'dim' }, 'No supported browser profiles were found.')); return; }
      const what = { bookmarks: true, history: false };
      let pick = { browser: found[0].id, profile: found[0].profiles[0].dir };
      const prof = el('select', {});
      const br = el('select', { onchange: () => { const b = found.find((x) => x.id === br.value); pick.browser = b.id; fill(b); } }, found.map((b) => el('option', { value: b.id }, b.name)));
      const fill = (b) => { prof.replaceChildren(...b.profiles.map((p) => el('option', { value: p.dir }, p.label))); pick.profile = b.profiles[0].dir; };
      prof.onchange = () => { pick.profile = prof.value; };
      fill(found[0]);
      box.replaceChildren(el('div', { class: 'row', style: 'margin-bottom:10px' }, br, prof),
        el('div', { class: 'checks' }, el('label', {}, el('input', { type: 'checkbox', checked: true, onchange: (e) => { what.bookmarks = e.target.checked; } }), 'Bookmarks'), el('label', {}, el('input', { type: 'checkbox', onchange: (e) => { what.history = e.target.checked; } }), 'Browsing history')),
        el('div', { class: 'dim', style: 'margin:0 0 10px;font-size:12.5px' }, 'Data is read locally and copied into Nevix. Passwords and cookies are never imported.'),
        el('button', { class: 'btn primary', onclick: async () => { try { const r = await call('import:run', { ...pick, what }); toast(`Imported ${r.bookmarks} bookmarks, ${r.history} history entries`); } catch (e) { toast('Import failed: ' + String(e.message).replace(/^.*Error: /, ''), true); } } }, 'Import'));
    });
    return box;
  }

  // ---- shortcuts ---------------------------------------------------------------------------------------
  function accelFrom(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    let key = e.key.length === 1 ? e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key;
    return (mod ? 'Mod+' : '') + (isMac && e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && !(key.length === 1 && !/[A-Z0-9]/.test(key)) ? 'Shift+' : '') + key;
  }
  async function shortcutsSection() {
    const list = await call('shortcuts:list');
    let filter = '', capturing = null, msg = '';
    const wrap = el('div');
    const draw = () => {
      const f = list.filter((c) => !filter || (c.title + ' ' + c.category + ' ' + c.shortcuts.join(' ')).toLowerCase().includes(filter.toLowerCase()));
      const search = el('input', { type: 'search', placeholder: 'Search commands or shortcuts', value: filter, style: 'width:100%' });
      search.addEventListener('input', () => { filter = search.value; draw(); const s = wrap.querySelector('input'); s.focus(); s.setSelectionRange(filter.length, filter.length); });
      wrap.replaceChildren(el('div', { class: 'panelbox' }, search, msg ? el('div', { class: 'danger-text', style: 'margin-top:8px' }, msg) : null,
        el('div', { style: 'margin-top:8px' }, el('button', { class: 'btn sm', onclick: async () => { if (await confirmDialog('Reset all shortcuts?', 'Every shortcut returns to its default.', { ok: 'Reset' })) { await call('shortcuts:resetAll'); location.reload(); } } }, 'Reset all shortcuts'))),
        ...f.map((c) => el('div', { class: 'keyrow' + (capturing === c.id ? ' capture' : '') },
          el('span', { class: 'name' }, c.title, c.custom ? el('span', { class: 'badge primary', style: 'margin-left:8px' }, 'custom') : null), el('span', { class: 'cat' }, c.category),
          el('span', {}, capturing === c.id ? el('span', { class: 'dim' }, 'Press the new shortcut… (Esc to cancel)') : (c.shortcuts.length ? c.shortcuts.map((s) => el('kbd', { class: 'accel' }, s)) : el('span', { class: 'dim' }, 'none'))),
          el('button', { class: 'btn sm', onclick: () => { capturing = capturing === c.id ? null : c.id; msg = ''; draw(); } }, capturing === c.id ? 'Cancel' : 'Change'),
          el('button', { class: 'btn sm ghost', title: 'Reset to default', style: c.custom ? '' : 'visibility:hidden', onclick: async () => { await call('shortcuts:reset', { id: c.id }); location.reload(); } }, icon('reset')))));
    };
    window.onkeydown = async (e) => {
      if (!capturing) return;
      e.preventDefault();
      if (e.key === 'Escape') { capturing = null; draw(); return; }
      const a = accelFrom(e);
      if (!a) return;
      const r = await call('shortcuts:set', { id: capturing, accels: [a] });
      if (r.error) { msg = r.error; draw(); return; }
      location.reload();
    };
    draw();
    return wrap;
  }

  // ---- backup ------------------------------------------------------------------------------------------
  function backupSection() {
    const pass = el('input', { type: 'password', placeholder: 'Passphrase (8+ characters)', style: 'width:260px', autocomplete: 'off' });
    const inc = { settings: true, bookmarks: true, workspaces: true, permissions: true, rules: true, history: false };
    const labels = { settings: 'Settings & shortcuts', bookmarks: 'Bookmarks', workspaces: 'Workspaces & snapshots', permissions: 'Site permissions', rules: 'Your filter rules', history: 'Browsing history' };
    const out = el('div', { class: 'dim', style: 'margin-top:10px' });
    return el('div', { class: 'panelbox' }, el('div', { class: 'checks' }, Object.keys(inc).map((k) => el('label', {}, el('input', { type: 'checkbox', checked: inc[k], onchange: (e) => { inc[k] = e.target.checked; } }), labels[k]))),
      el('div', { class: 'row', style: 'padding:0 16px' }, pass,
        el('button', { class: 'btn primary', onclick: async () => { try { const r = await call('backup:export', { passphrase: pass.value, include: inc }); out.textContent = r.canceled ? '' : 'Saved to ' + r.file; } catch (e) { out.textContent = String(e.message).replace(/^.*Error: /, ''); out.className = 'danger-text'; } } }, 'Export encrypted backup…'),
        el('button', { class: 'btn', onclick: async () => { try { const r = await call('backup:import', { passphrase: pass.value }); out.className = 'dim'; out.textContent = r.canceled ? '' : 'Imported: ' + Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(', '); } catch (e) { out.className = 'danger-text'; out.textContent = String(e.message).replace(/^.*Error: /, ''); } } }, 'Import backup…')),
      el('div', { style: 'padding:0 16px' }, out));
  }

  // ---- rendering ---------------------------------------------------------------------------------------
  async function renderEntry(s) {
    const row = el('div', { class: 'setting' + (highlight && (s.key === highlight || s.action === highlight || s.title === highlight) ? ' hl' : ''), 'data-key': s.key || s.action || '' });
    if (s.type === 'shortcuts') return el('div', {}, el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, s.title), el('div', { class: 'd' }, s.description))), await shortcutsSection());
    if (s.type === 'backup') return el('div', {}, el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, s.title), el('div', { class: 'd' }, s.description))), backupSection());
    const disabledByFlag = s.flag && !s.flagOn;
    row.append(el('div', { class: 'txt' }, el('div', { class: 'l' }, s.title, s.restart ? el('span', { class: 'badge' }, 'restart') : null, disabledByFlag ? el('span', { class: 'badge warn' }, 'turned off by a flag') : null),
      el('div', { class: 'd' }, s.description)),
      el('div', { class: 'ctl' }, s.type === 'info' ? null : control(s), s.key ? resetBtn(s) : null));
    if (disabledByFlag) row.style.opacity = '.6';
    if (s.action && inline === s.action) {
      const panel = s.action === 'clear-data' ? clearPanel() : importPanel();
      return el('div', {}, row, panel);
    }
    return row;
  }

  async function render() {
    const entries = D.schema.filter((s) => (q ? (s.title + ' ' + (s.description || '') + ' ' + s.category).toLowerCase().includes(q.toLowerCase()) : s.category === cat));
    const search = el('input', { type: 'search', placeholder: 'Search all settings', value: q, 'aria-label': 'Search settings' });
    search.addEventListener('input', () => { q = search.value; render().then(() => { const s = $('input[type=search]'); s.focus(); s.setSelectionRange(q.length, q.length); }); });
    const nav = el('nav', { class: 'cats' }, el('h2', {}, 'Settings'), D.categories.map((c) => el('a', { class: !q && c === cat ? 'on' : '', onclick: () => { q = ''; cat = c; history.replaceState(null, '', '#' + c); render(); } }, c)));
    const rows = [];
    let lastCat = '';
    for (const s of entries) {
      if (q && s.category !== lastCat) { rows.push(el('div', { class: 'catlabel' }, s.category)); lastCat = s.category; }
      rows.push(await renderEntry(s));
    }
    // group consecutive entries into cards
    const groups = [];
    let cur = null;
    for (const r of rows) { if (r.classList && r.classList.contains('catlabel')) { groups.push(r); cur = null; continue; } if (!cur) { cur = el('div', { class: 'group', style: 'margin-bottom:14px' }); groups.push(cur); } cur.append(r); }
    const main = el('main', {}, el('div', { class: 'searchbar' }, search), el('h1', { style: 'font:600 20px var(--font-mono);margin-bottom:14px' }, q ? `Results for “${q}”` : cat), ...(groups.length ? groups : [el('div', { class: 'empty' }, 'No settings match.')]));
    root.replaceChildren(nav, main);
    if (highlight) { const h = main.querySelector('.hl'); if (h) h.scrollIntoView({ block: 'center' }); highlight = ''; }
  }

  async function load() {
    D = await call('settings:schema');
    const hash = decodeURIComponent((location.hash || '').slice(1));
    if (D.categories.includes(hash)) cat = hash; else if (hash === 'privacy') cat = 'Privacy'; else if (hash === 'data') { cat = 'Privacy'; inline = 'clear-data'; }
    highlight = params.get('s') || '';
    await render();
  }
  window.addEventListener('hashchange', load);
  load();
  window.nevix.onChange((t) => { if (t === 'settings' && !document.activeElement.matches('input, select')) load(); });
})();
