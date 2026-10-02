'use strict';
(() => {
  const { $, el, call, toast, header } = NX;
  const root = $('#root');
  call('app:info').then((i) => {
    const kv = (k, v) => el('div', { class: 'row', style: 'justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--color-border)' }, el('span', { class: 'dim' }, k), el('span', { class: 'mono', style: 'text-align:right;word-break:break-all' }, v));
    root.replaceChildren(
      el('h1', { style: 'font:600 44px var(--font-mono);letter-spacing:-.04em;margin-bottom:2px' }, el('span', { style: 'color:var(--color-primary)' }, 'N'), 'evix'),
      el('p', { class: 'sub' }, 'A fast, private browser with nothing hidden.'),
      i.portable ? el('div', { class: 'notice' }, el('b', {}, 'Portable mode. '), 'Your profile is stored next to the program in ' + i.userData + ' — carry the folder to take your data with you.') : null,
      i.safeMode ? el('div', { class: 'notice warn' }, el('b', {}, 'Safe mode. '), 'Experimental flags are ignored in this session.') : null,
      el('div', { class: 'card', style: 'margin-bottom:18px' }, kv('Version', i.version), kv('Engine', 'Chromium ' + i.chrome), kv('Runtime', 'Electron ' + i.electron + ' · Node ' + i.node + ' · V8 ' + i.v8), kv('Platform', i.platform), kv('Profile folder', i.userData),
        kv('Hardware acceleration', i.hardwareAcceleration ? 'on' : 'off'), kv('Crash reports', i.crashReports ? 'saved locally, never uploaded' : 'off'), kv('Default browser', i.isDefault ? 'yes' : 'no')),
      el('h3', { style: 'margin:22px 0 8px' }, 'What Nevix does not do'),
      el('ul', { style: 'padding-left:20px;color:var(--color-text-secondary);line-height:1.8' },
        ['No accounts, no sync servers, no telemetry, no usage statistics.', 'No ads, no sponsored tiles, no sponsored search.', 'No URLs, history or page content leave your device — the only network traffic is the pages you load, and optional filter-list downloads you turn on.', 'Crash reporting is off by default; if you turn it on, reports stay on your computer.', 'No claim of anonymity: websites you visit and your network can still see your IP address. Use a VPN or Tor (Settings → Network → Proxy) if that matters to you.'].map((t) => el('li', {}, t))),
      el('h3', { style: 'margin:22px 0 8px' }, 'Internal pages'),
      el('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, ['settings', 'privacy', 'performance', 'downloads', 'extensions', 'workspaces', 'snapshots', 'permissions', 'network', 'diagnostics', 'flags'].map((p) => el('a', { class: 'btn sm', href: 'nevix://' + p }, 'nevix://' + p))),
      el('p', { class: 'dim', style: 'margin-top:26px;font-size:12px' }, 'MIT licensed. Built on Chromium and Electron; blocklist data from Peter Lowe’s ad-server list. Chromium’s own licences are listed in the installation folder.'));
  });
})();
