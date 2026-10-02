'use strict';
// Performance center backend: live metrics, "what's using resources?", launch-time history and a benchmark harness.
// Everything is measured, nothing is hard-coded: no result in this file is a constant.
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const dns = require('dns');
const { app, session, dialog } = require('electron');
const { Store } = require('./store');
const { hostOf } = require('./domain');

const KB = 1024;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Perf {
  constructor(a) {
    this.app = a;
    this.store = new Store(path.join(a.userData, 'perf.json'), { launches: [], bench: [] });
    this.launchRecorded = false;
    this._bench = null;
  }

  get bench() { return this._bench || (this._bench = new Bench(this)); }
  flush() { this.store.flush(); }

  // ---- startup --------------------------------------------------------------------------------------------
  /** Record how long this launch took (called once, shortly after the first window appears). */
  recordLaunch() {
    if (this.launchRecorded) return;
    const m = this.app.marks;
    if (!m.firstWindowShown) return;
    this.launchRecorded = true;
    const bootId = Math.round((Date.now() - os.uptime() * 1000) / 60000);       // changes only when the machine reboots
    const launches = this.store.get('launches');
    const last = launches[launches.length - 1];
    const rec = {
      at: Date.now(), bootId, cold: !last || last.bootId !== bootId,
      toMainMs: m.mainStart - m.processCreated, toReadyMs: (m.ready || m.mainStart) - m.processCreated, toWindowMs: m.firstWindowShown - m.processCreated,
      lazyInit: this.app.flags.on('nevix-enable-startup-lazy-init'),
    };
    this.store.set('launches', [...launches, rec].slice(-30));
  }

  startup() {
    this.recordLaunch();
    const launches = this.store.get('launches');
    const cold = launches.filter((l) => l.cold).map((l) => l.toWindowMs);
    const warm = launches.filter((l) => !l.cold).map((l) => l.toWindowMs);
    return {
      thisLaunch: launches[launches.length - 1] || null,
      coldMedian: cold.length ? round(median(cold), 0) : null, coldCount: cold.length,
      warmMedian: warm.length ? round(median(warm), 0) : null, warmCount: warm.length,
      history: launches.slice(-12),
    };
  }

  // ---- live snapshot --------------------------------------------------------------------------------------
  async snapshot() {
    const metrics = app.getAppMetrics();
    const byPid = new Map(metrics.map((m) => [m.pid, m]));
    const kb = (m) => (m.memory ? m.memory.workingSetSize : 0);
    const sum = (f) => metrics.filter(f).reduce((n, m) => n + kb(m), 0) * KB;
    const cpu = metrics.reduce((n, m) => n + (m.cpu ? m.cpu.percentCPUUsage : 0), 0);

    // Map renderer processes to tabs (several tabs of one site may share a process).
    const tabs = [];
    const pidUsers = new Map();
    for (const w of this.app.windows) {
      for (const t of w.tabs) {
        const wc = t.wc;
        const pid = wc ? wc.getOSProcessId() : 0;
        if (pid) pidUsers.set(pid, (pidUsers.get(pid) || 0) + 1);
        tabs.push({ win: w.id, id: t.id, title: t.title || t.displayUrl || 'New Tab', host: hostOf(t.displayUrl) || (/^nevix:/.test(t.url) ? 'nevix' : ''), pid, stage: t.stage, active: t.id === w.activeId, pinned: t.pinned, audible: t.audible, group: t.groupId || 0 });
      }
    }
    for (const t of tabs) {
      const m = byPid.get(t.pid);
      t.memory = m ? (kb(m) * KB) / (pidUsers.get(t.pid) || 1) : 0;
      t.cpu = m && m.cpu ? m.cpu.percentCPUUsage / (pidUsers.get(t.pid) || 1) : 0;
    }
    // UI views of each window are renderers too.
    const uiPids = new Set();
    for (const w of this.app.windows) { try { uiPids.add(w.ui.webContents.getOSProcessId()); } catch {} }

    const ext = this.app.lazyModules.ext ? this.app.ext.overhead() : { count: 0, memory: 0, pids: [] };
    const extPids = new Set(ext.pids);
    const life = this.app.lazyModules.life ? this.app.life.counts() : { active: 0, idle: 0, frozen: 0, suspended: 0, discarded: 0, total: 0 };

    const processes = metrics.map((m) => ({
      pid: m.pid, type: m.type, name: m.name || m.serviceName || '', memory: kb(m) * KB, cpu: m.cpu ? m.cpu.percentCPUUsage : 0,
      role: m.type === 'Tab' ? (extPids.has(m.pid) ? 'Extension' : uiPids.has(m.pid) ? 'Browser interface' : (tabs.find((t) => t.pid === m.pid) ? 'Tab' : 'Renderer')) : m.type,
    }));

    let cacheSize = 0;
    try { cacheSize = await session.fromPartition('persist:nevix').getCacheSize(); } catch {}
    let gpu = {};
    try { gpu = app.getGPUFeatureStatus(); } catch {}

    const total = os.totalmem(), free = os.freemem();
    return {
      at: Date.now(),
      system: { total, free, used: total - free, cpus: os.cpus().length, load: os.loadavg()[0], platform: process.platform },
      browser: {
        memory: sum(() => true), cpu: round(cpu, 1), processes: metrics.length,
        browserProcess: sum((m) => m.type === 'Browser'), renderers: sum((m) => m.type === 'Tab'), gpu: sum((m) => m.type === 'GPU'),
        utility: sum((m) => m.type !== 'Browser' && m.type !== 'Tab' && m.type !== 'GPU'),
        gpuStatus: { compositing: gpu.gpu_compositing || 'unknown', rasterization: gpu.rasterization || 'unknown', webgl: gpu.webgl || 'unknown' },
      },
      tabs: { ...life },
      extensions: ext,
      cache: cacheSize,
      network: { ...this.app.privacy.net },
      processes, tabList: tabs.sort((a, b) => b.memory - a.memory),
      advice: this.advice(tabs, free / total),
      startup: this.startup(),
    };
  }

  /** Plain-language explanation of what is using resources, each with an action that really works. */
  advice(tabs, freeRatio) {
    const out = [];
    const mb = (b) => Math.round(b / 1048576);
    const worth = tabs.filter((t) => t.pid && !/^nevix$/.test(t.host)).slice(0, 5);
    for (const t of worth) {
      if (t.memory < 150 * 1048576 && t.cpu < 8) continue;
      if (t.active) {
        out.push({ level: t.cpu > 25 ? 'high' : 'info', text: `“${t.title.slice(0, 50)}” is the tab you're using and takes ${mb(t.memory)} MB${t.cpu > 5 ? ` and ${t.cpu.toFixed(0)}% CPU` : ''}. Heavy pages (video, maps, web apps) do this. Closing other tabs won't change it.`, tab: t, actions: ['close'] });
      } else if (t.stage === 'active' || t.stage === 'idle') {
        out.push({ level: t.memory > 400 * 1048576 || t.cpu > 15 ? 'high' : 'info', text: `“${t.title.slice(0, 50)}” is in the background but still takes ${mb(t.memory)} MB${t.cpu > 3 ? ` and ${t.cpu.toFixed(0)}% CPU` : ''}. ${t.audible ? 'It is playing audio, so Nevix will not touch it.' : 'Freezing stops its CPU use; suspending also frees its memory.'}`, tab: t, actions: t.audible ? ['close'] : ['freeze', 'suspend', 'close'] });
      } else if (t.stage === 'frozen' && t.memory > 200 * 1048576) {
        out.push({ level: 'info', text: `“${t.title.slice(0, 50)}” is frozen (no CPU use) but still holds ${mb(t.memory)} MB. Suspend it to free that memory — it reopens where you left off.`, tab: t, actions: ['suspend'] });
      }
    }
    if (freeRatio < 0.12) out.unshift({ level: 'high', text: `Your computer has only ${Math.round(freeRatio * 100)}% memory free. Suspending background tabs (or enabling the memory-pressure manager flag) will help.`, actions: [] });
    if (!out.length) out.push({ level: 'ok', text: 'Nothing unusual. No tab or extension is using a noticeable amount of resources right now.', actions: [] });
    return out;
  }

  async tabAction(winId, tabId, action) {
    const w = [...this.app.windows].find((x) => x.id === winId);
    if (!w) return false;
    switch (action) {
      case 'freeze': return this.app.life.freezeTab(w, tabId);
      case 'suspend': return this.app.life.suspendTab(w, tabId);
      case 'discard': return this.app.life.discardTab(w, tabId);
      case 'close': w.closeTab(tabId); return true;
      case 'activate': w.activate(tabId); w.win.focus(); return true;
      default: return false;
    }
  }
}

