'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== false && v !== null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  };

  // ---- icons (24x24 stroke paths) ------------------------------------------------------------------
  const P = {
    back: 'M19 12H5M12 19l-7-7 7-7', forward: 'M5 12h14M12 5l7 7-7 7', reload: 'M20 12a8 8 0 1 1-2.5-5.8L20 8.5M20 3.5v5h-5',
    stop: 'M6 6l12 12M18 6L6 18', x: 'M18 6L6 18M6 6l12 12', plus: 'M12 5v14M5 12h14',
    star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z',
    shield: 'M12 21s8-3.5 8-10V5.5L12 3 4 5.5V11c0 6.5 8 10 8 10z', shieldoff: 'M12 21s8-3.5 8-10V5.5L12 3 4 5.5V11c0 6.5 8 10 8 10zM4 4l16 16',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
    download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14', menu: 'M4 7h16M4 12h16M4 17h16',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    vol: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11', mute: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5',
    sidebar: 'M4 5h16v14H4zM9.5 5v14', mask: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0M4 4l16 16',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
    cmd: 'M9 9h6v6H9zM9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm6 0h2.5A2.5 2.5 0 1 0 15 6.5V9zm0 6v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm-6 0H6.5A2.5 2.5 0 1 0 9 17.5V15z',
    book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11', find: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M9 11h4',
    print: 'M7 9V4h10v5M7 17H5v-6h14v6h-2M7 14h10v6H7z', camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14',
    reader: 'M5 4h14v16H5zM8.5 9h7M8.5 12.5h7M8.5 16h4', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
    box: 'M3 7.5L12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9', power: 'M12 3v8M6.5 6.5a8 8 0 1 0 11 0', window: 'M4 5h16v14H4zM4 9h16',
    sleep: 'M4 5h5L4 11h5M13 12h6l-6 7h6M14 4h4l-4 4h4', warn: 'M12 4l9 16H3zM12 10v4M12 17h.01', tag: 'M4 12V5h7l9 9-7 7z', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-5', puzzle: 'M10 4h4v3a2 2 0 1 0 0 4v3h-4v-3a2 2 0 1 1 0-4z', flag: 'M5 21V4M5 4h11l-2 4 2 4H5', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    snow: 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9', term: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5', calc: 'M5 3h14v18H5zM8 7h8M8 11h2M12 11h2M8 15h2M12 15h2M8 18h2M12 18h2', swap: 'M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4',
    group: 'M3 9a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', check: 'M5 12.5l4.5 4.5L19 7.5',
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
  document.documentElement.classList.toggle('mac', IS_MAC);
  document.body.classList.toggle('mac', IS_MAC);
  if (location.hash === '#private') document.body.classList.add('private');

  let S = null;                 // latest state
  let panel = null;             // current overlay panel descriptor
  let findOpen = false;
  let bookmarks = [];
  let downloads = [];
  let commands = null;          // palette command list (fetched from main's registry)
  let toastTimer = 0;
  const GROUP_VAR = { primary: 'var(--color-primary)', warning: 'var(--color-warning)', success: 'var(--color-success)', danger: 'var(--color-danger-hover)', neutral: 'var(--color-text-secondary)' };

  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const favNode = (url, favicon, loading) => {
    const f = el('span', { class: 't-fav' + (loading ? ' spin' : '') });
    if (favicon) f.append(el('img', { src: favicon, draggable: 'false' }));
    else if (url && /^https?:/.test(url)) { const h = hostOf(url); f.style.background = 'var(--color-surface-tertiary)'; f.style.color = 'var(--color-primary-text)'; f.textContent = (h[0] || '?').toUpperCase(); }
    else if (/^nevix:/.test(url) || !url) { f.textContent = 'N'; f.style.color = 'var(--color-primary-text)'; f.style.fontFamily = 'var(--font-mono)'; }
    else f.append(icon('globe', 15));
    return f;
  };
  const fmtBytes = (n) => n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
  const fmtEta = (s) => (s > 3600 ? Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm' : s > 60 ? Math.round(s / 60) + ' min' : s + ' s');

  // ---- state rendering -----------------------------------------------------------------------------
  function render(state) {
    S = state;
    document.body.classList.toggle('private', state.private);
    document.documentElement.style.setProperty('--color-primary', state.settings.accent || '');
    const v = state.settings.verticalTabs;
    document.body.classList.toggle('vertical', v);
    document.body.classList.toggle('sb-collapsed', v && state.settings.sidebarCollapsed);
    document.body.classList.toggle('bm-on', state.settings.bookmarksBar);
    document.documentElement.style.setProperty('--sw', (state.settings.sidebarCollapsed ? 58 : 240) + 'px');
    renderTabs();
    renderToolbar();
    renderBookmarks();
  }

  const tabEls = new Map();
  const chipEls = new Map();
  function renderTabs() {
    const v = S.settings.verticalTabs;
    const hostMain = v ? $('#side-tabs') : $('#tabs');
    const hostPins = v ? $('#side-pins') : null;
    const ids = new Set(S.tabs.map((t) => t.id));
    for (const [id, e] of tabEls) if (!ids.has(id)) { e.remove(); tabEls.delete(id); }
    const gids = new Set(S.groups.map((g) => g.id));
    for (const [id, e] of chipEls) if (!gids.has(id)) { e.remove(); chipEls.delete(id); }
    const order = [];     // desired child order of hostMain
    const pins = [];
    let lastGroup = 0;
    for (const t of S.tabs) {
      let e = tabEls.get(t.id);
      if (!e) { e = makeTab(t); tabEls.set(t.id, e); }
      updateTab(e, t);
      if (v && t.pinned) { pins.push(e); continue; }
      if (t.group && t.group !== lastGroup) {
        const g = S.groups.find((x) => x.id === t.group);
        if (g) {
          let chip = chipEls.get(g.id);
          if (!chip) { chip = makeChip(g); chipEls.set(g.id, chip); }
          updateChip(chip, g);
          order.push(chip);
        }
      }
      lastGroup = t.group;
      order.push(e);
    }
    order.forEach((node, i) => { if (hostMain.children[i] !== node) hostMain.insertBefore(node, hostMain.children[i] || null); });
    if (v && hostPins) pins.forEach((node, i) => { if (hostPins.children[i] !== node) hostPins.insertBefore(node, hostPins.children[i] || null); });
  }

  function makeChip(g) {
    const c = el('button', { class: 'group-chip' });
    c.addEventListener('click', () => nx.cmd('group.toggle', g.id));
    c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); nx.cmd('group.context', g.id); });
    return c;
  }
  function updateChip(c, g) {
    c.style.setProperty('--gcolor', GROUP_VAR[g.color] || GROUP_VAR.primary);
    c.classList.toggle('collapsed', !!g.collapsed);
    const n = S.tabs.filter((t) => t.group === g.id).length;
    c.textContent = (g.name || 'Group') + (g.collapsed ? ` · ${n}` : '');
    c.title = (g.collapsed ? 'Expand' : 'Collapse') + ' group';
  }

  function makeTab(t) {
    const e = el('div', { class: 'tab', draggable: 'true', 'data-id': t.id });
    e.addEventListener('mousedown', (ev) => {
      if (ev.button === 0) {
        if (ev.ctrlKey || ev.metaKey) { nx.cmd('tab.select', { id: t.id, mode: 'toggle' }); return; }
        if (ev.shiftKey) { nx.cmd('tab.select', { id: t.id, mode: 'range' }); return; }
        nx.cmd('tab.select', { id: t.id, mode: 'single' });
        nx.cmd('tab.activate', t.id);
      }
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

  const STAGE_NOTE = { frozen: ' (frozen)', suspended: ' (suspended)', discarded: ' (discarded)' };
  function updateTab(e, t) {
    e.classList.toggle('active', t.id === S.activeId);
    e.classList.toggle('selected', !!t.selected);
    e.classList.toggle('pinned', t.pinned);
    e.classList.toggle('sleeping', t.sleeping);
    e.classList.toggle('frozen', t.stage === 'frozen');
    e.classList.toggle('iso', t.iso);
    e.classList.toggle('temp', t.temp);
    e.hidden = !!t.hidden;
    if (t.group) { const g = S.groups.find((x) => x.id === t.group); e.dataset.group = t.group; if (g) e.style.setProperty('--gcolor', GROUP_VAR[g.color] || GROUP_VAR.primary); }
    else { delete e.dataset.group; e.style.removeProperty('--gcolor'); }
    e.title = (t.iso ? '[Isolated] ' : '') + (t.temp ? '[Temporary] ' : '') + t.title + (STAGE_NOTE[t.stage] || '');
    const sig = [t.favicon.length, t.url.slice(0, 40), t.loading, t.audible, t.muted, t.title, t.pinned].join('|');
    if (e._sig === sig) return;
    e._sig = sig;
    const kids = [favNode(t.url, t.favicon, t.loading)];
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
    if (S.private && !$('.private-badge')) $('#toolbar .grp:last-child').prepend(el('div', { class: 'private-badge' }, icon('mask', 14), 'private'));
    if (panel && panel.kind === 'shield') showPanel('shield', true);
  }

  function renderBookmarks() {
    const bar = $('#bmbar');
    if (!S.settings.bookmarksBar) return;
    bar.replaceChildren();
    if (!bookmarks.length) { bar.append(el('div', { class: 'bm-empty' }, 'Bookmarks you add appear here — press ' + (IS_MAC ? '⌘' : 'Ctrl+') + 'D on any page.')); return; }
    for (const b of bookmarks) {
      const item = el('button', { class: 'bm', title: b.title + '\n' + b.url }, favNode(b.url, ''), el('span', {}, b.title));
      item.addEventListener('click', () => nx.cmd('nav', { text: b.url }));
      item.addEventListener('auxclick', (ev) => { if (ev.button === 1) nx.cmd('nav', { text: b.url, newTab: true }); });
      item.addEventListener('contextmenu', (ev) => { ev.preventDefault(); showPanel('bmctx', false, { b, x: ev.clientX, y: ev.clientY }); });
      bar.append(item);
    }
  }

  // ---- overlay panels ------------------------------------------------------------------------------
  const overlay = $('#overlay'), panelEl = $('#panel');
  function openOverlay(dim) {
    if (overlay.hidden) nx.cmd('overlay', true);
    overlay.hidden = false;
    overlay.classList.toggle('dim', !!dim);
  }
  function closePanel() {
    if (!panel && overlay.hidden) return;
    panel = null;
    overlay.hidden = true;
    panelEl.replaceChildren();
    panelEl.removeAttribute('style');
    nx.cmd('overlay', false);
    if (document.activeElement === urlInput) urlInput.blur();
  }
  $('#backdrop').addEventListener('mousedown', () => closePanel());
  const place = (x, y, right) => {
    panelEl.style.left = panelEl.style.right = panelEl.style.top = '';
    if (right) panelEl.style.right = x + 'px'; else panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
  };

  const menuItem = (ic, label, kb, fn, cls) => el('div', { class: 'menu-item' + (cls ? ' ' + cls : ''), onclick: () => { closePanel(); fn(); } },
    ic ? icon(ic) : el('span', { style: 'width:17px' }), el('span', {}, label), kb ? el('span', { class: 'kb' }, kb) : null);
  const exec = (name, arg) => () => nx.cmd('exec', { name, arg });
  const row = (ic, label, n, cls) => el('div', { class: 'row' + (cls ? ' ' + cls : '') }, el('span', { class: 'ico' }, icon(ic)), el('span', {}, label), el('span', { class: 'num' }, String(n || 0)));
  const k = (s) => (IS_MAC ? '⌘' : 'Ctrl+') + s;

  function showPanel(kind, rerender, data) {
    if (!S) return;
    if (!rerender) { panel = { kind, data }; openOverlay(kind === 'palette'); }
    else if (!panel || panel.kind !== kind) return;
    panelEl.replaceChildren();
    panelEl.removeAttribute('style');
    const a = S.active;
    if (kind === 'menu') {
      const mb = $('#menu').getBoundingClientRect();
      place(Math.max(8, window.innerWidth - mb.right), mb.bottom + 6, true);
      panelEl.style.width = '300px';
      const f = S.features;
      panelEl.append(el('div', { class: 'menu-pad' },
        menuItem('plus', 'New tab', k('T'), exec('newTab')),
        menuItem('window', 'New window', k('N'), exec('newWindow')),
        menuItem('mask', 'New private window', k('⇧N'), exec('privateWindow')),
        menuItem('box', 'New isolated tab', k('⌥N'), exec('isolatedTab')),
        el('div', { class: 'menu-sep' }),
        menuItem('clock', 'History', k(IS_MAC ? 'Y' : 'H'), exec('openHistory')),
        menuItem('book', 'Bookmarks', k('⇧O'), exec('openBookmarks')),
        menuItem('download', 'Downloads', k('J'), exec('openDownloads')),
        f.workspaces ? menuItem('layers', 'Workspaces', '', exec('openWorkspaces')) : null,
        menuItem('puzzle', 'Extensions', '', exec('openExtensions')),
        el('div', { class: 'menu-sep' }),
        menuItem('find', 'Find in page', k('F'), exec('find')),
        menuItem('reader', 'Reader mode', k('⌥R'), exec('reader')),
        menuItem('print', 'Print…', k('P'), exec('print')),
        menuItem('camera', 'Take screenshot', k('⇧S'), exec('capture')),
        menuItem('code', 'Developer tools', 'F12', exec('devtools')),
        el('div', { class: 'menu-sep' }),
        menuItem('shield', 'Privacy dashboard', '', exec('openPrivacy')),
        menuItem('gauge', 'Performance center', '', exec('openPerformance')),
        f.vertical ? menuItem('sidebar', S.settings.verticalTabs ? 'Use horizontal tabs' : 'Use vertical tabs', k('⇧E'), exec('toggleVertical')) : null,
        f.palette ? menuItem('cmd', 'Command palette', k('⇧P'), exec('palette')) : null,
        menuItem('gear', 'Settings', k(','), exec('openSettings')),
        el('div', { class: 'menu-sep' }),
        menuItem('power', 'Quit Nevix', '', () => nx.cmd('quit')),
      ));
    } else if (kind === 'shield') {
      const anchor = $('#siteinfo').getBoundingClientRect();
      place(Math.max(8, anchor.left - 4), anchor.bottom + 8);
      panelEl.style.width = '350px';
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
          row('tag', 'Third-party cookies blocked', c.cookies), row('lock', 'Upgraded to HTTPS', c.upgrades));
        if (a.stage && a.stage !== 'active') panelEl.append(el('div', { class: 'row dim' }, 'Tab state: ' + a.stage));
        if (a.perms.length) {
          panelEl.append(el('div', { class: 'menu-sep' }), el('div', { class: 'row dim' }, 'Site permissions'),
            el('div', { class: 'row', style: 'flex-wrap:wrap;padding-top:0' }, a.perms.map((p) => el('span', { class: 'chip' }, p.label + ': ' + p.stored, el('button', { title: 'Reset', onclick: () => nx.cmd('perm.revoke', p.id) }, '×')))));
        }
        panelEl.append(el('div', { class: 'menu-sep' }), el('div', { class: 'menu-pad' },
          a.shieldsOff ? null : menuItem('clock', 'Allow trackers on this site for 30 minutes', '', () => nx.cmd('shield.temp', { minutes: 30 })),
          menuItem('shield', 'Privacy details for this site', '', exec('openPrivacy')),
          menuItem('reader', 'Reader mode', '', exec('reader')),
          menuItem('link', 'Copy clean link', k('⇧C'), exec('copyCleanUrl')),
          menuItem('trash', 'Reset permissions, cookies & data for this site', '', exec('clearSiteData'), 'danger')));
      } else {
        panelEl.append(el('div', { class: 'menu-pad' }, menuItem('gear', 'Privacy settings', '', exec('openSettings'))));
      }
    } else if (kind === 'downloads') {
      const anchor = $('#dl').getBoundingClientRect();
      place(Math.max(8, window.innerWidth - anchor.right - 8), anchor.bottom + 8, true);
      panelEl.style.width = '380px';
      panelEl.append(el('div', { class: 'panel-head' }, el('h3', {}, icon('download'), 'Downloads')));
      const list = downloads.slice(0, 6);
      if (!list.length) panelEl.append(el('div', { class: 'empty' }, 'No downloads yet'));
      for (const d of list) panelEl.append(dlRow(d));
      panelEl.append(el('div', { class: 'menu-sep' }), el('div', { class: 'menu-pad' }, menuItem('open', 'Open download manager', k('J'), exec('openDownloads'))));
    } else if (kind === 'bmctx') {
      const { b, x, y } = data;
      place(Math.min(x, window.innerWidth - 230), y + 4);
      panelEl.style.width = '220px';
      panelEl.append(el('div', { class: 'menu-pad' },
        menuItem('open', 'Open', '', () => nx.cmd('nav', { text: b.url })),
        menuItem('plus', 'Open in new tab', '', () => nx.cmd('nav', { text: b.url, newTab: true })),
        menuItem('trash', 'Remove bookmark', '', () => nx.cmd('bookmark.remove', b.id), 'danger')));
    } else if (kind === 'palette') { palette(); }
  }

  function dlRow(d) {
    const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0;
    const live = d.state === 'progressing';
    const status = live ? `${fmtBytes(d.received)}${d.total > 0 ? ' / ' + fmtBytes(d.total) : ''}${d.speed ? ' · ' + fmtBytes(d.speed) + '/s' : ''}${d.eta ? ' · ' + fmtEta(d.eta) : ''}` : d.state === 'completed' ? fmtBytes(d.total || d.received) : d.state;
    const btn = (label, action, cls = '') => el('button', { class: 'btn ' + cls, onclick: () => nx.cmd('download.action', { id: d.id, action }) }, label);
    return el('div', { class: 'dl-item' },
      el('div', { class: 'top' }, el('span', { class: 'name', title: d.name }, d.name), d.danger ? el('span', { class: 'chip', style: 'color:var(--color-danger-text)' }, d.danger.level) : null),
      el('div', { class: 'meta' }, d.domain + ' · ' + status),
      live || d.state === 'paused' || d.state === 'queued' ? el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })) : null,
      el('div', { class: 'top' },
        d.state === 'completed' ? [btn('Open', 'open'), btn('Show in folder', 'show')] : null,
        live ? [btn('Pause', 'pause'), btn('Cancel', 'cancel')] : null,
        d.state === 'paused' || d.state === 'queued' ? [btn('Resume', 'resume'), btn('Cancel', 'cancel')] : null,
        d.state === 'interrupted' || d.state === 'cancelled' ? btn('Retry', 'retry') : null));
  }

  // ---- command palette (commands come from the main-process registry) --------------------------------
  async function palette() {
    if (!S.features.palette) return closePanel();
    if (!commands) commands = await nx.cmd('commands.list');
    const wrap = el('div');
    panelEl.style.cssText = 'left:50%;top:14vh;transform:translateX(-50%);width:min(660px,92vw)';
    const input = el('input', { placeholder: 'Type a command, tab, bookmark or site…', spellcheck: 'false' });
    const list = el('div', { class: 'pal-list' });
    wrap.append(el('div', { class: 'pal-in' }, icon('cmd', 18), input), list);
    panelEl.append(wrap);
    let items = [], sel = 0, seq = 0, base = null;
    const draw = () => {
      list.replaceChildren();
      let group = '';
      items.forEach((it, i) => {
        if (it.group !== group) { group = it.group; list.append(el('div', { class: 'pal-group' }, group)); }
        const r = el('div', { class: 'pal-item' + (i === sel ? ' sel' : '') },
          it.tab && it.tab.favicon ? favNode(it.url, it.tab.favicon) : icon(it.icon), el('span', { class: 'grow' }, it.label, it.sub ? el('span', { class: 'dim' }, '  ' + it.sub) : null), it.kb ? el('span', { class: 'kb' }, it.kb) : null);
        r.addEventListener('mousemove', () => { if (sel !== i) { sel = i; draw(); } });
        r.addEventListener('click', () => run(it));
        list.append(r);
      });
      const s = list.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    };
    const run = async (it) => {
      if (it.pick) {
        const sub = await nx.cmd('commands.items', it.pick);
        input.value = ''; input.placeholder = it.label.replace(/…$/, '') + ' — type to filter';
        base = sub.map((x) => ({ group: it.label.replace(/…$/, ''), icon: 'check', label: x.label, sub: x.sub, run: () => nx.cmd('commands.pick', { id: it.id, arg: x.arg }) }));
        if (!base.length) base = [{ group: it.label.replace(/…$/, ''), icon: 'warn', label: 'Nothing here yet', run: () => {} }];
        compute();
        return;
      }
      closePanel(); it.run();
    };
    const score = (label, q) => { label = label.toLowerCase(); if (label.includes(q)) return 100 - label.indexOf(q); let i = 0; for (const ch of label) if (ch === q[i]) i++; return i === q.length ? 10 : 0; };
    const compute = async () => {
      const q = input.value.trim().toLowerCase();
      const my = ++seq;
      if (base) { items = base.filter((x) => !q || score(x.label + ' ' + (x.sub || ''), q)); sel = 0; draw(); return; }
      const out = [];
      const tabs = S.tabs.map((t) => ({ group: 'Open tabs', icon: 'globe', label: t.title || t.url, sub: hostOf(t.url), url: t.url, tab: t, run: () => nx.cmd('tab.activate', t.id), s: q ? score(t.title + ' ' + t.url, q) : 1 }));
      const cmds = commands.map((c) => ({ group: 'Commands', icon: c.danger ? 'trash' : 'cmd', id: c.id, pick: c.pick, label: c.title + (c.pick ? '…' : ''), kb: c.shortcuts[0] || '', run: () => nx.cmd('exec', { name: c.id }), s: q ? score(c.title + ' ' + c.category, q) : 1 }));
      const bms = bookmarks.map((b) => ({ group: 'Bookmarks', icon: 'star', label: b.title, sub: hostOf(b.url), run: () => nx.cmd('nav', { text: b.url }), s: q ? score(b.title + ' ' + b.url, q) : 0 }));
      out.push(...(q ? tabs.filter((x) => x.s) : tabs.slice(0, 4)), ...cmds.filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, q ? 9 : 14), ...bms.filter((x) => x.s).slice(0, 4));
      if (q) {
        const sug = await nx.cmd('suggest', q);
        if (my !== seq) return;
        for (const s of sug.filter((x) => x.type === 'history').slice(0, 4)) out.push({ group: 'History', icon: 'clock', label: s.title, sub: hostOf(s.url), run: () => nx.cmd('nav', { text: s.url }) });
        for (const s of sug.filter((x) => x.type === 'calc' || x.type === 'convert').slice(0, 1)) out.unshift({ group: 'Answer', icon: 'calc', label: s.title, sub: s.sub + ' — Enter copies', run: () => nx.cmd('exec', { name: 'copyText', arg: s.value }) });
        const se = sug.find((x) => x.type === 'search');
        out.push({ group: 'Web', icon: 'search', label: se ? se.title : q, run: () => nx.cmd('nav', { text: q, newTab: true }) });
      }
      items = out; sel = 0; draw();
    };
    input.addEventListener('input', compute);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[sel]) run(items[sel]);
      else if (e.key === 'Escape') {
        if (base) { base = null; input.value = ''; input.placeholder = 'Type a command, tab, bookmark or site…'; compute(); e.stopPropagation(); }
        else closePanel();
      } else if (e.key === 'Backspace' && base && !input.value) { base = null; compute(); }
    });
    compute();
    setTimeout(() => input.focus(), 20);
  }

  // ---- omnibox -------------------------------------------------------------------------------------
  let sugs = [], sugSel = -1, sugSeq = 0, typed = '';
  const sugIcon = { search: 'search', url: 'globe', history: 'clock', bookmark: 'star', tab: 'window', calc: 'calc', convert: 'swap', command: 'cmd', workspace: 'layers', setting: 'gear' };
  const sugTag = { tab: 'Switch to tab', bookmark: 'Bookmark', command: 'Command', workspace: 'Workspace', setting: 'Setting', calc: 'Enter to copy', convert: 'Enter to copy' };
  const NAV_TYPES = new Set(['url', 'history', 'bookmark', 'tab']);
  function drawSuggestions() {
    if (!sugs.length) { if (panel && panel.kind === 'sug') closePanelKeepFocus(); return; }
    if (!panel || panel.kind !== 'sug') { panel = { kind: 'sug' }; openOverlay(false); }
    const r = $('#omni').getBoundingClientRect();
    panelEl.style.cssText = `left:${r.left}px;top:${r.bottom + 6}px;width:${r.width}px`;
    panelEl.replaceChildren(el('div', { class: 'menu-pad' }, sugs.map((s, i) => {
      const answer = s.type === 'calc' || s.type === 'convert';
      const row = el('div', { class: 'sug' + (i === sugSel ? ' sel' : '') },
        el('span', { class: 's-ico' }, s.type === 'history' || s.type === 'bookmark' ? favNode(s.url, '') : icon(sugIcon[s.type] || 'globe')),
        el('span', { class: 's-main' }, answer ? el('span', { class: 's-calc' }, s.title) : s.title,
          answer || s.sub ? el('span', { class: 's-url' }, s.sub) : (s.type !== 'search' && s.url && s.title !== s.url ? el('span', { class: 's-url' }, s.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)) : null)),
        sugTag[s.type] ? el('span', { class: 's-tag' }, sugTag[s.type]) : null);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); chooseSuggestion(s, e.altKey); });
      return row;
    })));
  }
  function closePanelKeepFocus() { panel = null; overlay.hidden = true; panelEl.replaceChildren(); panelEl.removeAttribute('style'); nx.cmd('overlay', false); }
  function chooseSuggestion(s, newTab) {
    closePanelKeepFocus();
    urlInput.blur();
    switch (s.type) {
      case 'tab': return nx.cmd('exec', { name: 'switchTab', arg: { win: s.winId, tab: s.tabId } });
      case 'calc': case 'convert': return nx.cmd('exec', { name: 'copyText', arg: s.value });
      case 'command': return s.pick ? nx.cmd('exec', { name: 'palette' }) : nx.cmd('exec', { name: s.cmd });
      case 'workspace': return nx.cmd('commands.pick', { id: 'restoreWorkspace', arg: s.arg });
      default: return nx.cmd('nav', { text: s.url, newTab });
    }
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
    const setVal = (s) => { urlInput.value = NAV_TYPES.has(s.type) && s.url ? s.url : typed; };
    if (e.key === 'ArrowDown' && sugs.length) { sugSel = (sugSel + 1) % sugs.length; setVal(sugs[sugSel]); drawSuggestions(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && sugs.length) { sugSel = (sugSel - 1 + sugs.length) % sugs.length; setVal(sugs[sugSel]); drawSuggestions(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const s = sugs[sugSel];
      if (s && ['calc', 'convert', 'command', 'workspace'].includes(s.type)) return chooseSuggestion(s, false);
      if (s && s.type === 'tab' && (sugSel > 0 || urlInput.value === s.url)) return chooseSuggestion(s, false);
      const text = s && s.type === 'setting' ? s.url : urlInput.value;
      closePanelKeepFocus(); urlInput.blur();
      nx.cmd('nav', { text, newTab: e.altKey });
    } else if (e.key === 'Escape') { urlInput.value = S && S.active ? S.active.url : ''; closePanelKeepFocus(); urlInput.blur(); }
  });
  $('#omni').addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; if (document.activeElement !== urlInput) { e.preventDefault(); urlInput.focus(); urlInput.select(); } });

  // ---- infobar: find / permission / text prompt ----------------------------------------------------
  const infobar = $('#infobar');
  let barKind = null;
  function openBar(kind) { barKind = kind; infobar.hidden = false; infobar.classList.toggle('danger', kind === 'perm'); }
  function closeBar(kind) { if (barKind === kind) { barKind = null; infobar.hidden = true; infobar.replaceChildren(); infobar.classList.remove('danger'); } }

  function openFind() {
    findOpen = true;
    openBar('find');
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
  function closeFind() { findOpen = false; closeBar('find'); nx.cmd('find.close'); }

  let permShown = null;
  function showPermission(p) {
    if (!p) { permShown = null; closeBar('perm'); return; }
    permShown = p; findOpen = false;
    openBar('perm');
    const ans = (mode) => nx.cmd('perm.answer', { id: p.id, mode });
    infobar.replaceChildren(icon('warn'), el('span', {}, el('b', {}, p.origin.host || 'This page'), ' wants to ' + p.origin.label),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn primary', onclick: () => ans('always') }, 'Allow'), el('button', { class: 'btn', onclick: () => ans('once') }, 'Allow once'),
      el('button', { class: 'btn danger', onclick: () => ans('block') }, 'Block'), el('button', { class: 'ib', title: 'Dismiss', onclick: () => ans('dismiss') }, icon('x')));
  }

  function showPrompt(p) {
    openBar('prompt');
    const input = el('input', { type: 'text', value: p.value, placeholder: p.label, spellcheck: 'false' });
    const done = (v) => { closeBar('prompt'); nx.cmd('prompt.answer', { id: p.id, value: v }); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); });
    infobar.replaceChildren(el('b', {}, p.title), input, el('span', { class: 'grow' }), el('button', { class: 'btn primary', onclick: () => done(input.value) }, 'Save'), el('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'));
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  // ---- wiring --------------------------------------------------------------------------------------
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
  nx.on('downloads', (d) => { downloads = d; $('#dl').classList.toggle('active-dl', d.some((x) => x.state === 'progressing')); if (panel && panel.kind === 'downloads') showPanel('downloads', true); });
  nx.on('download-started', () => { if (!panel) $('#dl-dot').hidden = false; });
  nx.on('toast', (msg) => {
    const t = $('#toast'); const m = typeof msg === 'string' ? { text: msg } : msg;
    t.textContent = m.text; t.classList.toggle('danger', !!m.danger); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  });
  nx.on('focus-omnibox', () => { urlInput.focus(); urlInput.select(); });
  nx.on('open-find', () => { if (findOpen && infobar._find && barKind === 'find') { infobar._find.input.focus(); infobar._find.input.select(); } else openFind(); });
  nx.on('find', (r) => { const c = $('#find-count'); if (c) c.textContent = r.matches ? `${r.active}/${r.matches}` : (infobar._find && infobar._find.input.value ? 'No results' : ''); });
  nx.on('find-next', (d) => { if (findOpen && infobar._find) infobar._find.go(d.forward, true); });
  nx.on('palette', () => showPanel('palette'));
  nx.on('permission', showPermission);
  nx.on('prompt', showPrompt);
  nx.on('escape', () => { if (panel) closePanel(); else if (barKind === 'find') closeFind(); else if (permShown) nx.cmd('perm.answer', { id: permShown.id, mode: 'dismiss' }); });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (panel) { closePanel(); e.preventDefault(); } else if (barKind === 'find') { closeFind(); e.preventDefault(); } }
  });
  window.addEventListener('resize', () => { if (panel && panel.kind === 'sug') drawSuggestions(); });

  Promise.all([nx.cmd('state'), nx.cmd('bookmarks'), nx.cmd('downloads')]).then(([s, b, d]) => { bookmarks = b; downloads = d; if (s) render(s); });
  window.__nxdebug = { get state() { return S; }, showPanel, closePanel, openFind };
})();
