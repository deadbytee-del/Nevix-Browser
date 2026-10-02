'use strict';
(() => {
  const { $, el, call, num, bytes, dur, ago, toast, header, confirmDialog } = NX;
  const root = $('#root');
  let tab = (location.hash || '#live').slice(1), snap = null, timer = null, benchRunning = false, progress = '';
  const TABS = [['live', 'Live'], ['startup', 'Startup'], ['bench', 'Benchmarks']];
  const stat = (v, l, sub) => el('div', { class: 'stat' }, el('b', {}, v), el('span', {}, l), sub ? el('div', { class: 'dim', style: 'font-size:11.5px;margin-top:2px' }, sub) : null);
  const mb = (n) => bytes(n);
  const STAGE_BADGE = { active: '', idle: '', frozen: 'primary', suspended: 'warn', discarded: 'danger' };

  function shell(body) {
    root.replaceChildren(...header('nevix://performance', 'Measured values from the running browser. Nothing on this page is estimated from marketing numbers — every figure comes from the engine’s own process metrics.'),
      el('div', { class: 'tabsnav' }, TABS.map(([id, label]) => el('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; history.replaceState(null, '', '#' + id); start(); } }, label))), body);
  }

  // ---- live ------------------------------------------------------------------------------------------------
  async function live() {
    snap = await call('perf:snapshot');
    const s = snap, b = s.browser, sys = s.system;
    const procTable = el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'Process'), el('th', {}, 'Role'), el('th', { class: 'num' }, 'PID'), el('th', { class: 'num' }, 'Memory'), el('th', { class: 'num' }, 'CPU'))),
      el('tbody', {}, [...s.processes].sort((a, c) => c.memory - a.memory).map((p) => el('tr', {}, el('td', {}, p.name || p.type), el('td', { class: 'dim' }, p.role), el('td', { class: 'num' }, p.pid), el('td', { class: 'num' }, mb(p.memory)), el('td', { class: 'num' }, p.cpu.toFixed(1) + '%')))));
    const tabsTable = el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'Tab'), el('th', {}, 'State'), el('th', { class: 'num' }, 'Memory'), el('th', { class: 'num' }, 'CPU'), el('th', {}, ''))),
      el('tbody', {}, s.tabList.map((t) => el('tr', {}, el('td', {}, el('div', {}, t.title.slice(0, 60)), el('div', { class: 'dim mono', style: 'font-size:11.5px' }, t.host + (t.active ? ' · in use' : '') + (t.pinned ? ' · pinned' : ''))),
        el('td', {}, el('span', { class: 'badge ' + (STAGE_BADGE[t.stage] || '') }, t.stage)), el('td', { class: 'num' }, t.pid ? mb(t.memory) : '—'), el('td', { class: 'num' }, t.pid ? t.cpu.toFixed(1) + '%' : '—'),
        el('td', { style: 'text-align:right;white-space:nowrap' }, actionBtns(t, ['freeze', 'suspend', 'close']))))));
    const body = el('div', {},
      el('div', { class: 'cards' },
        stat(mb(b.memory), 'browser memory', `${num(b.processes)} processes`), stat(mb(b.renderers), 'renderer memory', 'all tabs + interface'), stat(mb(b.gpu), 'gpu process memory', `compositing: ${b.gpuStatus.compositing}`),
        stat(b.cpu.toFixed(1) + '%', 'cpu (all processes)', `${sys.cpus} cores · 100% = one core`), stat(mb(sys.used) + ' / ' + mb(sys.total), 'system memory', `${Math.round((sys.free / sys.total) * 100)}% free`), stat(mb(s.cache), 'cache size')),
      el('h3', { style: 'margin:6px 0 10px' }, 'What’s using resources?'),
      el('div', { class: 'list' }, s.advice.map((a) => el('div', { class: 'item', style: 'align-items:flex-start' },
        el('span', { class: 'badge ' + (a.level === 'high' ? 'danger' : a.level === 'ok' ? 'ok' : 'primary') }, a.level === 'ok' ? 'ok' : a.level === 'high' ? 'heavy' : 'note'), el('div', { class: 'main', style: 'white-space:normal' }, a.text),
        a.tab ? el('div', { class: 'row' }, actionBtns(a.tab, a.actions)) : null))),
      el('div', { class: 'cards', style: 'margin-top:18px' },
        stat(num(s.tabs.active + s.tabs.idle), 'active / idle tabs'), stat(num(s.tabs.frozen), 'frozen tabs'), stat(num(s.tabs.suspended), 'suspended tabs'), stat(num(s.tabs.discarded), 'discarded tabs'),
        stat(num(s.extensions.count), 'extensions', s.extensions.count ? mb(s.extensions.memory) + ' overhead' : 'no overhead'), stat(num(s.network.requests), 'requests this session', `${bytes(s.network.bytes)} declared · ${num(s.network.cached)} from cache`)),
      el('h3', { style: 'margin:22px 0 8px' }, 'Tabs by memory'), el('div', { class: 'tablewrap', style: 'max-height:340px' }, tabsTable),
      el('h3', { style: 'margin:22px 0 8px' }, 'All processes'), el('div', { class: 'tablewrap', style: 'max-height:340px' }, procTable),
      el('p', { class: 'dim', style: 'margin-top:12px;font-size:12px' }, 'Memory is the working set (what is resident in RAM). Several tabs of one site can share a process, in which case their memory is split between them. CPU percentages are measured since the previous refresh.'));
    shell(body);
  }
  function actionBtns(t, actions) {
    return (actions || []).filter((a) => (a !== 'freeze' || (t.stage === 'idle' || t.stage === 'active') && !t.active) && (a !== 'suspend' || !['suspended', 'discarded'].includes(t.stage) && !t.active)).map((a) =>
      el('button', { class: 'btn sm' + (a === 'close' ? ' danger' : ''), style: 'margin-left:6px', onclick: async () => { await call('perf:tabAction', { win: t.win, tab: t.id, action: a }); toast(a === 'close' ? 'Closed' : a === 'freeze' ? 'Frozen' : 'Suspended'); setTimeout(refresh, 300); } }, a[0].toUpperCase() + a.slice(1)));
  }

  // ---- startup -----------------------------------------------------------------------------------------------
  async function startup() {
    const st = await call('perf:startup');
    const t = st.thisLaunch;
    shell(el('div', {},
      el('div', { class: 'cards' },
        stat(t ? Math.round(t.toWindowMs) + ' ms' : '—', 'this launch → first window', t ? (t.cold ? 'cold (first since reboot)' : 'warm') : ''),
        stat(st.coldMedian !== null ? st.coldMedian + ' ms' : '—', 'cold start, median', `${st.coldCount} recorded`), stat(st.warmMedian !== null ? st.warmMedian + ' ms' : '—', 'warm start, median', `${st.warmCount} recorded`)),
      el('p', { class: 'dim', style: 'margin-bottom:12px' }, 'Measured from process creation to the first window being shown. A launch counts as “cold” when it is the first since the computer was restarted (the disk cache is probably empty). Every launch is recorded locally; nothing is sent anywhere.'),
      el('div', { class: 'tablewrap' }, el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Kind'), el('th', { class: 'num' }, 'Process → main'), el('th', { class: 'num' }, 'Process → ready'), el('th', { class: 'num' }, 'Process → window'), el('th', {}, 'Lazy init'))),
        el('tbody', {}, [...st.history].reverse().map((l) => el('tr', {}, el('td', {}, ago(l.at)), el('td', {}, el('span', { class: 'badge ' + (l.cold ? 'warn' : '') }, l.cold ? 'cold' : 'warm')), el('td', { class: 'num' }, Math.round(l.toMainMs) + ' ms'), el('td', { class: 'num' }, Math.round(l.toReadyMs) + ' ms'), el('td', { class: 'num' }, Math.round(l.toWindowMs) + ' ms'), el('td', {}, l.lazyInit ? 'on' : 'off'))))))));
  }

  // ---- benchmarks ----------------------------------------------------------------------------------------------
  async function bench() {
    const hist = await call('perf:benchHistory');
    const runs = el('input', { type: 'number', value: 5, min: 3, max: 15, style: 'width:70px' });
    const host = el('input', { type: 'text', placeholder: 'optional: a host to time DNS for, e.g. example.com', style: 'width:340px' });
    const quick = el('input', { type: 'checkbox' });
    const status = el('span', { class: 'dim' }, progress);
    const runBtn = el('button', { class: 'btn primary', disabled: benchRunning }, benchRunning ? 'Running…' : 'Run benchmark');
    runBtn.onclick = async () => {
      if (!await confirmDialog('Run the benchmark?', 'Nevix opens a temporary private window, loads pages from a loopback server on this computer, and measures timing, memory and CPU. It takes about a minute and touches no external network (unless you enter a host to time DNS for). Please leave the computer idle.', { ok: 'Run' })) return;
      benchRunning = true; runBtn.disabled = true; runBtn.textContent = 'Running…';
      try { const r = await call('perf:bench', { runs: +runs.value, host: host.value.trim(), tabCounts: quick.checked ? [1, 5] : [1, 10, 25], idleSeconds: quick.checked ? 4 : 8 }); toast('Benchmark complete'); } catch (e) { toast('Benchmark failed: ' + String(e.message).replace(/^.*Error: /, ''), true); }
      benchRunning = false; progress = ''; bench();
    };
    window.nevix.on('bench-progress', (p) => { progress = p.step; status.textContent = p.step + '…'; });
    const latest = hist[0];
    const resultTable = (r) => el('div', { class: 'tablewrap' }, el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, el('th', {}, 'Measurement'), el('th', { class: 'num' }, 'Median'), el('th', { class: 'num' }, 'p95'), el('th', { class: 'num' }, 'Min'), el('th', { class: 'num' }, 'Max'), el('th', {}, 'Runs'), el('th', {}, 'Notes'))),
      el('tbody', {}, r.metrics.map((m) => el('tr', {}, el('td', {}, m.name), el('td', { class: 'num' }, el('b', {}, m.median + ' ' + m.unit)), el('td', { class: 'num' }, m.p95), el('td', { class: 'num' }, m.min), el('td', { class: 'num' }, m.max), el('td', { class: 'mono dim', style: 'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: m.runs.join(', ') }, m.runs.length > 1 ? m.runs.join(' ') : '—'), el('td', { class: 'dim' }, m.notes))))));
    shell(el('div', {},
      el('p', { class: 'dim', style: 'margin-bottom:12px' }, 'Repeatable measurements of this browser on this computer: new-tab time, navigation, time to interactive, renderer start-up, memory with 1/10/25 tabs, idle and active CPU, GPU-process load and network round-trip. Results show every run, so variation is visible. They are not comparisons with any other browser and make no performance claims.'),
      el('div', { class: 'toolbar' }, el('label', { class: 'row dim' }, 'Runs ', runs), host, el('label', { class: 'row dim' }, quick, 'quick (fewer tabs)'), runBtn, status),
      latest ? [el('h3', { style: 'margin:18px 0 6px' }, 'Latest result · ' + new Date(latest.at).toLocaleString()), el('p', { class: 'dim mono', style: 'font-size:12px;margin-bottom:8px' }, `${latest.env.os} · ${latest.env.cpu} · ${latest.env.cores} cores · ${latest.env.ramGB} GB · Chromium ${latest.env.chrome} · Nevix ${latest.env.nevix}${latest.env.flags.length ? ' · flags: ' + latest.env.flags.join(', ') : ''}`), resultTable(latest),
        el('div', { class: 'toolbar' }, el('button', { class: 'btn', onclick: async () => { if (await call('perf:benchExport')) toast('Exported'); } }, 'Export all results (JSON)…'), el('button', { class: 'btn', onclick: async () => { await call('perf:benchClear'); bench(); } }, 'Clear history')),
        hist.length > 1 ? [el('h3', { style: 'margin:18px 0 6px' }, 'Earlier runs'), el('div', { class: 'list' }, hist.slice(1).map((h) => el('div', { class: 'item' }, el('div', { class: 'main t' }, new Date(h.at).toLocaleString()), el('span', { class: 'dim mono' }, h.metrics.filter((m) => ['newtab', 'navigation', 'mem10'].includes(m.id)).map((m) => `${m.name.split(' ')[0]} ${m.median}${m.unit}`).join(' · ')))))] : null] :
        el('div', { class: 'empty' }, 'No benchmark has been run yet.')));
  }

  const refresh = () => { if (tab === 'live' && !document.hidden) live(); };
  function start() {
    clearInterval(timer);
    if (tab === 'live') { live(); timer = setInterval(refresh, 2500); }       // only while this page is visible
    else if (tab === 'startup') startup();
    else bench();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); else clearInterval(timer); });
  start();
})();