// ======================================================================================================
// Benchmark harness
// ======================================================================================================
const PAGE = (n) => `<!doctype html><html><head><meta charset="utf-8"><title>bench ${n}</title><style>body{font:16px sans-serif;margin:2em}</style></head><body><h1>Benchmark page ${n}</h1>${'<p>The quick brown fox jumps over the lazy dog. </p>'.repeat(60)}<script>window.__ready=performance.now()</script></body></html>`;

class Bench {
  constructor(perf) { this.perf = perf; this.app = perf.app; this.running = false; }

  history() { return this.perf.store.get('bench'); }
  clear() { this.perf.store.set('bench', []); return true; }

  async export(parent) {
    const r = await dialog.showSaveDialog(parent, { defaultPath: path.join(app.getPath('documents'), 'nevix-benchmarks.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(this.history(), null, 2));
    return true;
  }

  cpuNow() { return app.getAppMetrics().reduce((n, m) => n + (m.cpu ? m.cpu.percentCPUUsage : 0), 0); }
  memNow() { return app.getAppMetrics().reduce((n, m) => n + (m.memory ? m.memory.workingSetSize : 0), 0) * KB; }
  gpuCpuNow() { return app.getAppMetrics().filter((m) => m.type === 'GPU').reduce((n, m) => n + (m.cpu ? m.cpu.percentCPUUsage : 0), 0); }

  /**
   * @param {{runs?:number, tabCounts?:number[], idleSeconds?:number, host?:string}} opts
   * `host` (optional) is a hostname the USER typed; only then is DNS/latency measured against it. Nothing else leaves the machine.
   */
  async run(opts = {}, progress = () => {}) {
    if (this.running) throw new Error('A benchmark is already running');
    this.running = true;
    const runs = Math.max(3, Math.min(15, opts.runs | 0 || 5));
    const tabCounts = (opts.tabCounts && opts.tabCounts.length ? opts.tabCounts : [1, 10, 25]).map((n) => Math.max(1, Math.min(60, n | 0)));
    const idleSeconds = Math.max(3, Math.min(30, opts.idleSeconds | 0 || 6));
    const metrics = [];
    const add = (id, name, unit, values, notes = '') => {
      metrics.push({ id, name, unit, runs: values.map((v) => round(v, 2)), median: round(median(values), 2), p95: round(pct(values, 95), 2), min: round(Math.min(...values), 2), max: round(Math.max(...values), 2), notes });
    };
    const step = (name) => progress({ step: name, done: metrics.length });

    // A loopback server so every measurement is repeatable and touches no external network.
    let n = 0;
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/ping')) { res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end('ok'); }
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(PAGE(++n));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const nx = this.app;
    let bw = null;
    try {
      // Dedicated private window so the user's tabs are never touched.
      bw = nx.createWindow({ private: true, url: 'nevix://newtab' });
      await sleep(1200);
      const waitLoad = (tab, ms = 15000) => new Promise((resolve, reject) => {
        const wc = tab.wc; if (!wc) return reject(new Error('no web contents'));
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        wc.once('did-finish-load', () => { clearTimeout(t); resolve(); });
      });

      // 1. New tab (internal page)
      step('New tab');
      const nt = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const tab = bw.newTab({ url: 'nevix://newtab' });
        await waitLoad(tab);
        nt.push(performance.now() - t0);
        bw.closeTab(tab.id);
        await sleep(150);
      }
      add('newtab', 'New tab → loaded', 'ms', nt, nx.flags.on('nevix-enable-renderer-prewarm') ? 'renderer prewarm flag is ON' : 'renderer prewarm flag is off');

      // 2. Navigation + time to interactive (loopback page)
      step('Navigation');
      const nav = [], tti = [], load = [];
      const tab = bw.newTab({ url: 'about:blank' });
      await sleep(300);
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const p = waitLoad(tab);
        tab.load(`${base}/p?i=${i}`);
        await p;
        nav.push(performance.now() - t0);
        const timing = await tab.wc.executeJavaScript('(() => { const t = performance.timing; return [t.domInteractive - t.navigationStart, t.loadEventEnd - t.navigationStart]; })()');
        tti.push(timing[0]); load.push(timing[1]);
        await sleep(100);
      }
      add('navigation', 'Navigation → load event (loopback)', 'ms', nav, 'wall-clock from loadURL to did-finish-load');
      add('tti', 'Time to interactive (DOM interactive)', 'ms', tti, 'measured inside the page with the Navigation Timing API');
      add('pageload', 'Page load event', 'ms', load);

      // 3. Renderer startup
      step('Renderer startup');
      const rs = [];
      const { makeView } = require('./window');
      for (let i = 0; i < runs; i++) {
        const ses = session.fromPartition(`nevix-bench-${Date.now()}-${i}`);
        nx.privacy.harden(ses);
        const view = makeView(nx, `nevix-bench-r${Date.now()}-${i}`);
        const t0 = performance.now();
        const done = new Promise((r) => view.webContents.once('dom-ready', r));
        view.webContents.loadURL(`${base}/r?i=${i}`);
        await Promise.race([done, sleep(10000)]);
        rs.push(performance.now() - t0);
        try { view.webContents.close({ waitForBeforeUnload: false }); } catch {}
        await sleep(120);
      }
      add('renderer', 'New renderer process → DOM ready', 'ms', rs, 'fresh session, so a new renderer process is spawned');

      // 4. Network latency (loopback + optional user-chosen host)
      step('Network latency');
      const rtt = [];
      for (let i = 0; i < 20; i++) { const t0 = performance.now(); await fetchLocal(`${base}/ping?${i}`); rtt.push(performance.now() - t0); }
      add('loopback', 'Loopback HTTP round trip', 'ms', rtt, 'in-process loopback; measures the browser network stack, not your internet connection');
      const host = String(opts.host || '').trim().toLowerCase();
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
        const d = [];
        for (let i = 0; i < 5; i++) { const t0 = performance.now(); await new Promise((r) => dns.lookup(host, { all: false }, () => r())); d.push(performance.now() - t0); await sleep(50); }
        add('dns', `DNS lookup: ${host}`, 'ms', d, 'system resolver; the host was entered by you');
      }

      // 5. Memory with N tabs
      step('Memory');
      const baseMem = this.memNow();
      let opened = [];
      for (const target of [...new Set(tabCounts)].sort((a, b) => a - b)) {
        step(`Memory with ${target} tab${target > 1 ? 's' : ''}`);
        while (opened.length < target) {
          const t = bw.newTab({ url: `${base}/m?k=${opened.length}`, background: true });
          opened.push(t);
          if (opened.length % 5 === 0) await sleep(150);
        }
        await sleep(2500 + target * 60);
        const mem = this.memNow();
        add(`mem${target}`, `Browser memory with ${target} tab${target > 1 ? 's' : ''} open`, 'MB', [mem / 1048576], `baseline before tabs: ${Math.round(baseMem / 1048576)} MB; ≈${Math.round((mem - baseMem) / 1048576 / target)} MB per tab`);
      }

      // 6. CPU & GPU
      step('Idle CPU');
      await sleep(1500);
      this.cpuNow();
      const idle = [], idleGpu = [];
      for (let i = 0; i < idleSeconds; i++) { await sleep(1000); idle.push(this.cpuNow()); idleGpu.push(this.gpuCpuNow()); }
      add('cpuidle', `Idle CPU (${opened.length} tabs open, sampled each second)`, '%', idle, 'sum across all Nevix processes; 100% = one full core');
      step('Active CPU');
      const act = [], actGpu = [];
      this.cpuNow();
      const actTab = opened[0];
      const stop = Date.now() + Math.max(3000, idleSeconds * 600);
      const sampler = (async () => { while (Date.now() < stop) { await sleep(1000); act.push(this.cpuNow()); actGpu.push(this.gpuCpuNow()); } })();
      let k = 0;
      while (Date.now() < stop) { tab.load(`${base}/a?k=${k++}`); await sleep(120); }
      await sampler;
      add('cpuactive', 'Active CPU (continuous navigation)', '%', act.length ? act : [0]);
      add('gpucpu', 'GPU process CPU (active)', '%', actGpu.length ? actGpu : [0], `idle: ${round(median(idleGpu), 1)}%`);
      void actTab;

      for (const t of opened) { try { bw.closeTab(t.id); } catch {} }
      const gpu = (() => { try { return app.getGPUFeatureStatus(); } catch { return {}; } })();
      const result = {
        id: Date.now().toString(36), at: Date.now(), runs, tabCounts,
        env: {
          nevix: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, os: `${os.type()} ${os.release()}`,
          cpu: (os.cpus()[0] || {}).model, cores: os.cpus().length, ramGB: round(os.totalmem() / 1073741824, 1), gpu: gpu.gpu_compositing || 'unknown',
          flags: Object.entries(nx.flags.snapshot()).filter(([, v]) => v).map(([k]) => k),
        },
        metrics,
      };
      this.perf.store.set('bench', [result, ...this.history()].slice(0, 20));
      return result;
    } finally {
      this.running = false;
      server.close();
      try { if (bw && bw.alive) bw.win.close(); } catch {}
    }
  }
}

function fetchLocal(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject);
  });
}

module.exports = { Perf, Bench, median, pct };
