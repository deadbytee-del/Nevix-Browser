'use strict';
// Bootstrap only. Everything heavy is required lazily after the app is ready, so the first window appears quickly.
const path = require('path');
const fs = require('fs');
const { app, protocol } = require('electron');

const marks = { processCreated: Date.now() - Math.round(process.uptime() * 1000), mainStart: Date.now() };
app.setName('Nevix');

// ---- portable mode: profile lives next to the executable ---------------------------------------------------------
function detectPortable() {
  if (process.argv.includes('--portable')) return path.join(path.dirname(process.execPath), 'NevixData');
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'NevixData'); // electron-builder "portable" target
  if (app.isPackaged) {
    const dir = path.dirname(process.execPath);
    if (fs.existsSync(path.join(dir, 'portable.flag'))) return path.join(dir, 'NevixData');
  }
  return null;
}
const portableDir = detectPortable();
if (portableDir) { try { fs.mkdirSync(portableDir, { recursive: true }); app.setPath('userData', portableDir); } catch {} }
const userData = app.getPath('userData');

// ---- recovery, flags, safe mode ------------------------------------------------------------------------------
const { Recovery } = require('./recovery');
const { Flags } = require('./flags');
const recovery = new Recovery(userData);
const safeMode = process.argv.includes('--safe-mode') || process.env.NEVIX_SAFE_MODE === '1';
const flags = new Flags(path.join(userData, 'flags.json'), { safeMode });
const bootNotice = {};
if (!safeMode && recovery.crashLoop) {
  const ids = flags.disableExperimental();
  bootNotice.crashLoop = true;
  bootNotice.disabledFlags = ids;
}
if (safeMode) bootNotice.safeMode = true;

// ---- a couple of settings must be known before Chromium starts ----------------------------------------------------
let early = {};
try { early = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')) || {}; } catch {}
const earlyPerf = early.performance || {};
const earlyAdv = early.advanced || {};
if (earlyPerf.hardwareAcceleration === false) app.disableHardwareAcceleration();
if (earlyAdv.crashReports === true) {
  // Local-only: minidumps are written to the profile and never uploaded.
  try { require('electron').crashReporter.start({ uploadToServer: false, compress: true, submitURL: '', productName: 'Nevix' }); } catch {}
}

// ---- Chromium switches: strip every background call-home, keep the speed features -----------------------------
const sw = app.commandLine;
for (const s of [
  'disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-sync',
  'disable-client-side-phishing-detection', 'disable-default-apps', 'disable-breakpad', 'no-pings',
  'no-default-browser-check', 'no-first-run', 'disable-translate', 'metrics-recording-only', 'disable-speech-api',
]) sw.appendSwitch(s);
sw.appendSwitch('disable-features', [
  'Translate', 'InterestFeedContentSuggestions', 'PrivacySandboxSettings4', 'OptimizationHints', 'MediaRouter',
  'AutofillServerCommunication', 'CertificateTransparencyComponentUpdater', 'NetworkTimeServiceQuerying',
  'FederatedLearning', 'Topics', 'AttributionReporting', 'BrowsingTopics', 'FledgeInterestGroup', 'FirstPartySets',
  'GlobalMediaControls', 'LiveCaption', 'ReportingServiceProxy', 'NotificationTriggers',
].join(','));
sw.appendSwitch('enable-features', ['ParallelDownloading', 'BackForwardCache'].concat(process.platform === 'linux' ? ['VaapiVideoDecoder'] : []).join(','));
sw.appendSwitch('enable-quic');
// Autoplay is policed per-site in the page preload; Chromium itself must not block what the user allowed.
sw.appendSwitch('autoplay-policy', 'no-user-gesture-required');
for (const [name, value] of flags.switches()) { if (value === undefined) sw.appendSwitch(name); else sw.appendSwitch(name, value); }

protocol.registerSchemesAsPrivileged([
  { scheme: 'nevix', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.userAgentFallback = (() => {
  const chrome = process.versions.chrome.split('.')[0];
  const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`;
})();

// ---- single instance & lifecycle ---------------------------------------------------------------------------------
const e2e = process.env.NEVIX_E2E === '1';
if (!app.requestSingleInstanceLock() && !e2e) app.quit();

let nx = null;
const pending = [];                    // URLs received before the app finished starting
app.on('second-instance', (_e, argv) => {
  const urls = urlsFromArgv(argv);
  if (!nx) { pending.push(...urls); return; }
  if (urls.length) nx.openUrls(urls);
  else if (nx.lastWindow) { if (nx.lastWindow.win.isMinimized()) nx.lastWindow.win.restore(); nx.lastWindow.win.focus(); }
});
app.on('open-url', (e, url) => { e.preventDefault(); if (nx) nx.openUrls([url]); else pending.push(url); });
app.on('open-file', (e, file) => { e.preventDefault(); const u = fileToUrl(file); if (nx) nx.openUrls([u]); else pending.push(u); });

const OPENABLE = /\.(html?|xhtml|svg|pdf|txt)$/i;
function fileToUrl(f) { return require('url').pathToFileURL(f).toString(); }
/** URLs and openable files from a command line (Windows launches `Nevix.exe <url>` and file associations this way). */
function urlsFromArgv(argv) {
  const out = [];
  for (const a of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!a || a.startsWith('--')) continue;
    if (/^https?:\/\//i.test(a)) out.push(a);
    else if (OPENABLE.test(a) && fs.existsSync(a)) out.push(fileToUrl(path.resolve(a)));
  }
  return out;
}

app.on('web-contents-created', (_e, wc) => { wc.on('will-attach-webview', (e) => e.preventDefault()); });
app.on('certificate-error', (e, wc, url, error, cert, cb) => {
  e.preventDefault();
  try { cb(!!nx && nx.privacy.certAllowed.has(new URL(url).host)); } catch { cb(false); }
});
app.on('login', (e, wc, req, auth, cb) => { e.preventDefault(); if (nx) nx.promptLogin(wc, auth, cb); else cb(); });

let quitDone = false;
app.on('before-quit', (e) => {
  if (!nx) { recovery.disarm(); return; }
  nx.quitting = true;
  if (quitDone) return;
  e.preventDefault();
  quitDone = true;
  nx.onQuit().catch(() => {}).finally(() => { recovery.disarm(); app.quit(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (nx && !nx.windows.size) nx.createWindow({}); });

app.whenReady().then(() => {
  marks.ready = Date.now();
  const { NevixApp } = require('./app');
  nx = new NevixApp({ flags, recovery, marks, safeMode, portable: !!portableDir, notice: bootNotice, userData });
  global.__nevix = nx;
  nx.start(urlsFromArgv(process.argv).concat(pending.splice(0)));
  recovery.arm();
  // A run that survives half a minute is healthy: stop counting it towards a crash loop.
  setTimeout(() => recovery.healthy(), 30000).unref();

  // Test harness hook: only active when the environment explicitly opts in (never from argv alone).
  const hook = e2e ? process.argv.indexOf('--nevix-e2e') : -1;
  if (hook !== -1 && process.argv[hook + 1]) {
    setTimeout(() => require(path.resolve(process.argv[hook + 1]))(nx, { app, session: require('electron').session }).catch((err) => { console.error('E2E FAIL', err); app.exit(1); }), 1500);
  }
});
