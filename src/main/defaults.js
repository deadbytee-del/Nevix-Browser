'use strict';

const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'ddg' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', keyword: 'br' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', keyword: 'sp' },
  mojeek: { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=%s', keyword: 'mj' },
  kagi: { name: 'Kagi', url: 'https://kagi.com/search?q=%s', keyword: 'kg' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: 'g' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s', keyword: 'b' },
  custom: { name: 'Custom', url: '', keyword: 'c' },
};

// Extra keyword shortcuts for the omnibox: type "w nevix" or "yt lofi".
const KEYWORDS = {
  w: 'https://en.wikipedia.org/w/index.php?search=%s',
  yt: 'https://www.youtube.com/results?search_query=%s',
  gh: 'https://github.com/search?q=%s',
  mdn: 'https://developer.mozilla.org/en-US/search?q=%s',
  npm: 'https://www.npmjs.com/search?q=%s',
  so: 'https://stackoverflow.com/search?q=%s',
  maps: 'https://www.openstreetmap.org/search?query=%s',
  imdb: 'https://www.imdb.com/find?q=%s',
  r: 'https://www.reddit.com/search/?q=%s',
};

const FILTER_LISTS = [
  { id: 'easylist', name: 'EasyList (ads)', url: 'https://easylist.to/easylist/easylist.txt', category: 'ads', enabled: false },
  { id: 'easyprivacy', name: 'EasyPrivacy (trackers)', url: 'https://easylist.to/easylist/easyprivacy.txt', category: 'trackers', enabled: false },
  { id: 'stevenblack', name: 'StevenBlack unified hosts', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts', category: 'trackers', enabled: false },
  { id: 'ublock-privacy', name: 'uBlock filters – Privacy', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt', category: 'trackers', enabled: false },
];

const SETTINGS = {
  version: 1,
  general: {
    searchEngine: 'duckduckgo',
    customSearchUrl: '',
    homepage: 'nevix://newtab',
    startup: 'newtab', // newtab | restore | homepage
    theme: 'system',   // system | dark | light
    accent: '#8b7cff',
    verticalTabs: false,
    sidebarCollapsed: false,
    bookmarksBar: true,
    tabSleepMinutes: 20,
    saveHistory: true,
    askDownloadLocation: false,
    downloadDir: '',
    spellcheck: false,
    restoreClosedTabs: true,
  },
  privacy: {
    adblock: true,
    trackers: true,
    cosmetic: true,
    httpsOnly: true,
    thirdPartyCookies: true,   // block third-party cookies
    fingerprint: true,
    stripTrackingParams: true,
    gpc: true,
    referrer: 'origin',        // full | origin | none  (applied to cross-site requests)
    webrtc: 'public-only',     // default | public-only | strict
    blockAutoplay: true,
    spoofLanguage: false,
    doh: 'automatic',          // off | automatic | secure
    dohServer: 'https://cloudflare-dns.com/dns-query',
    proxy: '',                 // e.g. socks5://127.0.0.1:9050 (Tor)
    clearOnExit: { history: false, cookies: false, cache: true, downloads: false },
    lists: FILTER_LISTS.map((l) => ({ id: l.id, enabled: l.enabled, updated: 0 })),
  },
  siteShields: {},     // registrable domain -> { off: true }
  sitePermissions: {}, // host -> { permission: 'allow'|'deny' }
  siteZoom: {},        // host -> zoom level
};

module.exports = { SETTINGS, SEARCH_ENGINES, KEYWORDS, FILTER_LISTS };
