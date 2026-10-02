# Nevix

**A fast, private, bloat-free browser.** Real Chromium underneath, a hand-written interface and privacy engine on top — no accounts, no sync servers, no telemetry, no sponsored tiles, no frameworks.

```
npm install
npm start
```

## Why Nevix

| | |
|---|---|
| **Private by default** | Ad & tracker blocking, HTTPS-only, third-party cookie blocking, fingerprint noise, tracking-parameter stripping, GPC, referrer trimming, WebRTC leak protection and DNS-over-HTTPS are all on out of the box. |
| **Nothing phones home** | Every Chromium call-home service (sync, safe-browsing pings, component updates, translate, metrics, Privacy Sandbox, spell-check dictionaries…) is disabled. Address-bar suggestions are computed locally. |
| **Fast & light** | about 3,500 lines of first-party code and no UI framework or runtime dependencies, idle tabs sleep automatically, back/forward cache and parallel downloads enabled, ad/tracker requests die before they hit the network. |
| **Feels modern** | Vertical or horizontal tabs, a <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> command palette, floating-card layout, instant dark/light theming, accent colours, split-second new-tab page. |

## Features

**Shields (per-site toggle, live counters)**
- Ads & trackers blocked at the network layer using a bundled list (Peter Lowe's list + curated Nevix rules, ~3,600 rules) — optionally add EasyList, EasyPrivacy, StevenBlack hosts or uBlock Privacy (downloaded only if you enable them)
- Cosmetic cleanup of cookie banners and empty ad slots (and un-freezes scroll-locked pages)
- HTTPS-only mode with a clear interstitial when a site has no HTTPS
- Third-party cookies never sent, never stored (headers *and* `document.cookie` in third-party frames)
- Fingerprint protection: per-site seeded noise for canvas / WebGL readback / audio, masked GPU strings, generic hardware & battery & connection info, rounded screen size, reduced-entropy client hints, coarse timers — stable within a site, unlinkable across sites
- Tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, …) stripped from every navigation; **Copy clean link**
- Cross-site `Referer` cut to the origin (or nothing), `Sec-GPC: 1`
- WebRTC only exposes your public IP (or nothing in strict mode)
- Secure DNS (DoH) with configurable server; optional SOCKS/HTTP proxy (e.g. Tor at `socks5://127.0.0.1:9050`)

**Browsing**
- Tabs: pin, mute, duplicate, drag to reorder, reopen closed, auto-sleep, **isolated tabs** (own cookies/storage, wiped on close), **private windows** (in-memory profile, nothing recorded)
- Vertical tab sidebar (collapsible) or classic strip
- Smart address bar: URL/search detection, keyword shortcuts (`w`, `yt`, `gh`, `mdn`, `npm`, `so`, `ddg`, …), local suggestions from tabs / bookmarks / history
- Command palette, find in page, per-site zoom, reader mode, screenshot, save as PDF, print, view source, DevTools
- Bookmarks bar + manager (HTML import/export), history manager, download manager (pause/resume, never overwrites)
- Permissions asked inline (camera, mic, location, clipboard), remembered per site; notifications, USB/HID/serial/Bluetooth denied by default
- Popup/OAuth windows keep their opener but get the same shields; mailto/tel need confirmation; web pages can never navigate to `nevix://` or `file://`
- Session restore, clear-on-exit, clear-data dialog, fully offline settings UI

## Keyboard

| | |
|---|---|
| Command palette | <kbd>Ctrl/⌘ K</kbd> |
| New tab / window / private / isolated | <kbd>T</kbd> · <kbd>N</kbd> · <kbd>⇧N</kbd> · <kbd>⌥N</kbd> |
| Close / reopen tab | <kbd>W</kbd> · <kbd>⇧T</kbd> |
| Address bar · Find · Bookmark | <kbd>L</kbd> · <kbd>F</kbd> · <kbd>D</kbd> |
| Vertical tabs · Reader · Screenshot | <kbd>⇧E</kbd> · <kbd>⌥R</kbd> · <kbd>⇧S</kbd> |
| History · Downloads · Settings | <kbd>H</kbd>/<kbd>Y</kbd> · <kbd>J</kbd> · <kbd>,</kbd> |
| Next/prev tab · tab 1-9 | <kbd>Ctrl Tab</kbd> / <kbd>Ctrl ⇧ Tab</kbd> · <kbd>1</kbd>…<kbd>9</kbd> |

(Modifier is <kbd>⌘</kbd> on macOS, <kbd>Ctrl</kbd> elsewhere. Full list in Settings → Shortcuts.)

## Build installers

```
npm run dist         # AppImage + deb on Linux, nsis + portable on Windows, dmg + zip on macOS
npm run dist:dir     # unpacked app only
```

Tag `v*` to have GitHub Actions build all three platforms.

## Develop & test

```
npm start            # run
npm test             # unit tests (blocker, URL cleaning, omnibox, storage…)
npm run test:e2e     # ~100 end-to-end checks driving the real app under Xvfb (Linux, needs root for :80)
```

Layout:

```
src/main/      app lifecycle, windows & tabs, privacy engine, blocker, storage, downloads, permissions
src/preload/   page.js (fingerprint shield + cosmetic filter + nevix:// API), ui.js
src/ui/        browser chrome (vanilla JS/CSS)
src/pages/     nevix://newtab, settings, history, bookmarks, downloads, error, auth
```

User data lives in the platform's standard app-data folder (`Nevix`): plain JSON files you can read, back up or delete.

## Honest limitations

- Nevix reuses Chromium via Electron: you get a modern engine and Chromium's security model, but security updates arrive when Electron is bumped — keep Nevix up to date.
- No extension support, no sync, no password manager (by design: smaller attack surface, nothing to leak).
- No Widevine, so DRM streaming (Netflix, Disney+, Spotify web) won't play.
- Fingerprint resistance is best-effort noise and normalisation, not Tor Browser-grade uniformity; it won't defeat a determined, targeted adversary.
- HTTP/3 and other transport details follow Chromium defaults.

## License

MIT
