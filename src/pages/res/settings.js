'use strict';
(() => {
  const { $, el, call, icon, num, bytes } = NX;
  const root = $('#root');
  let cfg;
  const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1600); };
  const get = (path) => path.split('.').reduce((o, k) => o && o[k], cfg);
  const set = async (path, value) => { await call('settings:set', { path, value }); toast('Saved'); };

  const toggle = (path, label, desc) => {
    const sw = el('div', { class: 'switch' + (get(path) ? ' on' : ''), role: 'switch' });
    sw.onclick = async () => { const v = !get(path); await set(path, v); sw.classList.toggle('on', v); };
    return el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, label), desc ? el('div', { class: 'd' }, desc) : null), sw);
  };
  const select = (path, label, desc, opts) => {
    const s = el('select', {}, ...opts.map(([v, t]) => el('option', { value: v, selected: String(get(path)) === String(v) }, t)));
    s.onchange = () => set(path, s.value);
    return el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, label), desc ? el('div', { class: 'd' }, desc) : null), s);
  };
  const text = (path, label, desc, ph = '') => {
    const i = el('input', { type: 'text', value: get(path) || '', placeholder: ph, spellcheck: 'false' });
    i.onchange = () => set(path, i.value.trim());
    return el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, label), desc ? el('div', { class: 'd' }, desc) : null), i);
  };
  const number = (path, label, desc) => {
    const i = el('input', { type: 'number', value: get(path), min: 0, max: 1440 });
    i.onchange = () => set(path, Math.max(0, parseInt(i.value, 10) || 0));
    return el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, label), desc ? el('div', { class: 'd' }, desc) : null), i);
  };
  const row = (label, desc, control) => el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, label), desc ? el('div', { class: 'd' }, desc) : null), control);
  const group = (title, ...items) => el('div', { class: 'group' }, title ? el('h3', {}, title) : null, ...items);
  const sect = (id, title, sub, ...kids) => el('section', { id }, el('h1', {}, title), el('p', { class: 'sub' }, sub), ...kids);

  async function build() {
    cfg = await call('settings:get');
    const [info, stats] = await Promise.all([call('app:info'), call('stats:get')]);
    const g = cfg.general;

    const hero = el('div', { class: 'hero' }, el('div', {}, el('div', { class: 'big' }, num(stats.ads + stats.trackers)), el('div', { class: 'dim' }, 'ads & trackers blocked since ' + new Date(stats.since).toLocaleDateString())),
      el('div', { class: 'cells' }, [['upgrades', 'HTTPS upgrades'], ['params', 'Links cleaned']].map(([k, l]) => el('div', { class: 'cell' }, el('b', {}, num(stats[k])), el('span', {}, l))),
        el('div', { class: 'cell' }, el('b', {}, num(cfg.listCount)), el('span', {}, 'Block rules active'))));

    const sections = [
      sect('privacy', 'Privacy & shields', 'Everything here is on by default. Shields are applied before a page can see you.', hero,
        group('Blocking',
          toggle('privacy.adblock', 'Block ads', 'Stops ad networks from loading.'),
          toggle('privacy.trackers', 'Block trackers', 'Analytics, pixels, session-replay and fingerprinting scripts.'),
          toggle('privacy.cosmetic', 'Hide cookie banners & ad slots', 'Cleans up leftover empty ad boxes and consent pop-ups.'),
          toggle('privacy.thirdPartyCookies', 'Block third-party cookies', 'Cross-site cookies are never sent or stored.'),
          toggle('privacy.stripTrackingParams', 'Remove tracking parameters from links', 'utm_*, fbclid, gclid, msclkid and ~50 others.')),
        group('Connection',
          toggle('privacy.httpsOnly', 'HTTPS-only mode', 'Upgrades every http:// request. If a site has no HTTPS you get a warning before continuing.'),
          select('privacy.doh', 'Secure DNS', 'Encrypts the website lookups your ISP would otherwise see.', [['off', 'Off (system DNS)'], ['automatic', 'Automatic (fall back to system)'], ['secure', 'Always (strict)']]),
          text('privacy.dohServer', 'DNS-over-HTTPS server', 'Used when Secure DNS is on.', 'https://cloudflare-dns.com/dns-query'),
          text('privacy.proxy', 'Proxy', 'Route all traffic through a proxy, e.g. socks5://127.0.0.1:9050 for Tor. Leave blank for system settings.', 'socks5://127.0.0.1:9050')),
        group('Fingerprinting & identity',
          toggle('privacy.fingerprint', 'Fingerprint protection', 'Adds per-site noise to canvas, WebGL and audio; hides precise hardware, battery and screen details.'),
          toggle('privacy.gpc', 'Send Global Privacy Control', 'Tells sites not to sell or share your data.'),
          toggle('privacy.spoofLanguage', 'Report generic language (en-US)', 'Makes you look like everyone else. May show sites in English.'),
          select('privacy.referrer', 'Referrer for cross-site requests', 'What the next site learns about where you came from.', [['origin', 'Only the site name'], ['none', 'Nothing'], ['full', 'Full address (browser default)']]),
          select('privacy.webrtc', 'WebRTC IP handling', 'Prevents video-call APIs from leaking your local network address.', [['public-only', 'Hide local IP (recommended)'], ['strict', 'Strict — only via proxy (may break calls)'], ['default', 'Default']]),
          toggle('privacy.blockAutoplay', 'Block autoplaying media', 'Requires a click before audio or video plays. Applies to new tabs.')),
        group('On exit, clear…',
          toggle('privacy.clearOnExit.history', 'Browsing history'), toggle('privacy.clearOnExit.cookies', 'Cookies & site data'),
          toggle('privacy.clearOnExit.cache', 'Cached files'), toggle('privacy.clearOnExit.downloads', 'Download list'))),

      sect('general', 'General', 'Startup, tabs and everyday behaviour.',
        group('Startup',
          select('general.startup', 'When Nevix starts', '', [['newtab', 'Open a new tab'], ['restore', 'Continue where I left off'], ['homepage', 'Open my homepage']]),
          text('general.homepage', 'Homepage', '', 'nevix://newtab')),
        group('Tabs & memory',
          number('general.tabSleepMinutes', 'Sleep inactive tabs after (minutes)', 'Frees memory by unloading background tabs. 0 turns it off.'),
          toggle('general.verticalTabs', 'Vertical tabs', 'Move tabs to a sidebar. Toggle anytime with ' + MOD + 'Shift+E.'),
          toggle('general.bookmarksBar', 'Show bookmarks bar')),
        group('History',
          toggle('general.saveHistory', 'Save browsing history', 'Kept locally; powers address-bar suggestions and the new-tab page.'),
          toggle('general.spellcheck', 'Spell check', 'Off by default on Windows/Linux because dictionaries are normally fetched from a third party.')),
        group('Default browser', row('Make Nevix your default browser', info.isDefault ? 'Nevix is already the default.' : '', el('button', { class: 'btn primary', onclick: async () => { const ok = await call('default:set'); toast(ok ? 'Nevix is now the default' : 'Couldn’t set default — use your system settings'); } }, 'Set as default')))),

      sect('appearance', 'Appearance', 'Make it yours.',
        group('', select('general.theme', 'Theme', '', [['system', 'Match system'], ['dark', 'Dark'], ['light', 'Light']]),
          row('Accent colour', '', (() => { const c = el('input', { type: 'color', value: g.accent }); c.onchange = () => { set('general.accent', c.value); document.documentElement.style.setProperty('--accent', c.value); }; return c; })()))),

      sect('search', 'Search', 'Nevix sends nothing to a search engine until you press Enter. Suggestions are computed locally.',
        group('', select('general.searchEngine', 'Search engine', '', Object.entries(cfg.engines).map(([k, v]) => [k, v.name])),
          text('general.customSearchUrl', 'Custom search URL', 'Use %s where the query goes — e.g. your own SearXNG instance.', 'https://searx.example/search?q=%s')),
        group('Shortcuts you can type in the address bar', el('div', { class: 'chips' }, ['w', 'yt', 'gh', 'mdn', 'npm', 'so', 'maps', 'imdb', 'r', ...Object.values(cfg.engines).filter((e) => e.url).map((e) => e.keyword)].map((k) => el('span', { class: 'chip' }, el('kbd', {}, k), '+ space + query'))))),

      sect('data', 'Clear browsing data', 'Wipe what Nevix has stored on this device.', (() => {
        const boxes = { history: true, cookies: true, cache: true, downloads: false };
        const labels = { history: 'Browsing history', cookies: 'Cookies & site data', cache: 'Cached images & files', downloads: 'Download list' };
        const range = el('select', {}, el('option', { value: 1 }, 'Last hour'), el('option', { value: 24 }, 'Last 24 hours'), el('option', { value: 168 }, 'Last 7 days'), el('option', { value: 0, selected: true }, 'All time'));
        return group('', el('div', { class: 'checks' }, Object.keys(boxes).map((k) => el('label', {}, el('input', { type: 'checkbox', checked: boxes[k], onchange: (e) => { boxes[k] = e.target.checked; } }), labels[k]))),
          row('Time range', '', range),
          row('', '', el('button', { class: 'btn danger', onclick: async () => { await call('data:clear', { ...boxes, range: +range.value }); toast('Cleared'); } }, 'Clear data')));
      })()),

      sect('lists', 'Filter lists', 'Nevix ships with a compact built-in list. Add bigger community lists if you want maximum coverage — they are only downloaded when you enable them.',
        group('', row('Built-in rules', 'Peter Lowe’s ad-server list + Nevix core rules. Always on while blocking is enabled.', el('span', { class: 'dim' }, num(cfg.listCount) + ' active')),
          ...cfg.filterLists.map((def) => {
            const st = cfg.privacy.lists.find((l) => l.id === def.id) || { enabled: false, updated: 0 };
            const sw = el('div', { class: 'switch' + (st.enabled ? ' on' : '') });
            sw.onclick = async () => {
              const lists = cfg.privacy.lists.map((l) => (l.id === def.id ? { ...l, enabled: !l.enabled } : l));
              await set('privacy.lists', lists); cfg.privacy.lists = lists; sw.classList.toggle('on');
              if (lists.find((l) => l.id === def.id).enabled) { toast('Downloading…'); const r = await call('lists:update'); toast(r.every((x) => x.ok) ? 'Lists updated' : 'Some lists failed'); build(); }
              else build();
            };
            return row(def.name, st.updated ? 'Updated ' + new Date(st.updated).toLocaleDateString() : def.url.replace(/^https:\/\//, ''), sw);
          }),
          row('', '', el('button', { class: 'btn', onclick: async () => { toast('Updating…'); const r = await call('lists:update'); toast(r.length ? (r.every((x) => x.ok) ? 'Lists updated' : 'Some lists failed') : 'No optional lists enabled'); build(); } }, 'Update lists now')))),

      sect('sites', 'Site settings', 'Per-site exceptions.',
        group('Shields turned off for', Object.keys(cfg.siteShields).length ? el('div', { class: 'chips' }, Object.keys(cfg.siteShields).map((h) => el('span', { class: 'chip' }, h, el('button', { title: 'Turn shields back on', onclick: async () => { await call('siteShields:remove', h); build(); } }, '×')))) : el('div', { class: 'setting dim' }, 'None — shields are up everywhere.')),
        group('Saved permissions', Object.keys(cfg.sitePermissions).length ? Object.entries(cfg.sitePermissions).map(([h, perms]) => el('div', { class: 'setting' }, el('div', { class: 'txt' }, el('div', { class: 'l' }, h), el('div', { class: 'd' }, Object.entries(perms).map(([k, v]) => k + ': ' + v).join(' · '))), el('button', { class: 'btn sm', onclick: async () => { await call('sitePermissions:remove', h); build(); } }, 'Reset'))) : el('div', { class: 'setting dim' }, 'No saved permissions. Nevix asks each time.'))),

      sect('downloads', 'Downloads', '',
        group('', row('Save files to', g.downloadDir || 'System downloads folder', el('button', { class: 'btn', onclick: async () => { const d = await call('download:dir'); if (d) build(); } }, 'Change…')),
          toggle('general.askDownloadLocation', 'Ask where to save each file'))),

      sect('shortcuts', 'Keyboard shortcuts', '', el('div', { class: 'group' }, el('table', { class: 'keys' }, ...[
        ['Command palette', 'K'], ['New tab', 'T'], ['New window', 'N'], ['New private window', 'Shift+N'], ['New isolated tab', 'Alt+N'], ['Close tab', 'W'], ['Reopen closed tab', 'Shift+T'],
        ['Focus address bar', 'L'], ['Find in page', 'F'], ['Bookmark page', 'D'], ['Reader mode', 'Alt+R'], ['Vertical tabs', 'Shift+E'], ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
        ['Go to tab 1–8 / last', '1…9'], ['Zoom in / out / reset', '+ / − / 0'], ['History', 'H'], ['Downloads', 'J'], ['Screenshot', 'Shift+S'], ['Copy clean link', 'Shift+C'], ['Developer tools', 'F12'],
      ].map(([a, k]) => el('tr', {}, el('td', {}, a), el('td', {}, ...k.split(' / ').map((c) => el('span', {}, el('kbd', {}, c.startsWith('Ctrl+') || c.startsWith('F') || c === '…' ? c : MOD + c), ' ')))))))),

      sect('about', 'About Nevix', '',
        group('', row('Version', '', el('span', {}, info.version)), row('Engine', 'Chromium ' + info.chrome + ' · Electron ' + info.electron, el('span', { class: 'dim' }, info.platform)),
          row('Profile folder', info.userData, null)),
        group('Our promise', el('div', { class: 'setting' }, el('div', { class: 'txt d', style: 'font-size:13.5px;line-height:1.6' },
          'No accounts. No sync servers. No telemetry, crash reports or usage pings. No “sponsored” tiles. Nevix talks to the network only when you load a page (and, if you enable optional filter lists, to download them). Everything else stays on this device.')))),
    ];

    const nav = el('nav', {}, el('h2', {}, 'Settings'), ...[['privacy', 'shield', 'Privacy & shields'], ['general', 'gear', 'General'], ['appearance', 'eye', 'Appearance'], ['search', 'search', 'Search'], ['data', 'trash', 'Clear data'], ['lists', 'tag', 'Filter lists'], ['sites', 'globe', 'Site settings'], ['downloads', 'download', 'Downloads'], ['shortcuts', 'bolt', 'Shortcuts'], ['about', 'lock', 'About']]
      .map(([id, ic, label]) => el('a', { 'data-id': id, onclick: () => { history.replaceState(null, '', '#' + id); show(id); } }, icon(ic), label)));
    const main = el('main', {}, ...sections);
    root.replaceChildren(nav, main);
    show((location.hash || '#privacy').slice(1));
  }

  function show(id) {
    const secs = [...document.querySelectorAll('main section')];
    const valid = secs.some((s) => s.id === id);
    const target = valid ? id : 'privacy';
    for (const s of secs) s.style.display = s.id === target ? '' : 'none';
    for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.dataset.id === target);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  build();
  window.nevix.onChange((t) => { if (t === 'settings' && !document.activeElement.matches('input, select')) { const h = location.hash; build().then(() => { location.hash = h; }); } });
})();
