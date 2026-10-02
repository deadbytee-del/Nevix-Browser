'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== false && v !== null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  };

  // ---- icons (24x24 stroke paths) ------------------------------------------------------------
  const P = {
    back: 'M19 12H5M12 19l-7-7 7-7', forward: 'M5 12h14M12 5l7 7-7 7', reload: 'M20 12a8 8 0 1 1-2.5-5.8L20 8.5M20 3.5v5h-5',
    stop: 'M6 6l12 12M18 6L6 18', x: 'M18 6L6 18M6 6l12 12', plus: 'M12 5v14M5 12h14',
    star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z',
    shield: 'M12 21s8-3.5 8-10V5.5L12 3 4 5.5V11c0 6.5 8 10 8 10z', shieldoff: 'M12 21s8-3.5 8-10V5.5L12 3 4 5.5V11c0 6.5 8 10 8 10zM4 4l16 16',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
    download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14', menu: 'M4 7h16M4 12h16M4 17h16',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    vol: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11', mute: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5',
    pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v6', sidebar: 'M4 5h16v14H4zM9.5 5v14', mask: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0M4 4l16 16',
    home: 'M4 11l8-7 8 7M6 10v10h12V10', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
    cmd: 'M9 9h6v6H9zM9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm6 0h2.5A2.5 2.5 0 1 0 15 6.5V9zm0 6v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm-6 0H6.5A2.5 2.5 0 1 0 9 17.5V15z',
    book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11', find: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M9 11h4',
    print: 'M7 9V4h10v5M7 17H5v-6h14v6h-2M7 14h10v6H7z', zoom: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8.5 11h5M11 8.5v5',
    camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
    reader: 'M5 4h14v16H5zM8.5 9h7M8.5 12.5h7M8.5 16h4', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
    box: 'M3 7.5L12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9', moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z', power: 'M12 3v8M6.5 6.5a8 8 0 1 0 11 0',
    chevron: 'M6 9l6 6 6-6', check: 'M5 12.5l4.5 4.5L19 7.5', window: 'M4 5h16v14H4zM4 9h16', ghost: 'M5 20V11a7 7 0 0 1 14 0v9l-3-2-2 2-2-2-2 2-2-2zM9.5 11h.01M14.5 11h.01',
    sleep: 'M4 5h5L4 11h5M13 12h6l-6 7h6M14 4h4l-4 4h4', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01', tag: 'M4 12V5h7l9 9-7 7z',
    open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', dots: 'M5 12h.01M12 12h.01M19 12h.01',
  };
  const icon = (n, size) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', P[n] || P.globe);
    s.append(p);
    return s;
  };
  const put = (id, name) => { const n = $(id); const keep = [...n.children]; n.prepend(icon(name)); keep.forEach((k) => n.append(k)); };

  put('#back', 'back'); put('#forward', 'forward'); put('#reload', 'reload'); put('#star', 'star'); put('#shield', 'shield');
  put('#dl', 'download'); put('#menu', 'menu'); put('#newtab', 'plus'); put('#side-newtab', 'plus'); put('#side-collapse', 'sidebar');
  for (const b of document.querySelectorAll('#side-foot [data-page]')) b.append(icon({ downloads: 'download', history: 'clock', settings: 'gear' }[b.dataset.page]));

  const IS_MAC = nx.platform === 'darwin';
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  document.documentElement.classList.toggle('mac', IS_MAC);
  document.body.classList.toggle('mac', IS_MAC);
  if (location.hash === '#private') document.body.classList.add('private');

  let S = null;                 // latest state
  let panel = null;             // current overlay panel descriptor
  let findOpen = false;
  let bookmarks = [];
  let downloads = [];
  let toastTimer = 0;

  const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const favNode = (url, favicon, title, loading) => {
    const f = el('span', { class: 't-fav' + (loading ? ' spin' : '') });
    if (favicon) f.append(el('img', { src: favicon, draggable: 'false' }));
    else if (url && /^https?:/.test(url)) { const h = hostOf(url); f.style.background = `hsl(${hue(h)} 45% 42%)`; f.textContent = (h[0] || '?').toUpperCase(); }
    else if (/^nevix:/.test(url) || !url) { f.append(icon('shield', 15)); f.style.color = 'var(--accent)'; }
    else f.append(icon('globe', 15));
    return f;
  };

  // ---- state rendering -----------------------------------------------------------------------
  function render(state) {
    S = state;
    document.body.classList.toggle('private', state.private);
    document.documentElement.style.setProperty('--accent', state.private ? '#c18cff' : state.settings.accent);
    const v = state.settings.verticalTabs;
    document.body.classList.toggle('vertical', v);
    document.body.classList.toggle('sb-collapsed', v && state.settings.sidebarCollapsed);
    document.body.classList.toggle('bm-on', state.settings.bookmarksBar);
    document.documentElement.style.setProperty('--sw', (state.settings.sidebarCollapsed ? 58 : 248) + 'px');
    renderTabs();
    renderToolbar();
    renderBookmarks();
  }

  const tabEls = new Map();
  function renderTabs() {
    const v = S.settings.verticalTabs;
    const hostMain = v ? $('#side-tabs') : $('#tabs');
    const hostPins = v ? $('#side-pins') : null;
    const ids = new Set(S.tabs.map((t) => t.id));
    for (const [id, e] of tabEls) if (!ids.has(id)) { e.remove(); tabEls.delete(id); }
    let pinIdx = 0, mainIdx = 0;
    for (const t of S.tabs) {
      let e = tabEls.get(t.id);
      if (!e) { e = makeTab(t); tabEls.set(t.id, e); }
      updateTab(e, t);
      const target = v && t.pinned ? hostPins : hostMain;
      const idx = v && t.pinned ? pinIdx++ : mainIdx++;
      if (e.parentNode !== target || target.children[idx] !== e) target.insertBefore(e, target.children[idx] || null);
    }
    if (v && !S.tabs.some((t) => t.pinned)) hostPins.replaceChildren();
  }

  function makeTab(t) {
    const e = el('div', { class: 'tab', draggable: 'true', 'data-id': t.id });
    e.addEventListener('mousedown', (ev) => {
      if (ev.button === 0) nx.cmd('tab.activate', t.id);
      if (ev.button === 1) { ev.preventDefault(); nx.cmd('tab.close', t.id); }
    });
    e.addEventListener('contextmenu', (ev) => { ev.preventDefault(); nx.cmd('tab.context', t.id); });
    e.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/x-nevix-tab', String(t.id)); ev.dataTransfer.effectAllowed = 'move'; e.classList.add('dragging'); });
    e.addEventListener('dragend', () => { e.classList.remove('dragging'); clearDrop(); });
    e.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer.types.includes('text/x-nevix-tab')) return;
      ev.preventDefault(); clearDrop();
      const r = e.getBoundingClientRect();
      const before = S.settings.verticalTabs ? ev.clientY < r.top + r.height / 2 : ev.clientX < r.left + r.width / 2;
      e.classList.add(before ? 'drop-before' : 'drop-after');
    });
    e.addEventListener('dragleave', () => e.classList.remove('drop-before', 'drop-after'));
    e.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const id = +ev.dataTransfer.getData('text/x-nevix-tab');
      const before = e.classList.contains('drop-before');
      clearDrop();
      const from = S.tabs.findIndex((x) => x.id === id);
      let to = S.tabs.findIndex((x) => x.id === t.id) + (before ? 0 : 1);
      if (from < to) to--;
      if (id && from !== -1 && from !== to) nx.cmd('tab.move', { id, index: to });
    });
    return e;
  }
  const clearDrop = () => document.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));

  function updateTab(e, t) {
    e.classList.toggle('active', t.id === S.activeId);
    e.classList.toggle('pinned', t.pinned);
    e.classList.toggle('sleeping', t.sleeping);
    e.classList.toggle('iso', t.iso);
    e.title = (t.iso ? '[Isolated] ' : '') + t.title + (t.sleeping ? ' (sleeping)' : '');
    const sig = [t.favicon.length, t.url.slice(0, 40), t.loading, t.audible, t.muted, t.title, t.pinned].join('|');
    if (e._sig === sig) return;
    e._sig = sig;
    const kids = [favNode(t.url, t.favicon, t.title, t.loading)];
    kids.push(el('span', { class: 't-title' }, t.title));
    if (t.audible || t.muted) kids.push(el('span', { class: 't-audio', title: t.muted ? 'Unmute' : 'Mute', onmousedown: (ev) => { ev.stopPropagation(); nx.cmd('tab.mute', t.id); } }, icon(t.muted ? 'mute' : 'vol')));
    kids.push(el('button', { class: 't-close', title: 'Close tab', onmousedown: (ev) => { ev.stopPropagation(); nx.cmd('tab.close', t.id); } }, icon('x')));
    e.replaceChildren(...kids);
  }

  function formatUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return [el('span', { class: 'h' }, url)];
      const host = u.hostname.replace(/^www\./, '');
      const rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
      return [el('span', { class: 'h' }, host), el('span', { class: 'r' }, rest.length > 90 ? rest.slice(0, 90) + '…' : rest)];
    } catch { return [el('span', { class: 'h' }, url)]; }
  }

  const urlInput = $('#url');
  let omniEdited = false;   // true once the user has typed into the address bar
  function renderToolbar() {
    const a = S.active;
    $('#back').disabled = !a || !a.canBack;
    $('#forward').disabled = !a || !a.canForward;
    const reloadBtn = $('#reload');
    const wantStop = a && a.loading;
    if (reloadBtn._stop !== wantStop) { reloadBtn._stop = wantStop; reloadBtn.replaceChildren(icon(wantStop ? 'stop' : 'reload')); reloadBtn.title = wantStop ? 'Stop' : 'Reload'; }
    const shown = a ? a.url : '';
    if (document.activeElement !== urlInput || !omniEdited) {
      if (urlInput.value !== shown) urlInput.value = shown;
      if (document.activeElement === urlInput) urlInput.select();
      $('#url-display').replaceChildren(...(a && a.url ? formatUrl(a.url) : []));
    }
    const si = $('#siteinfo');
    si.className = '';
    let ic = 'shield';
    if (a && a.url) {
      if (a.secure) { si.classList.add('secure'); ic = 'lock'; }
      else if (/^https?:/.test(a.url)) { si.classList.add('insecure'); ic = 'unlock'; }
      else ic = 'shield';
    }
    si.replaceChildren(icon(a && a.shieldsOff ? 'shieldoff' : ic));
    $('#star').classList.toggle('on', !!(a && a.bookmarked));
    $('#star').style.display = a && /^https?:/.test(a.rawUrl) ? '' : 'none';
    const z = $('#zoom');
    z.hidden = !a || !a.zoom;
    if (a && a.zoom) z.textContent = Math.round(Math.pow(1.2, a.zoom) * 100) + '%';
    const c = a ? a.counters : null;
    const total = c ? c.ads + c.trackers + c.upgrades : 0;
    const sc = $('#shield-count');
    sc.hidden = !total || (a && a.shieldsOff);
    sc.textContent = total > 99 ? '99+' : total;
    $('#shield').classList.toggle('off', !!(a && a.shieldsOff));
    if (S.private && !$('.private-badge')) $('#toolbar .grp:last-child').prepend(el('div', { class: 'private-badge' }, icon('mask', 15), 'Private'));
    if (panel && panel.kind === 'shield') showPanel('shield', true);
  }

  function renderBookmarks() {
    const bar = $('#bmbar');
    if (!S.settings.bookmarksBar) return;
    bar.replaceChildren();
    if (!bookmarks.length) { bar.append(el('div', { class: 'bm-empty' }, 'Bookmarks you add appear here — press ' + MOD + 'D on any page.')); return; }
    for (const b of bookmarks) {
      const item = el('button', { class: 'bm', title: b.title + '\n' + b.url },
        favNode(b.url, '', b.title), el('span', {}, b.title));
      item.addEventListener('click', () => nx.cmd('nav', { text: b.url }));
      item.addEventListener('auxclick', (ev) => { if (ev.button === 1) nx.cmd('nav', { text: b.url, newTab: true }); });
      item.addEventListener('contextmenu', (ev) => { ev.preventDefault(); showPanel('bmctx', false, { b, x: ev.clientX, y: ev.clientY }); });
      bar.append(item);
    }
  }

  // ---- overlay panels ------------------------------------------------------------------------
  const overlay = $('#overlay'), panelEl = $('#panel');
  function openOverlay(dim) {
    if (overlay.hidden) nx.cmd('overlay', true);
    overlay.hidden = false;
    overlay.classList.toggle('dim', !!dim);
  }
  function closePanel(refocus = true) {
    if (!panel && overlay.hidden) return;
    panel = null;
    overlay.hidden = true;
    panelEl.replaceChildren();
    nx.cmd('overlay', false);
    if (document.activeElement === urlInput) urlInput.blur();
  }
  $('#backdrop').addEventListener('mousedown', () => closePanel());
  const place = (x, y, right) => {
    panelEl.style.left = panelEl.style.right = panelEl.style.top = '';
    if (right) panelEl.style.right = x + 'px'; else panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
  };

  const menuItem = (ic, label, kb, fn, sel) => el('div', { class: 'menu-item' + (sel ? ' sel' : ''), onclick: () => { closePanel(); fn(); } },
    ic ? icon(ic) : el('span', { style: 'width:18px' }), el('span', {}, label), kb ? el('span', { class: 'kb' }, kb) : null);
  const exec = (name, arg) => () => nx.cmd('exec', { name, arg });

  function showPanel(kind, rerender, data) {
    if (!S) return;
    if (!rerender) { panel = { kind, data }; openOverlay(kind === 'palette'); }
    else if (!panel || panel.kind !== kind) return;
    panelEl.replaceChildren();
    panelEl.style.width = '';
    const a = S.active;
    if (kind === 'menu') {
      const mb = $('#menu').getBoundingClientRect();
      place(Math.max(8, window.innerWidth - mb.right), mb.bottom + 6, true);
      panelEl.style.width = '290px';
      const k = (s) => MOD + s;
      panelEl.append(el('div', { class: 'menu-pad' },
        menuItem('plus', 'New tab', k('T'), exec('newTab')),
        menuItem('window', 'New window', k('N'), exec('newWindow')),
        menuItem('mask', 'New private window', k('⇧N'), exec('privateWindow')),
        menuItem('box', 'New isolated tab', k('⌥N'), exec('isolatedTab')),
        el('div', { class: 'menu-sep' }),
        menuItem('clock', 'History', k(IS_MAC ? 'Y' : 'H'), exec('openPage', 'history')),
        menuItem('book', 'Bookmarks', k('⇧O'), exec('openPage', 'bookmarks')),
        menuItem('download', 'Downloads', k('J'), exec('openPage', 'downloads')),
        el('div', { class: 'menu-sep' }),
        menuItem('find', 'Find in page', k('F'), exec('find')),
        menuItem('reader', 'Reader mode', k('⌥R'), exec('reader')),
        menuItem('print', 'Print…', k('P'), exec('print')),
        menuItem('camera', 'Take screenshot', k('⇧S'), exec('capture')),
        menuItem('code', 'Developer tools', 'F12', exec('devtools')),
        el('div', { class: 'menu-sep' }),
        menuItem('sidebar', S.settings.verticalTabs ? 'Use horizontal tabs' : 'Use vertical tabs', k('⇧E'), exec('toggleVertical')),
        menuItem('cmd', 'Command palette', k('K'), exec('palette')),
        menuItem('gear', 'Settings', k(','), exec('openPage', 'settings')),
        el('div', { class: 'menu-sep' }),
        menuItem('power', 'Quit Nevix', '', () => nx.cmd('quit')),
      ));
    } else if (kind === 'shield') {
      const anchor = $('#siteinfo').getBoundingClientRect();
      place(Math.max(8, anchor.left - 4), anchor.bottom + 8);
      panelEl.style.width = '340px';
      if (!a) return;
      const internal = a.internal || !/^https?:/.test(a.rawUrl);
      const c = a.counters;
      panelEl.append(el('div', { class: 'panel-head' },
        el('h3', {}, icon(a.shieldsOff ? 'shieldoff' : 'shield'), internal ? 'Nevix page' : a.host),
        el('p', {}, internal ? 'Internal page — nothing leaves your device.' : a.secure ? 'Connection is encrypted (HTTPS).' : 'Connection is not encrypted. Avoid entering private data.')));
      if (!internal) {
        panelEl.append(
          el('div', { class: 'row' }, el('span', {}, 'Shields for this site'), el('div', { class: 'switch' + (a.shieldsOff ? '' : ' on'), onclick: () => nx.cmd('shield.site', { off: !a.shieldsOff }) })),
          el('div', { class: 'menu-sep' }),
          row('globe', 'Ads blocked', c.ads), row('search', 'Trackers blocked', c.trackers),
          row('tag', 'Third-party cookies blocked', c.cookies), row('lock', 'Upgraded to HTTPS', c.upgrades),
        );
        if (a.perms.length) {
          panelEl.append(el('div', { class: 'menu-sep' }), el('div', { class: 'row dim' }, 'Site permissions'),
            el('div', { class: 'row', style: 'flex-wrap:wrap;padding-top:0' }, a.perms.map((p) => el('span', { class: 'chip' }, p.perm + ': ' + p.value, el('button', { title: 'Reset', onclick: () => nx.cmd('perm.revoke', p.perm) }, '×')))));
        }
        panelEl.append(el('div', { class: 'menu-sep' }), el('div', { class: 'menu-pad' },
          menuItem('reader', 'Reader mode', '', exec('reader')),
          menuItem('link', 'Copy clean link', k2('⇧C'), exec('copyCleanUrl')),
          menuItem('trash', 'Clear cookies & data for this site', '', exec('clearSiteData'))));
      } else {
        panelEl.append(el('div', { class: 'menu-pad' }, menuItem('gear', 'Privacy settings', '', exec('openPage', 'settings#privacy'))));
      }
    } else if (kind === 'downloads') {
      const anchor = $('#dl').getBoundingClientRect();
      place(Math.max(8, window.innerWidth - anchor.right - 8), anchor.bottom + 8, true);
      panelEl.style.width = '360px';
      panelEl.append(el('div', { class: 'panel-head' }, el('h3', {}, icon('download'), 'Downloads')));
      const list = downloads.slice(0, 6);
      if (!list.length) panelEl.append(el('div', { class: 'empty' }, 'No downloads yet'));
      for (const d of list) panelEl.append(dlRow(d));
      panelEl.append(el('div', { class: 'menu-sep' }), el('div', { class: 'menu-pad' }, menuItem('open', 'Show all downloads', k2('J'), exec('openPage', 'downloads'))));
    } else if (kind === 'bmctx') {
      const { b, x, y } = data;
      place(Math.min(x, window.innerWidth - 230), y + 4);
      panelEl.style.width = '220px';
      panelEl.append(el('div', { class: 'menu-pad' },
        menuItem('open', 'Open', '', () => nx.cmd('nav', { text: b.url })),
        menuItem('plus', 'Open in new tab', '', () => nx.cmd('nav', { text: b.url, newTab: true })),
        menuItem('trash', 'Remove bookmark', '', () => nx.cmd('bookmark.remove', b.id))));
    } else if (kind === 'palette') { palette(); }
  }
  const k2 = (s) => MOD + s;
  const row = (ic, label, n) => el('div', { class: 'row' }, el('span', { class: 'ico' }, icon(ic)), el('span', {}, label), el('span', { class: 'num' }, String(n || 0)));
  const fmtBytes = (n) => n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
  function dlRow(d) {
    const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0;
    const status = d.state === 'progressing' ? `${fmtBytes(d.received)}${d.total > 0 ? ' / ' + fmtBytes(d.total) : ''}` : d.state === 'completed' ? fmtBytes(d.total || d.received) : d.state;
    return el('div', { class: 'dl-item' },
      el('div', { class: 'top' }, el('span', { class: 'name', title: d.name }, d.name), el('span', { class: 'dim' }, status)),
      d.state === 'progressing' || d.state === 'paused' ? el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })) : null,
      el('div', { class: 'top' },
        d.state === 'completed' ? el('button', { class: 'btn', onclick: () => nx.cmd('download.action', { id: d.id, action: 'open' }) }, 'Open') : null,
        d.state === 'completed' ? el('button', { class: 'btn', onclick: () => nx.cmd('download.action', { id: d.id, action: 'show' }) }, 'Show in folder') : null,
        d.state === 'progressing' ? el('button', { class: 'btn', onclick: () => nx.cmd('download.action', { id: d.id, action: 'pause' }) }, 'Pause') : null,
        d.state === 'paused' ? el('button', { class: 'btn', onclick: () => nx.cmd('download.action', { id: d.id, action: 'resume' }) }, 'Resume') : null,
        d.state === 'progressing' || d.state === 'paused' ? el('button', { class: 'btn', onclick: () => nx.cmd('download.action', { id: d.id, action: 'cancel' }) }, 'Cancel') : null));
  }

  // ---- command palette -----------------------------------------------------------------------
  const COMMANDS = () => [
    ['plus', 'New tab', MOD + 'T', exec('newTab')],
    ['mask', 'New private window', MOD + '⇧N', exec('privateWindow')],
    ['box', 'New isolated tab (separate cookies & storage)', MOD + '⌥N', exec('isolatedTab')],
    ['window', 'New window', MOD + 'N', exec('newWindow')],
    ['x', 'Close tab', MOD + 'W', exec('closeTab')],
    ['reload', 'Reopen closed tab', MOD + '⇧T', exec('reopenTab')],
    ['reload', 'Reload page', MOD + 'R', exec('reload')],
    ['reader', 'Toggle reader mode', MOD + '⌥R', exec('reader')],
    ['find', 'Find in page', MOD + 'F', exec('find')],
    ['star', 'Bookmark this page', MOD + 'D', exec('bookmark')],
    ['star', 'Bookmark all open tabs', MOD + '⇧D', exec('bookmarkAll')],
    ['book', 'Toggle bookmarks bar', MOD + '⇧B', exec('toggleBookmarksBar')],
    ['sidebar', 'Toggle vertical tabs', MOD + '⇧E', exec('toggleVertical')],
    ['sidebar', 'Collapse / expand sidebar', '', exec('toggleSidebar')],
    ['shield', 'Toggle shields for this site', '', () => nx.cmd('shield.site', { off: !(S.active && S.active.shieldsOff) })],
    ['trash', 'Clear cookies & data for this site', '', exec('clearSiteData')],
    ['trash', 'Clear browsing data…', MOD + '⇧⌫', exec('openPage', 'settings#data')],
    ['link', 'Copy clean link (no tracking parameters)', MOD + '⇧C', exec('copyCleanUrl')],
    ['sleep', 'Put all other tabs to sleep', MOD + '⌥S', exec('sleepOthers')],
    ['mute', 'Mute / unmute tab', MOD + '⇧M', exec('muteTab')],
    ['zoom', 'Zoom in', MOD + '+', exec('zoomIn')], ['zoom', 'Zoom out', MOD + '-', exec('zoomOut')], ['zoom', 'Reset zoom', MOD + '0', exec('zoomReset')],
    ['print', 'Print…', MOD + 'P', exec('print')], ['print', 'Save page as PDF…', '', exec('savePdf')],
    ['camera', 'Take screenshot of page', MOD + '⇧S', exec('capture')],
    ['code', 'View page source', MOD + 'U', exec('viewSource')], ['code', 'Developer tools', 'F12', exec('devtools')],
    ['clock', 'History', IS_MAC ? MOD + 'Y' : MOD + 'H', exec('openPage', 'history')],
    ['book', 'Bookmarks', MOD + '⇧O', exec('openPage', 'bookmarks')],
    ['download', 'Downloads', MOD + 'J', exec('openPage', 'downloads')],
    ['gear', 'Settings', MOD + ',', exec('openPage', 'settings')],
    ['shield', 'Privacy & shields settings', '', exec('openPage', 'settings#privacy')],
    ['window', 'Toggle fullscreen', 'F11', exec('fullscreen')],
    ['power', 'Quit Nevix', '', () => nx.cmd('quit')],
  ];
  function palette() {
    const wrap = el('div');
    panelEl.style.cssText = 'left:50%;top:14vh;transform:translateX(-50%);width:min(640px,92vw)';
    const input = el('input', { placeholder: 'Type a command, tab, bookmark or site…', spellcheck: 'false' });
    const list = el('div', { class: 'pal-list' });
    wrap.append(el('div', { class: 'pal-in' }, icon('cmd', 20), input), list);
    panelEl.append(wrap);
    let items = [], sel = 0, seq = 0;
    const draw = () => {
      list.replaceChildren();
      let group = '';
      items.forEach((it, i) => {
        if (it.group !== group) { group = it.group; list.append(el('div', { class: 'pal-group' }, group)); }
        const row = el('div', { class: 'pal-item' + (i === sel ? ' sel' : '') },
          it.tab && it.tab.favicon ? favNode(it.url, it.tab.favicon) : icon(it.icon), el('span', { class: 'grow' }, it.label, it.sub ? el('span', { class: 'dim' }, '  ' + it.sub) : null), it.kb ? el('span', { class: 'kb' }, it.kb) : null);
        row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; draw(); } });
        row.addEventListener('click', () => run(it));
        list.append(row);
      });
      const s = list.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    };
    const run = (it) => { closePanel(); it.run(); };
    const score = (label, q) => { label = label.toLowerCase(); if (label.includes(q)) return 100 - label.indexOf(q); let i = 0; for (const ch of label) if (ch === q[i]) i++; return i === q.length ? 10 : 0; };
    const compute = async () => {
      const q = input.value.trim().toLowerCase();
      const my = ++seq;
      const out = [];
      const tabs = S.tabs.map((t) => ({ group: 'Open tabs', icon: 'globe', label: t.title || t.url, sub: hostOf(t.url), url: t.url, tab: t, run: () => nx.cmd('tab.activate', t.id), s: q ? score(t.title + ' ' + t.url, q) : 1 }));
      const cmds = COMMANDS().map(([ic, label, kb, fn]) => ({ group: 'Commands', icon: ic, label, kb, run: fn, s: q ? score(label, q) : 1 }));
      const bms = bookmarks.map((b) => ({ group: 'Bookmarks', icon: 'star', label: b.title, sub: hostOf(b.url), run: () => nx.cmd('nav', { text: b.url }), s: q ? score(b.title + ' ' + b.url, q) : 0 }));
      out.push(...(q ? tabs.filter((x) => x.s) : tabs.slice(0, 5)), ...cmds.filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, q ? 8 : 12), ...bms.filter((x) => x.s).slice(0, 4));
      if (q) {
        const sug = await nx.cmd('suggest', q);
        if (my !== seq) return;
        for (const s of sug.filter((x) => x.type === 'history').slice(0, 4)) out.push({ group: 'History', icon: 'clock', label: s.title, sub: hostOf(s.url), run: () => nx.cmd('nav', { text: s.url }) });
        out.push({ group: 'Web', icon: 'search', label: sug[0] ? sug[0].title : q, run: () => nx.cmd('nav', { text: q, newTab: true }) });
      }
      items = out; sel = 0; draw();
    };
    input.addEventListener('input', compute);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[sel]) run(items[sel]);
      else if (e.key === 'Escape') closePanel();
    });
    compute();
    setTimeout(() => input.focus(), 20);
  }

  // ---- omnibox -------------------------------------------------------------------------------
  let sugs = [], sugSel = -1, sugSeq = 0, typed = '';
  const sugIcon = { search: 'search', url: 'globe', history: 'clock', bookmark: 'star', tab: 'window' };
  function drawSuggestions() {
    if (!sugs.length) { if (panel && panel.kind === 'sug') closePanelKeepFocus(); return; }
    if (!panel || panel.kind !== 'sug') { panel = { kind: 'sug' }; openOverlay(false); }
    const r = $('#omni').getBoundingClientRect();
    panelEl.style.cssText = `left:${r.left}px;top:${r.bottom + 6}px;width:${r.width}px`;
    panelEl.replaceChildren(el('div', { class: 'menu-pad' }, sugs.map((s, i) => {
      const row = el('div', { class: 'sug' + (i === sugSel ? ' sel' : '') },
        el('span', { class: 's-ico' }, s.type === 'history' || s.type === 'bookmark' ? favNode(s.url, '', s.title) : icon(sugIcon[s.type] || 'globe')),
        el('span', { class: 's-main' }, s.title, s.type !== 'search' && s.title !== s.url ? el('span', { class: 's-url' }, s.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)) : null),
        s.type === 'tab' ? el('span', { class: 's-tag' }, 'Switch to tab') : s.type === 'bookmark' ? el('span', { class: 's-tag' }, 'Bookmark') : null);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); chooseSuggestion(s, e.altKey); });
      return row;
    })));
  }
  function closePanelKeepFocus() { panel = null; overlay.hidden = true; panelEl.replaceChildren(); nx.cmd('overlay', false); }
  function chooseSuggestion(s, newTab) {
    closePanelKeepFocus();
    urlInput.blur();
    if (s.type === 'tab') nx.cmd('tab.activate', s.tabId);
    else nx.cmd('nav', { text: s.url, newTab });
  }
  urlInput.addEventListener('focus', () => { urlInput.select(); $('#url-display').replaceChildren(); });
  urlInput.addEventListener('blur', () => { omniEdited = false; setTimeout(() => { if (panel && panel.kind === 'sug') closePanelKeepFocus(); if (S) renderToolbar(); }, 120); });
  urlInput.addEventListener('input', async () => {
    omniEdited = true;
    typed = urlInput.value;
    const my = ++sugSeq;
    if (!typed.trim()) { sugs = []; sugSel = -1; drawSuggestions(); return; }
    const r = await nx.cmd('suggest', typed);
    if (my !== sugSeq) return;
    sugs = r; sugSel = 0; drawSuggestions();
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && sugs.length) { sugSel = (sugSel + 1) % sugs.length; urlInput.value = sugs[sugSel].type === 'search' ? typed : sugs[sugSel].url; drawSuggestions(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && sugs.length) { sugSel = (sugSel - 1 + sugs.length) % sugs.length; urlInput.value = sugs[sugSel].type === 'search' ? typed : sugs[sugSel].url; drawSuggestions(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const s = sugs[sugSel];
      if (s && s.type === 'tab' && urlInput.value === s.url) return chooseSuggestion(s, false);
      const text = urlInput.value;
      closePanelKeepFocus(); urlInput.blur();
      nx.cmd('nav', { text, newTab: e.altKey });
    } else if (e.key === 'Escape') { urlInput.value = S && S.active ? S.active.url : ''; closePanelKeepFocus(); urlInput.blur(); }
  });
  $('#omni').addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; if (document.activeElement !== urlInput) { e.preventDefault(); urlInput.focus(); urlInput.select(); } });

  // ---- find bar / permission bar -------------------------------------------------------------
  const infobar = $('#infobar');
  function openFind() {
    findOpen = true;
    infobar.hidden = false;
    infobar.replaceChildren();
    const input = el('input', { type: 'text', placeholder: 'Find in page', spellcheck: 'false' });
    const count = el('span', { class: 'dim', id: 'find-count' }, '');
    const mc = el('input', { type: 'checkbox' });
    const go = (forward, next) => nx.cmd('find', { text: input.value, forward, next, matchCase: mc.checked });
    input.addEventListener('input', () => go(true, false));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(!e.shiftKey, true); if (e.key === 'Escape') closeFind(); });
    mc.addEventListener('change', () => go(true, false));
    infobar.append(icon('find'), input, count, el('button', { class: 'btn', onclick: () => go(false, true) }, '↑'), el('button', { class: 'btn', onclick: () => go(true, true) }, '↓'),
      el('label', { class: 'chk' }, mc, 'Match case'), el('span', { class: 'grow' }), el('button', { class: 'ib', onclick: closeFind }, icon('x')));
    nx.cmd('infobar', true).then(() => { input.focus(); input.select(); });
    infobar._find = { input, go };
  }
  function closeFind() { findOpen = false; infobar.hidden = true; infobar.replaceChildren(); nx.cmd('find.close'); }
  let permShown = null;
  function showPermission(p) {
    if (!p) { permShown = null; if (!findOpen) { infobar.hidden = true; infobar.replaceChildren(); } return; }
    permShown = p; findOpen = false;
    infobar.hidden = false;
    const remember = el('input', { type: 'checkbox', checked: true });
    const ans = (allow) => { nx.cmd('perm.answer', { id: p.id, allow, remember: remember.checked }); };
    infobar.replaceChildren(icon('shield'), el('span', {}, el('b', {}, p.origin.host || 'This page'), ' wants to ' + p.origin.label),
      el('span', { class: 'grow' }), el('label', { class: 'chk' }, remember, 'Remember'),
      el('button', { class: 'btn primary', onclick: () => ans(true) }, 'Allow'), el('button', { class: 'btn', onclick: () => ans(false) }, 'Block'));
  }

  // ---- wiring --------------------------------------------------------------------------------
  $('#back').onclick = () => nx.cmd('exec', { name: 'back' });
  $('#forward').onclick = () => nx.cmd('exec', { name: 'forward' });
  $('#reload').onclick = () => nx.cmd('exec', { name: S && S.active && S.active.loading ? 'stop' : 'reload' });
  $('#star').onclick = () => nx.cmd('exec', { name: 'bookmark' });
  $('#siteinfo').onclick = () => showPanel('shield');
  $('#shield').onclick = () => showPanel('shield');
  $('#menu').onclick = () => showPanel('menu');
  $('#dl').onclick = () => { $('#dl-dot').hidden = true; showPanel('downloads'); };
  $('#newtab').onclick = () => nx.cmd('tab.new');
  $('#side-newtab').onclick = () => nx.cmd('tab.new');
  $('#side-collapse').onclick = () => nx.cmd('exec', { name: 'toggleSidebar' });
  $('#strip-fill').addEventListener('dblclick', () => nx.cmd('tab.new'));
  for (const b of document.querySelectorAll('#side-foot [data-page]')) b.onclick = () => nx.cmd('exec', { name: 'openPage', arg: b.dataset.page });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  nx.on('state', render);
  nx.on('bookmarks', (b) => { bookmarks = b; renderBookmarks(); });
  nx.on('downloads', (d) => { downloads = d; if (panel && panel.kind === 'downloads') showPanel('downloads', true); });
  nx.on('download-started', () => { if (!panel) $('#dl-dot').hidden = false; });
  nx.on('toast', (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); });
  nx.on('focus-omnibox', () => { urlInput.focus(); urlInput.select(); });
  nx.on('open-find', () => { if (findOpen && infobar._find) { infobar._find.input.focus(); infobar._find.input.select(); } else openFind(); });
  nx.on('find', (r) => { const c = $('#find-count'); if (c) c.textContent = r.matches ? `${r.active}/${r.matches}` : (infobar._find && infobar._find.input.value ? 'No results' : ''); });
  nx.on('find-next', (d) => { if (findOpen && infobar._find) infobar._find.go(d.forward, true); });
  nx.on('palette', () => showPanel('palette'));
  nx.on('permission', showPermission);
  nx.on('escape', () => { if (panel) closePanel(); else if (findOpen) closeFind(); else if (permShown) nx.cmd('perm.answer', { id: permShown.id, allow: false, remember: false }); });
  nx.on('fullscreen', () => {});

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (panel) { closePanel(); e.preventDefault(); } else if (findOpen) { closeFind(); e.preventDefault(); } }
  });
  window.addEventListener('resize', () => { if (panel && panel.kind === 'sug') drawSuggestions(); });

  Promise.all([nx.cmd('state'), nx.cmd('bookmarks'), nx.cmd('downloads')]).then(([s, b, d]) => { bookmarks = b; downloads = d; if (s) render(s); });
  window.__nxdebug = { get state() { return S; }, showPanel, closePanel, openFind };
})();
