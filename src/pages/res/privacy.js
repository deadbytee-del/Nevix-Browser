'use strict';
(() => {
  const { $, el, call, num, ago, toast, header, confirmDialog } = NX;
  const root = $('#root');
  let summary, sort = 'seen', desc = true, q = '', site = decodeURIComponent((location.hash.match(/site=([^&]+)/) || [])[1] || '');

  const EXPLAIN = {
    ads: 'a known advertising network',
    trackers: 'a known tracking or analytics service',
    fingerprinting: 'a script used to fingerprint browsers',
    custom: 'one of your own rules',
  };
  const why = (b, siteName) => `Nevix stopped this ${b.type || 'request'} because it went to a different site (${b.host}) than the page you were on (${siteName}), and it matched the rule “${b.rule}” from ${b.list}, which lists ${EXPLAIN[b.category] || 'a blocked service'}. Blocking happens before any data is sent, so ${b.host} never learned you visited ${siteName}.`;

  async function loadSummary() { summary = await call('privacy:summary'); site ? await detail() : overview(); }

  // ---- overview --------------------------------------------------------------------------------------
  function overview() {
    const t = summary.totals;
    const rows = summary.sites.filter((s) => !q || s.site.includes(q.toLowerCase()));
    rows.sort((a, b) => { const x = a[sort], y = b[sort]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * (desc ? -1 : 1); });
    const th = (key, label, cls = '') => el('th', { class: 'sortable ' + cls, onclick: () => { if (sort === key) desc = !desc; else { sort = key; desc = true; } overview(); } }, label + (sort === key ? (desc ? ' ↓' : ' ↑') : ''));
    const search = el('input', { type: 'search', placeholder: 'Filter sites', value: q });
    search.addEventListener('input', () => { q = search.value; overview(); const s = $('input[type=search]'); s.focus(); s.setSelectionRange(q.length, q.length); });
    root.replaceChildren(
      ...header('nevix://privacy', 'What Nevix blocked or isolated, per website, since this session began. This list lives only in memory — closing Nevix erases it.',
        el('button', { class: 'btn', onclick: async () => { if (await confirmDialog('Clear this list?', 'Only the dashboard record is cleared — nothing else changes.', { ok: 'Clear' })) { await call('privacy:clear', {}); loadSummary(); } } }, 'Clear list')),
      el('div', { class: 'cards' },
        stat(t.trackers, 'trackers blocked (lifetime)'), stat(t.ads, 'ads blocked (lifetime)'), stat(t.upgrades, 'https upgrades'), stat(t.params, 'tracking links cleaned'), stat(t.bounces || 0, 'bounce trackers purged')),
      summary.temp.length ? el('div', { class: 'notice warn' }, 'Shields are temporarily off for: ', summary.temp.map((x) => `${x.site} (${Math.max(1, Math.round((x.until - Date.now()) / 60000))} min left)`).join(', ')) : null,
      el('div', { class: 'toolbar' }, search),
      rows.length ? el('div', { class: 'tablewrap' }, el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, th('site', 'Website'), th('trackers', 'Trackers', 'num'), th('ads', 'Ads', 'num'), th('isolated', 'Third parties isolated', 'num'), th('cookiesBlocked', 'Cookies blocked', 'num'), th('first', 'First-party req.', 'num'), th('third', 'Third-party req.', 'num'), th('seen', 'Last seen'))),
        el('tbody', {}, rows.map((s) => el('tr', { style: 'cursor:pointer', onclick: () => open(s.site) },
          el('td', {}, el('b', {}, s.site), summary.shieldsOff.includes(s.site) ? el('span', { class: 'badge danger', style: 'margin-left:8px' }, 'shields off') : null),
          el('td', { class: 'num' }, num(s.trackers)), el('td', { class: 'num' }, num(s.ads)), el('td', { class: 'num' }, num(s.isolated)), el('td', { class: 'num' }, num(s.cookiesBlocked)), el('td', { class: 'num' }, num(s.first)), el('td', { class: 'num' }, num(s.third)), el('td', { class: 'dim' }, ago(s.seen))))))) :
        el('div', { class: 'empty' }, q ? 'No matching sites.' : 'Nothing recorded yet. Browse a few pages and come back.'));
  }
  const stat = (n, l) => el('div', { class: 'stat' }, el('b', {}, num(n)), el('span', {}, l));
  const open = (s) => { site = s; history.replaceState(null, '', '#site=' + encodeURIComponent(s)); detail(); };

  // ---- one site --------------------------------------------------------------------------------------
  async function detail() {
    const d = await call('privacy:detail', { site });
    const back = el('button', { class: 'btn', onclick: () => { site = ''; history.replaceState(null, '', '#'); loadSummary(); } }, '← All sites');
    const line = (label, n, note) => el('div', { class: 'row', style: 'justify-content:space-between;padding:4px 0' }, el('span', {}, label), el('span', { class: 'mono' }, note || n));
    root.replaceChildren(
      ...header(d.site, 'Privacy protection for this site', back),
      el('div', { class: 'cards' }, stat(d.trackers + d.fingerprinting + d.custom, 'trackers blocked'), stat(d.ads, 'ads blocked'), stat(d.isolated + d.cookiesBlocked, 'third parties isolated'), stat(d.cookies, 'cookies stored'), stat(d.permissions.length, 'permissions saved')),
      el('div', { class: 'row', style: 'gap:10px;margin-bottom:18px' },
        el('button', { class: 'btn' + (d.shieldsOff ? ' primary' : ''), onclick: async () => { await call('privacy:shields', { site, off: !d.shieldsOff }); toast(d.shieldsOff ? 'Shields on' : 'Shields off for ' + site, !d.shieldsOff); detail(); } }, d.shieldsOff ? 'Turn shields back on' : 'Turn shields off for this site'),
        d.shieldsOff ? null : el('button', { class: 'btn', onclick: async () => { await call('privacy:allowTemp', { site, minutes: 30 }); toast('Shields paused for 30 minutes'); } }, 'Pause for 30 min'),
        el('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog(`Forget ${site}?`, 'Removes its saved permissions, cookies, storage and cached files.', { danger: true, ok: 'Forget site' })) { await call('perm:resetSite', { origin: 'https://' + site }); await call('perm:resetSite', { origin: 'https://www.' + site }); toast('Site data cleared'); detail(); } } }, 'Forget this site…')),
      el('h3', { style: 'margin:18px 0 8px' }, 'Active protections'),
      el('div', { class: 'card', style: 'columns:2;column-gap:32px' }, Object.entries(d.protections).map(([k, v]) => el('div', { style: 'break-inside:avoid;padding:3px 0' }, el('span', { class: v ? 'ok-text' : 'dim' }, v ? '● ' : '○ '), k))),
      el('h3', { style: 'margin:22px 0 8px' }, 'Connections'),
      el('div', { class: 'card' }, line('First-party requests', d.first), line('Third-party requests', d.third), line('Distinct hosts contacted', d.hosts.length), line('Unencrypted (HTTP) requests', d.insecure), line('Upgraded to HTTPS', d.upgrades), line('Tracking parameters removed', d.params), line('Bounce trackers purged', d.bounces)),
      d.hosts.length ? el('div', { class: 'tablewrap', style: 'margin-top:12px;max-height:280px' }, el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'Host'), el('th', {}, 'Party'), el('th', { class: 'num' }, 'Requests'), el('th', { class: 'num' }, 'Blocked'))),
        el('tbody', {}, d.hosts.map((h) => el('tr', {}, el('td', { class: 'mono' }, h.host), el('td', {}, el('span', { class: 'badge' + (h.third ? '' : ' ok') }, h.third ? 'third' : 'first')), el('td', { class: 'num' }, h.n), el('td', { class: 'num' }, h.blocked ? el('span', { class: 'danger-text' }, h.blocked) : 0)))))) : null,
      d.permissions.length ? [el('h3', { style: 'margin:22px 0 8px' }, 'Permissions'), el('div', { class: 'list' }, d.permissions.map((p) => el('div', { class: 'item' }, el('div', { class: 'main' }, el('div', { class: 't' }, p.label), el('div', { class: 'u' }, p.origin)), el('span', { class: 'badge ' + (p.state === 'allow' ? 'ok' : p.state === 'block' ? 'danger' : '') }, p.state), el('button', { class: 'btn sm', onclick: async () => { await call('perm:set', { origin: p.origin, perm: p.id, state: 'default' }); detail(); } }, 'Reset'))))] : null,
      el('h3', { style: 'margin:22px 0 8px' }, `Blocked requests (${d.blocked.length}${d.blocked.length >= 120 ? '+' : ''})`),
      d.blocked.length ? el('div', { class: 'list' }, d.blocked.map((b) => {
        const more = el('div', { class: 'notice', style: 'display:none;margin:8px 0 0' }, why(b, d.site));
        return el('div', { class: 'item', style: 'flex-wrap:wrap' },
          el('span', { class: 'badge ' + (b.category === 'ads' ? 'warn' : 'danger') }, b.category), el('div', { class: 'main' }, el('div', { class: 't mono', style: 'font-weight:500' }, b.host), el('div', { class: 'u' }, b.url)),
          el('span', { class: 'when' }, b.type), el('span', { class: 'when' }, ago(b.time)),
          el('button', { class: 'btn sm', onclick: () => { more.style.display = more.style.display === 'none' ? 'block' : 'none'; } }, 'Why?'),
          el('button', { class: 'btn sm', title: 'Add a rule that allows this host on this site only', onclick: async () => { await call('privacy:rule', { line: `@@||${b.host}^$domain=${d.site}` }); toast(`Allowed ${b.host} on ${d.site}`); } }, 'Allow here'),
          el('div', { style: 'flex-basis:100%' }, more));
      })) : el('div', { class: 'empty' }, 'Nothing blocked on this site in this session.'));
  }

  loadSummary();
  window.nevix.onChange((t) => { if (t === 'settings') loadSummary(); });
})();
