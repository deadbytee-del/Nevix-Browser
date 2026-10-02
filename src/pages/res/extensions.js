'use strict';
(() => {
  const { $, el, call, toast, header, confirmDialog, ago } = NX;
  const root = $('#root');
  const RISK = { high: ['danger', 'broad access'], medium: ['warn', 'moderate'], low: ['ok', 'limited'] };

  async function load() {
    const list = await call('ext:list');
    root.replaceChildren(
      ...header('nevix://extensions', 'Load unpacked extensions from a folder. Nevix copies each into your profile, shows exactly what it asks for, and lets you restrict the sites its content scripts may run on. Extensions never run in private windows.',
        el('button', { class: 'btn primary', onclick: async () => { const r = await call('ext:install'); if (r.error) toast(r.error, true); else if (r.ok) { toast('Extension installed'); load(); } } }, 'Load unpacked…')),
      el('div', { class: 'notice warn' }, el('b', {}, 'What works: '), 'content scripts, background pages and service workers, and the part of the chrome.* API that the engine implements. ', el('b', {}, 'What doesn’t: '), 'toolbar buttons and pop-ups, the Chrome Web Store, and APIs the engine does not provide. Site restrictions apply to content scripts; an extension with a background script and broad host access can still reach sites through its own requests, so review permissions before installing.'),
      list.length ? list.map(card) : el('div', { class: 'empty' }, 'No extensions installed.'));
  }

  function card(x) {
    const sites = el('input', { type: 'text', value: x.blocked.join(', '), placeholder: 'example.com, bank.example.org', style: 'width:100%' });
    const [riskCls, riskLabel] = RISK[x.risk] || RISK.low;
    return el('div', { class: 'card', style: 'margin-bottom:12px' },
      el('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start' },
        el('div', {}, el('b', { style: 'font-size:15px' }, x.name), el('span', { class: 'dim mono', style: 'margin-left:8px' }, 'v' + x.version + ' · MV' + x.manifestVersion), ' ', el('span', { class: 'badge ' + riskCls }, riskLabel), x.error ? el('span', { class: 'badge danger', style: 'margin-left:6px' }, 'error') : null,
          x.description ? el('div', { class: 'dim', style: 'margin-top:4px' }, x.description) : null),
        el('div', { class: 'row' }, el('span', { class: 'dim' }, x.enabled ? (x.loaded ? 'running' : 'enabled') : 'off'),
          (() => { const sw = el('button', { class: 'switch' + (x.enabled ? ' on' : ''), role: 'switch', 'aria-label': 'Enable ' + x.name }); sw.onclick = async () => { await call('ext:toggle', { id: x.id, enabled: !x.enabled }); load(); }; return sw; })(),
          el('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Remove ${x.name}?`, 'Its files and settings are deleted from your profile. The original folder is untouched.', { danger: true, ok: 'Remove' })) { await call('ext:remove', { id: x.id }); load(); } } }, 'Remove'))),
      x.error ? el('div', { class: 'notice danger' }, x.error) : null,
      el('h4', { style: 'margin:14px 0 6px' }, 'Permissions'),
      x.permissions.length ? el('div', {}, x.permissions.map((p) => el('div', { class: 'row', style: 'padding:2px 0' }, el('span', { class: 'badge ' + (p.risk === 'high' ? 'danger' : p.risk === 'medium' ? 'warn' : '') }, p.risk), el('span', {}, p.text), el('span', { class: 'dim mono' }, p.id)))) : el('div', { class: 'dim' }, 'No special permissions.'),
      el('h4', { style: 'margin:14px 0 6px' }, 'Sites it can run on'),
      x.hosts.length ? el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, x.hosts.slice(0, 14).map((h) => el('span', { class: 'chip mono', style: 'background:var(--color-surface-secondary);padding:2px 8px;border-radius:3px' }, h)), x.hosts.length > 14 ? el('span', { class: 'dim' }, `+${x.hosts.length - 14} more`) : null) : el('div', { class: 'dim' }, 'No site access requested.'),
      x.broadAccess ? el('div', { class: 'notice danger', style: 'margin-top:10px' }, 'This extension can read and change every website you visit.') : null,
      el('h4', { style: 'margin:14px 0 6px' }, 'Never run on these sites'),
      el('div', { class: 'row' }, sites, el('button', { class: 'btn', onclick: async () => { await call('ext:sites', { id: x.id, sites: sites.value.split(/[,\s]+/).filter(Boolean) }); toast('Saved — content scripts skip these sites'); load(); } }, 'Save')),
      el('div', { class: 'dim', style: 'margin-top:8px;font-size:12px' }, `Installed ${ago(x.installedAt)} from ${x.origin}`));
  }
  load();
  window.nevix.onChange((t) => { if (t === 'extensions') load(); });
})();
