'use strict';
(() => {
  const { $, el, call, bytes, toast, header } = NX;
  const root = $('#root');
  let tabs = [], sel = '', rec = false, entries = [], summary = null, q = '', only = 'all', open = null;

  async function load() {
    tabs = await call('diag:tabs');
    if (!sel && tabs.length) sel = `${(tabs.find((t) => t.active) || tabs[0]).win}:${(tabs.find((t) => t.active) || tabs[0]).id}`;
    render();
  }

  async function refresh() { entries = await call('diag:entries'); render(); }
  window.nevix.on('diag-event', (s) => { summary = s; refresh(); });

  const stat = (v, l) => el('div', { class: 'stat' }, el('b', {}, v), el('span', {}, l));
  const kv = (obj) => Object.entries(obj || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';

  function render() {
    const picker = el('select', { onchange: (e) => { sel = e.target.value; } }, tabs.map((t) => el('option', { value: `${t.win}:${t.id}`, selected: sel === `${t.win}:${t.id}` }, `${t.title.slice(0, 50)}${t.host ? ' — ' + t.host : ''}`)));
    const btn = el('button', { class: 'btn ' + (rec ? 'danger' : 'primary') }, rec ? 'Stop recording' : 'Record this tab');
    btn.onclick = async () => {
      if (rec) { await call('diag:stop'); rec = false; render(); return; }
      const [win, tab] = sel.split(':').map(Number);
      const r = await call('diag:start', { win, tab });
      if (r.error) return toast(r.error, true);
      rec = true; entries = []; summary = { dns: r.dns, total: 0, protocols: {}, cache: {}, blocked: 0, modified: 0 }; render(); toast('Recording — reload the tab to capture its requests');
    };
    const list = entries.filter((e) => (!q || e.url.toLowerCase().includes(q.toLowerCase())) && (only === 'all' || (only === 'blocked' && /blocked/.test(e.error)) || (only === 'modified' && e.mods && e.mods.length) || (only === 'failed' && e.error)));
    const search = el('input', { type: 'search', placeholder: 'Filter URLs', value: q });
    search.addEventListener('input', () => { q = search.value; render(); const s = $('input[type=search]'); s.focus(); s.setSelectionRange(q.length, q.length); });
    root.replaceChildren(
      ...header('nevix://diagnostics', 'What the engine actually did for one tab: the HTTP protocol, TLS details, cache behaviour and remote address of each request, together with every change Nevix itself made. Recording is opt-in per tab and stays in this window. For the full developer tools (Elements, Console, Network, Sources, Application, Performance, Memory, Security…) press F12.'),
      el('div', { class: 'toolbar' }, picker, el('button', { class: 'btn', onclick: load }, 'Refresh tabs'), btn, el('button', { class: 'btn', onclick: async () => { await call('diag:clear'); entries = []; render(); } }, 'Clear')),
      summary ? el('div', { class: 'cards' }, stat(summary.total, 'requests'), stat(summary.blocked, 'blocked by nevix'), stat(summary.modified, 'modified by nevix'), stat(kv(summary.protocols), 'protocols'), stat(kv(summary.cache), 'cache behaviour')) : null,
      summary ? el('div', { class: 'notice' }, el('b', {}, 'DNS method: '), summary.dns) : null,
      el('div', { class: 'toolbar' }, search, ['all', 'blocked', 'modified', 'failed'].map((o) => el('button', { class: 'btn sm' + (only === o ? ' primary' : ''), onclick: () => { only = o; render(); } }, o))),
      list.length ? el('div', { class: 'tablewrap' }, el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, ['Method', 'Status', 'Type', 'Protocol', 'Cache', 'Remote', 'Size', 'Time', 'URL'].map((h) => el('th', { class: ['Size', 'Time', 'Status'].includes(h) ? 'num' : '' }, h)))),
        el('tbody', {}, list.slice().reverse().slice(0, 400).map((e) => [
          el('tr', { style: 'cursor:pointer', onclick: () => { open = open === e.id ? null : e.id; render(); } },
            el('td', { class: 'mono' }, e.method), el('td', { class: 'num' }, e.error ? el('span', { class: 'danger-text' }, e.error.startsWith('blocked') ? 'blocked' : 'failed') : e.status || '…'), el('td', {}, e.type), el('td', {}, e.protocol ? el('span', { class: 'badge ' + (e.protocol === 'h3' ? 'primary' : '') }, e.protocol) : ''), el('td', { class: 'dim' }, e.cache), el('td', { class: 'mono dim' }, e.ip),
            el('td', { class: 'num' }, e.size ? bytes(e.size) : ''), el('td', { class: 'num' }, e.ms ? e.ms + ' ms' : ''), el('td', { class: 'mono', style: 'max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: e.url }, (e.mods && e.mods.length ? '◆ ' : '') + e.url)),
          open === e.id ? el('tr', {}, el('td', { colspan: 9, style: 'background:var(--color-background)' }, detail(e))) : null])))) :
        el('div', { class: 'empty' }, rec ? 'Waiting for requests… reload the page you are recording.' : 'Pick a tab and start recording.'));
  }

  function detail(e) {
    const line = (k, v) => v ? el('div', { class: 'row', style: 'padding:2px 0;align-items:flex-start' }, el('span', { class: 'dim', style: 'width:150px;flex:none' }, k), el('span', { class: 'mono', style: 'word-break:break-all' }, v)) : null;
    return el('div', { style: 'padding:6px 4px' },
      line('URL', e.url), line('Redirected to', e.redirectTo), line('Content type', e.mime), line('Cache-Control', e.cacheControl), line('Cache behaviour', e.cache),
      e.tls ? [line('TLS', `${e.tls.protocol} · ${e.tls.cipher}${e.tls.keyExchange ? ' · ' + e.tls.keyExchange : ''}`), line('Certificate', `${e.tls.subject} — issued by ${e.tls.issuer}`), line('Valid', `${new Date(e.tls.validFrom).toLocaleDateString()} → ${new Date(e.tls.validTo).toLocaleDateString()}`), line('Certificate Transparency', e.tls.ct)] : null,
      e.mods && e.mods.length ? el('div', { style: 'margin-top:6px' }, el('b', {}, 'What Nevix changed'), e.mods.map((m) => el('div', { class: 'mono', style: 'padding:2px 0' }, '◆ ' + m))) : el('div', { class: 'dim', style: 'margin-top:6px' }, 'Nevix made no changes to this request.'));
  }
  load();
})();
