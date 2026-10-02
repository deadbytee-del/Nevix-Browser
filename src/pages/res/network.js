'use strict';
(() => {
  const { $, el, call, num, toast, header, confirmDialog, ago } = NX;
  const root = $('#root');
  let tab = (location.hash || '#lists').slice(1), data;
  const TABS = [['lists', 'Filter lists'], ['rules', 'Your rules'], ['sites', 'Per-site'], ['tester', 'Rule tester'], ['monitor', 'Live monitor']];

  async function render() {
    data = await call('network:overview');
    const body = el('div');
    root.replaceChildren(...header('nevix://network', 'Filtering rules are compiled into an indexed engine, so even very large lists cost a few lookups per request. Nothing is uploaded; optional lists are downloaded only when you enable them.'),
      el('div', { class: 'tabsnav' }, TABS.map(([id, label]) => el('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; history.replaceState(null, '', '#' + id); render(); } }, label))), body);
    await ({ lists, rules, sites, tester, monitor }[tab] || lists)(body);
  }

  // ---- lists ------------------------------------------------------------------------------------------
  async function lists(b) {
    const s = await call('settings:schema');
    b.append(el('div', { class: 'cards' }, stat(data.total, 'active rules'), stat(data.lists.length, 'lists loaded'), stat(data.doh === 'off' ? 'off' : data.doh, 'secure dns'), stat(data.httpsOnly ? 'on' : 'off', 'https-only')),
      el('div', { class: 'tablewrap' }, el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'List'), el('th', { class: 'num' }, 'Rules'), el('th', {}, 'Source'))),
        el('tbody', {}, data.lists.map((l) => el('tr', {}, el('td', {}, l.name), el('td', { class: 'num' }, num(l.count)), el('td', { class: 'dim' }, l.id === 'nevix-core' ? 'bundled' : l.id === 'pgl' ? 'bundled (Peter Lowe’s list)' : l.id === 'custom' ? 'you' : 'downloaded')))))),
      el('h3', { style: 'margin:22px 0 8px' }, 'Optional lists'),
      el('p', { class: 'dim', style: 'margin-bottom:10px' }, 'Larger community lists for broader coverage. Enabling one downloads it once from its publisher and refreshes it weekly; disable it to stop.'),
      el('div', { class: 'list' }, data.filterLists.map((def) => {
        const st = data.enabled.find((l) => l.id === def.id) || { enabled: false, updated: 0 };
        const sw = el('button', { class: 'switch' + (st.enabled ? ' on' : ''), role: 'switch', 'aria-label': def.name });
        sw.onclick = async () => {
          const next = data.enabled.map((l) => (l.id === def.id ? { ...l, enabled: !l.enabled } : l));
          await call('settings:set', { key: 'privacy.lists', value: next });
          if (next.find((l) => l.id === def.id).enabled) { toast('Downloading…'); const r = await call('lists:update'); toast(r.every((x) => x.ok) ? 'List updated' : 'Download failed — check your connection', !r.every((x) => x.ok)); }
          render();
        };
        return el('div', { class: 'item' }, el('div', { class: 'main' }, el('div', { class: 't' }, def.name), el('div', { class: 'u' }, def.url.replace(/^https:\/\//, ''), st.updated ? ` · updated ${ago(st.updated)}` : '')), sw);
      })),
      el('div', { class: 'toolbar' }, el('button', { class: 'btn', onclick: async () => { toast('Updating…'); const r = await call('lists:update'); toast(r.length ? (r.every((x) => x.ok) ? 'Lists updated' : 'Some lists failed') : 'No optional lists enabled', r.some((x) => !x.ok)); render(); } }, 'Update enabled lists now')));
    void s;
  }
  const stat = (n, l) => el('div', { class: 'stat' }, el('b', {}, typeof n === 'number' ? num(n) : n), el('span', {}, l));

  // ---- custom rules -------------------------------------------------------------------------------------
  async function rules(b) {
    const text = await call('network:customGet');
    const ta = el('textarea', { rows: 14, spellcheck: 'false', placeholder: '||ads.example.com^\nisolate ||widgets.example.net^\nallow ||cdn.example.org^$domain=mysite.com' }, text);
    ta.value = text;
    b.append(el('div', { class: 'notice' }, 'One rule per line. ', el('code', {}, '||host^'), ' blocks a host and its subdomains; ', el('code', {}, '||host/path'), ' blocks a path; ', el('code', {}, 'allow'), ' / ', el('code', {}, 'isolate'), ' / ', el('code', {}, 'block'), ' prefixes choose the action (', el('b', {}, 'isolate'), ' lets the request through without cookies or referrer). Options: ', el('code', {}, '$third-party'), ' ', el('code', {}, '$script,image,xmlhttprequest…'), ' ', el('code', {}, '$domain=site.com|~other.com'), '. Lines starting with ! are comments. Your rules apply to first-party requests too and override the built-in lists.'),
      ta, el('div', { class: 'toolbar' },
        el('button', { class: 'btn primary', onclick: async () => { const n = await call('network:customSet', { text: ta.value }); toast(`Saved — ${num(n)} rules active`); } }, 'Save rules'),
        el('button', { class: 'btn', onclick: async () => { const n = await call('network:customImport'); if (n !== null) { toast(`Imported — ${num(n)} rules`); render(); } } }, 'Import…'),
        el('button', { class: 'btn', onclick: async () => { if (await call('network:customExport')) toast('Exported'); } }, 'Export…')));
  }

  // ---- per-site -------------------------------------------------------------------------------------------
  async function sites(b) {
    const input = el('input', { type: 'text', placeholder: 'example.com', style: 'max-width:260px' });
    b.append(el('div', { class: 'toolbar' }, input, el('button', { class: 'btn', onclick: async () => { const v = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return toast('Enter a domain like example.com', true); await call('privacy:shields', { site: v, off: true }); render(); } }, 'Turn shields off for this site')),
      el('h3', { style: 'margin:10px 0 8px' }, 'Shields permanently off'),
      data.shieldsOff.length ? el('div', { class: 'list' }, data.shieldsOff.map((s) => el('div', { class: 'item' }, el('div', { class: 'main t' }, s), el('button', { class: 'btn sm', onclick: async () => { await call('privacy:shields', { site: s, off: false }); render(); } }, 'Turn back on')))) : el('div', { class: 'empty' }, 'None — shields are up everywhere.'),
      el('h3', { style: 'margin:22px 0 8px' }, 'Temporarily allowed'),
      data.temp.length ? el('div', { class: 'list' }, data.temp.map((t) => el('div', { class: 'item' }, el('div', { class: 'main t' }, t.site), el('span', { class: 'when' }, Math.max(1, Math.round((t.until - Date.now()) / 60000)) + ' min left'), el('button', { class: 'btn sm', onclick: async () => { await call('privacy:shields', { site: t.site, off: false }); render(); } }, 'End now')))) : el('div', { class: 'empty' }, 'No temporary exceptions. Use “Allow trackers on this site for 30 minutes” from the shield menu.'));
  }

  // ---- tester ---------------------------------------------------------------------------------------------
  async function tester(b) {
    const url = el('input', { type: 'text', placeholder: 'https://tracker.example.com/pixel.gif', style: 'flex:2' });
    const top = el('input', { type: 'text', placeholder: 'page you are on, e.g. news.example.org', style: 'flex:1' });
    const type = el('select', {}, ['script', 'image', 'xhr', 'subFrame', 'stylesheet', 'font', 'media', 'ping', 'other'].map((t) => el('option', { value: t }, t)));
    const out = el('div');
    const go = async () => {
      const r = await call('network:test', { url: url.value.trim(), top: top.value.trim(), type: type.value });
      out.replaceChildren(r.error ? el('div', { class: 'notice danger' }, r.error) : el('div', { class: 'card' }, el('h3', { style: 'margin-bottom:6px' }, r.action === 'block' ? el('span', { class: 'danger-text' }, 'Blocked') : r.action === 'isolate' ? el('span', { class: 'warn-text' }, 'Isolated') : r.action === 'allow' ? el('span', { class: 'ok-text' }, 'Allowed by an exception') : 'No rule matches'),
        r.rule ? el('div', { class: 'mono' }, r.rule) : el('div', { class: 'dim' }, r.note || ''), r.list ? el('div', { class: 'dim', style: 'margin-top:4px' }, `List: ${r.list} · category: ${r.category}`) : null));
    };
    [url, top].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }));
    b.append(el('p', { class: 'dim', style: 'margin-bottom:10px' }, 'Check what the engine would do with a request. Bundled lists only act on third-party requests, so enter the page you would be visiting.'), el('div', { class: 'toolbar' }, url, top, type, el('button', { class: 'btn primary', onclick: go }, 'Test')), out);
  }

  // ---- live monitor ---------------------------------------------------------------------------------------
  async function monitor(b) {
    let on = false, onlyBlocked = false;
    const rows = [];
    const tbody = el('tbody');
    const info = el('div', { class: 'dim' }, 'Not recording. Events are streamed only while this tab is open and recording.');
    const draw = () => { tbody.replaceChildren(...rows.filter((r) => !onlyBlocked || r.kind === 'blocked' || r.kind === 'isolate').slice(0, 300).map((r) => el('tr', {}, el('td', { class: 'dim' }, new Date(r.t).toLocaleTimeString()), el('td', {}, el('span', { class: 'badge ' + (r.kind === 'blocked' ? 'danger' : r.kind === 'isolate' ? 'warn' : r.kind === 'headers' ? 'primary' : '') }, r.kind)), el('td', { class: 'mono', style: 'max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.url), el('td', { class: 'dim' }, r.kind === 'headers' ? r.mods.join('; ') : r.rule ? r.rule : (r.type || ''))))); };
    window.nevix.on('net-event', (batch) => { if (!on) return; for (const e of batch) rows.unshift(e); if (rows.length > 600) rows.length = 600; draw(); });
    const btn = el('button', { class: 'btn primary' }, 'Start recording');
    btn.onclick = async () => { on = !on; await call(on ? 'net:subscribe' : 'net:unsubscribe'); btn.textContent = on ? 'Stop recording' : 'Start recording'; btn.className = 'btn ' + (on ? 'danger' : 'primary'); info.textContent = on ? 'Recording requests from every tab…' : 'Stopped.'; };
    window.addEventListener('beforeunload', () => { if (on) call('net:unsubscribe'); });
    b.append(el('div', { class: 'toolbar' }, btn, el('label', { class: 'row dim' }, el('input', { type: 'checkbox', onchange: (e) => { onlyBlocked = e.target.checked; draw(); } }), 'Only blocked / isolated'), el('button', { class: 'btn', onclick: () => { rows.length = 0; draw(); } }, 'Clear'), el('span', { class: 'spacer' }), info),
      el('div', { class: 'tablewrap' }, el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Event'), el('th', {}, 'URL'), el('th', {}, 'Detail'))), tbody)));
  }

  render();
  window.nevix.onChange((t) => { if (t === 'network' && tab === 'rules') return; if (t === 'settings' || t === 'network') render(); });
})();
