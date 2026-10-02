'use strict';
// Declarative description of every user-facing setting. nevix://settings is generated from this, so each entry has a
// description, a safe default (read from SETTINGS) and a reset. Keys are dotted paths into the settings store.
const { SEARCH_ENGINES, SETTINGS } = require('./defaults');

const CATEGORIES = ['General', 'Appearance', 'Tabs', 'Privacy', 'Security', 'Performance', 'Network', 'Downloads', 'Extensions', 'Shortcuts', 'Search', 'Sync', 'Developer', 'Flags', 'Advanced'];

const engines = Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, v.name]);
const num = (o) => ({ type: 'number', ...o });

const SCHEMA = [
  // ---- General
  { key: 'general.startup', category: 'General', title: 'When Nevix starts', type: 'select', options: [['newtab', 'Open a new tab'], ['restore', 'Continue where I left off'], ['homepage', 'Open my homepage']], description: 'After a crash you are always asked whether to restore the previous session.' },
  { key: 'general.homepage', category: 'General', title: 'Homepage', type: 'text', placeholder: 'nevix://newtab', description: 'Opened by the Home command and, if selected above, at startup.' },
  { key: 'general.saveHistory', category: 'General', title: 'Save browsing history', type: 'toggle', description: 'Kept only on this device. It powers address-bar suggestions and the new-tab page. Private windows, isolated and temporary tabs never record history.' },
  { key: 'general.spellcheck', category: 'General', title: 'Spell check', type: 'toggle', description: 'Off by default on Windows and Linux because dictionaries are normally downloaded from a third-party server.' },
  { type: 'action', action: 'default-browser', category: 'General', title: 'Default browser', label: 'Open default-apps settings', description: 'Register Nevix for http and https links. Windows asks you to confirm the change.' },
  { type: 'action', action: 'import-browser', category: 'General', title: 'Import from another browser', label: 'Choose what to import…', description: 'Reads bookmarks (and optionally history) from Chrome, Edge, Brave, Vivaldi, Opera or Firefox on this computer. Nothing leaves your device.' },
  // ---- Appearance
  { key: 'general.theme', category: 'Appearance', title: 'Theme', type: 'select', options: [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match system']], description: 'Nevix is designed dark-first; the light theme is derived from the same palette.' },
  { key: 'general.accent', category: 'Appearance', title: 'Accent colour', type: 'color', description: 'Overrides the primary colour everywhere. Leave empty to use the Nevix palette (#9D64A3).', allowEmpty: true },
  { key: 'general.verticalTabs', category: 'Appearance', title: 'Vertical tabs', type: 'toggle', description: 'Show tabs in a collapsible sidebar instead of a strip.', flag: 'nevix-enable-vertical-tabs' },
  { key: 'general.bookmarksBar', category: 'Appearance', title: 'Show bookmarks bar', type: 'toggle', description: 'A slim row of your bookmarks under the address bar.' },
  // ---- Tabs
  { key: 'tabs.temporaryMinutes', category: 'Tabs', title: 'Temporary tabs close after (minutes)', ...num({ min: 1, max: 1440 }), description: 'Temporary tabs (Ctrl+Alt+T) leave no history and close themselves after this long without being used.' },
  { key: 'tabs.closeWindowOnLastTab', category: 'Tabs', title: 'Close window with its last tab', type: 'toggle', description: 'Off: closing the last tab leaves a fresh new-tab page instead of closing the window.' },
  { key: 'performance.idleAfterMinutes', category: 'Tabs', title: 'Mark background tabs idle after (minutes)', ...num({ min: 0, max: 1440 }), description: 'Stage 1. Idle tabs keep running but are throttled by the engine. 0 disables the stage.' },
  { key: 'performance.freezeAfterMinutes', category: 'Tabs', title: 'Freeze background tabs after (minutes)', ...num({ min: 0, max: 1440 }), description: 'Stage 2. Frozen tabs stop running JavaScript and timers but stay in memory, so they resume instantly. 0 never freezes.' },
  { key: 'performance.suspendAfterMinutes', category: 'Tabs', title: 'Suspend background tabs after (minutes)', ...num({ min: 0, max: 10080 }), description: 'Stage 3. Suspended tabs release their renderer process and keep their URL, back/forward history and scroll position. 0 never suspends.' },
  { key: 'performance.discardAfterMinutes', category: 'Tabs', title: 'Discard background tabs after (minutes)', ...num({ min: 0, max: 100000 }), description: 'Stage 4, only with the “Automatic tab discarding” flag. Discarded tabs keep only their URL and title. 0 never discards.' },
  // ---- Privacy
  { key: 'privacy.adblock', category: 'Privacy', title: 'Block ads', type: 'toggle', description: 'Stops advertising requests before they leave your computer.' },
  { key: 'privacy.trackers', category: 'Privacy', title: 'Block trackers', type: 'toggle', description: 'Blocks analytics, tracking pixels, session-replay and fingerprinting scripts.' },
  { key: 'privacy.cosmetic', category: 'Privacy', title: 'Hide cookie banners and empty ad slots', type: 'toggle', description: 'Cleans up consent pop-ups and the blank boxes left by blocked ads.' },
  { key: 'privacy.thirdPartyCookies', category: 'Privacy', title: 'Block third-party cookies', type: 'toggle', description: 'Cross-site cookies are never sent or stored. Storage is also partitioned per site by the engine.' },
  { key: 'privacy.fingerprint', category: 'Privacy', title: 'Fingerprinting resistance', type: 'toggle', description: 'Adds per-site noise to canvas, WebGL and audio readbacks and reports common values for hardware details. It lowers uniqueness instead of faking an identity.' },
  { key: 'privacy.stripTrackingParams', category: 'Privacy', title: 'Remove tracking parameters from links', type: 'toggle', description: 'utm_*, fbclid, gclid, msclkid and about fifty others are removed from every navigation.' },
  { key: 'privacy.gpc', category: 'Privacy', title: 'Send Global Privacy Control', type: 'toggle', description: 'Tells sites not to sell or share your data.' },
  { key: 'privacy.referrer', category: 'Privacy', title: 'Referrer for cross-site requests', type: 'select', options: [['origin', 'Only the site name'], ['none', 'Nothing'], ['full', 'Full address (browser default)']], description: 'What the next site learns about where you came from.' },
  { key: 'privacy.webrtc', category: 'Privacy', title: 'WebRTC IP handling', type: 'select', options: [['public-only', 'Hide local addresses (recommended)'], ['strict', 'Strict — only through a proxy (may break calls)'], ['default', 'Browser default']], description: 'Stops video-call APIs revealing your local network address.' },
  { key: 'privacy.spoofLanguage', category: 'Privacy', title: 'Report a generic language (en-US)', type: 'toggle', description: 'Makes you look like many other users. Sites may show English.' },
  { key: 'privacy.clearOnExit.history', category: 'Privacy', title: 'On exit, clear browsing history', type: 'toggle', description: 'Runs when Nevix quits normally.' },
  { key: 'privacy.clearOnExit.cookies', category: 'Privacy', title: 'On exit, clear cookies and site data', type: 'toggle', description: 'You will be signed out of sites each time.' },
  { key: 'privacy.clearOnExit.cache', category: 'Privacy', title: 'On exit, clear cached files', type: 'toggle', description: 'Frees disk space; pages load slower next time.' },
  { key: 'privacy.clearOnExit.downloads', category: 'Privacy', title: 'On exit, clear the download list', type: 'toggle', description: 'Only the list is cleared — downloaded files are never touched.' },
  { type: 'link', category: 'Privacy', title: 'Privacy dashboard', href: 'nevix://privacy', label: 'Open', description: 'See, per website, what was blocked or isolated and why.' },
  { type: 'link', category: 'Privacy', title: 'Site permissions', href: 'nevix://permissions', label: 'Open', description: 'Camera, microphone, location, notifications and more — per website.' },
  { type: 'action', action: 'clear-data', category: 'Privacy', title: 'Clear browsing data', label: 'Clear…', danger: true, description: 'Remove history, cookies and site data, cache or the download list.' },
  // ---- Security
  { key: 'privacy.httpsOnly', category: 'Security', title: 'HTTPS-only mode', type: 'toggle', description: 'Upgrades every http:// request to https://. If a site has no HTTPS you see a warning before anything is sent unencrypted.' },
  { key: 'security.dangerousDownloadWarnings', category: 'Security', title: 'Warn about dangerous downloads', type: 'toggle', description: 'Programs, scripts and risky archive types require confirmation before they open. Files are never sent anywhere for scanning.' },
  { key: 'security.permissionAbuseProtection', category: 'Security', title: 'Stop repeated permission prompts', type: 'toggle', description: 'After a site has been refused three times in a session it is blocked quietly.' },
  { type: 'info', category: 'Security', title: 'Built into the engine', description: 'Site isolation and process sandboxing (every tab runs in a sandboxed renderer), mixed-content blocking, certificate validation (errors are never silently bypassed), pop-up control and redirect-loop protection are always on and have no switch.' },
  // ---- Performance
  { key: 'performance.hardwareAcceleration', category: 'Performance', title: 'Use hardware acceleration', type: 'toggle', restart: true, description: 'Uses the GPU for rendering. Turn off if you see glitches or a blank window. Takes effect after a restart.' },
  { type: 'link', category: 'Performance', title: 'Performance center', href: 'nevix://performance', label: 'Open', description: 'Memory, CPU and processes — and what is using them.' },
  { type: 'info', category: 'Performance', title: 'Tab stages', description: 'Active → Idle → Frozen → Suspended → Discarded. Configure the delays under Tabs. Tabs that are playing audio, loading, using the camera or microphone, or have developer tools open are never touched.' },
  // ---- Network
  { key: 'privacy.doh', category: 'Network', title: 'Secure DNS', type: 'select', options: [['off', 'Off (system DNS)'], ['automatic', 'Automatic (fall back to system DNS)'], ['secure', 'Always (strict)']], description: 'Encrypts the lookups that reveal which sites you visit.' },
  { key: 'privacy.dohServer', category: 'Network', title: 'DNS-over-HTTPS server', type: 'text', placeholder: 'https://cloudflare-dns.com/dns-query', description: 'Used when Secure DNS is on.' },
  { key: 'privacy.proxy', category: 'Network', title: 'Proxy', type: 'text', placeholder: 'socks5://127.0.0.1:9050', description: 'Route all traffic through a proxy, e.g. a local Tor client. Leave empty to use system settings.' },
  { type: 'link', category: 'Network', title: 'Network & filters', href: 'nevix://network', label: 'Open', description: 'Filter lists, your own rules, per-site exceptions and a live request monitor.' },
  // ---- Downloads
  { key: 'general.downloadDir', category: 'Downloads', title: 'Save files to', type: 'folder', description: 'Empty uses your system Downloads folder.' },
  { key: 'general.askDownloadLocation', category: 'Downloads', title: 'Ask where to save each file', type: 'toggle', description: 'Shows a save dialog for every download.' },
  { key: 'downloads.maxConcurrent', category: 'Downloads', title: 'Simultaneous downloads', ...num({ min: 1, max: 10 }), description: 'Additional downloads wait in a queue.' },
  { type: 'link', category: 'Downloads', title: 'Download manager', href: 'nevix://downloads', label: 'Open', description: 'Queue, pause, resume, retry and search your downloads.' },
  // ---- Extensions
  { key: 'extensions.enabled', category: 'Extensions', title: 'Allow extensions', type: 'toggle', restart: true, description: 'Loads the extension system the first time it is needed. Extensions never get access you did not allow.' },
  { type: 'link', category: 'Extensions', title: 'Manage extensions', href: 'nevix://extensions', label: 'Open', description: 'Install unpacked extensions, review their permissions and restrict sites.' },
  // ---- Shortcuts
  { type: 'shortcuts', category: 'Shortcuts', title: 'Keyboard shortcuts', description: 'Search, rebind or reset any shortcut.' },
  // ---- Search
  { key: 'general.searchEngine', category: 'Search', title: 'Search engine', type: 'select', options: engines, description: 'Nothing is sent to a search engine until you press Enter. Suggestions come from your own history and bookmarks.' },
  { key: 'general.customSearchUrl', category: 'Search', title: 'Custom search URL', type: 'text', placeholder: 'https://searx.example/search?q=%s', description: 'Used when the search engine is “Custom”. %s is replaced by the query.' },
  // ---- Sync
  { type: 'backup', category: 'Sync', title: 'Encrypted backup & transfer', description: 'Nevix has no cloud account and no sync servers. To move your data between devices, export an encrypted file (AES-256-GCM, key derived from your passphrase with scrypt), carry it however you like, and import it on the other side. Only someone with the passphrase can read it.' },
  // ---- Developer
  { key: 'developer.devtoolsDock', category: 'Developer', title: 'Developer tools position', type: 'select', options: [['right', 'Right'], ['bottom', 'Bottom'], ['undocked', 'Separate window']], description: 'The full Chromium developer tools — Elements, Console, Network, Sources, Application, Performance, Memory, Security, Lighthouse — open with F12.' },
  { type: 'link', category: 'Developer', title: 'Nevix diagnostics', href: 'nevix://diagnostics', label: 'Open', description: 'Per-request view of blocked requests, privacy modifications, DNS method, HTTP protocol, TLS and cache behaviour.' },
  // ---- Flags
  { type: 'link', category: 'Flags', title: 'Experimental flags', href: 'nevix://flags', label: 'Open', description: 'Real, optional features that are not on by default. Every flag can be reset, and Nevix starts normally with --safe-mode if one misbehaves.' },
  // ---- Advanced
  { key: 'advanced.crashReports', category: 'Advanced', title: 'Save crash reports on this computer', type: 'toggle', restart: true, description: 'When on, a crash writes a minidump into your profile folder. Reports are NEVER uploaded; they only exist so you can inspect or share them yourself. Contains process memory fragments, so share carefully.' },
  { type: 'action', action: 'open-profile', category: 'Advanced', title: 'Profile folder', label: 'Show in folder', description: 'Where Nevix keeps your settings, history and bookmarks — plain files you can read, back up or delete.' },
  { type: 'action', action: 'reset-settings', category: 'Advanced', title: 'Reset all settings', label: 'Reset…', danger: true, description: 'Restores every setting above to its default. Bookmarks, history and flags are not touched.' },
  { type: 'link', category: 'Advanced', title: 'About Nevix', href: 'nevix://about', label: 'Open', description: 'Version, engine, profile location and the privacy promise.' },
];

const getDefault = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), SETTINGS);

module.exports = { SCHEMA, CATEGORIES, getDefault };
