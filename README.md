# Nevix

A fast, private, minimal desktop browser. Chromium (via Electron) underneath; the interface, privacy engine, tab lifecycle, permissions, downloads and `nevix://` pages are first-party code. No accounts, no telemetry, no ads, no sponsored content.

```
npm install
npm start              # run
npm test               # unit tests (plain node)
npm run test:e2e       # end-to-end tests in the real app (Linux: needs xvfb, imagemagick, root for port 80)
npm run dist           # installers for the current OS (electron-builder)
```

## What is in it

- **Privacy engine** – token-indexed filter engine (ABP-compatible lists + custom `block:`/`allow:`/`isolate:` rules, per-site and temporary exceptions), third-party cookie stripping, tracking-parameter removal, bounce-tracking cleanup, referrer reduction, GPC, HTTPS-only with interstitial, DNS-over-HTTPS, WebRTC policy, per-site seeded canvas/WebGL/audio/font noise and normalized navigator/screen values. `nevix://privacy` shows what was blocked per site and *why* (list, rule, category); `nevix://network` streams requests live.
- **Zero telemetry** – Chromium call-home features are disabled, crash reports are off, no update pings. Nothing is uploaded unless you explicitly export a file or use an encrypted backup yourself.
- **Tab lifecycle** – Active → Idle → Frozen → Suspended → Discarded, all thresholds configurable, one armed timer (no polling). Audible, pinned and form-dirty tabs are protected. Optional renderer prewarm and memory-pressure handling (flags).
- **`nevix://performance`** – real numbers from Electron/OS APIs: startup stages, browser/renderer/GPU memory and CPU, per-tab processes and lifecycle stage, extension overhead, cache size, and a "What's using resources?" list with actions. A built-in benchmark runs real measurements (cold/warm start, new tab, navigation, memory at 1/10/25 tabs, idle/active CPU, network latency). Results are only ever what the machine measured.
- **Permissions** – one manager (`nevix://permissions`): camera, microphone, location, notifications, clipboard, pop-ups, downloads, autoplay, Bluetooth, USB, sensors, MIDI; Allow / Allow once / Ask / Block per origin, plus "forget this site" (permissions, cookies, storage, cache).
- **Tabs & workspaces** – groups (colours, collapse, save/restore), vertical or horizontal tabs, pinned, multi-select, move between windows without reload, duplicate, reopen closed, search, saved workspaces and snapshots, crash-session recovery.
- **Command palette** (`Ctrl+Shift+P`) over a central command registry; all shortcuts are rebindable. The address bar answers calculations and unit conversions offline and searches tabs, history, bookmarks, workspaces, settings and commands locally.
- **Downloads** – queue with concurrency limit, pause/resume/retry, speed and ETA, source domain, duplicate-safe names, warnings for executable/double-extension/insecure files, per-site block policy.
- **Extensions** – load unpacked Chromium extensions through Electron's extension support (a subset of the Chrome API), with a permission list and per-site restriction. DevTools are intact; `nevix://diagnostics` records request protocol, cache behaviour, blocked/modified requests and DNS method for a tab.
- **Flags** – `nevix://flags` with stable IDs, defaults, restart indicators, reset, `--safe-mode`, and automatic disabling of experimental flags after crash loops.
- **Settings** – searchable, 15 categories, every setting with description, default and reset.
- **Portability** – encrypted local backup (scrypt + AES-256-GCM), import of bookmarks/history from Chromium-family browsers and Firefox. Sync is not implemented; the data model is local-first.

## Design

Flat, dark, monospace-accented. Everything reads from design tokens in `src/main/theme.js` (served as `nevix://res/tokens.css`): primary `#9D64A3`, background `#1F171D`; dark red `#783124` is used only for danger/blocking/destructive actions.

## Windows

`npm run dist` on Windows (CI does this on `windows-latest`) produces `Nevix-Setup.exe` (NSIS: choose install directory, Start Menu and Desktop shortcuts, launch after install, uninstaller, registers Nevix in Windows *Default apps* for http/https/.html/.htm/.xhtml/.pdf, offers a one-time data import on first launch) and `Nevix-Portable.exe` (profile stored in `NevixData` beside the executable). No services, scheduled tasks or startup entries are installed. Windows does not let installers force a default browser; choose Nevix in Settings → Default apps.

## Honest limits

- It is Chromium: it does not make you anonymous. Fingerprint mitigations add per-site noise and normalize values; they reduce, not eliminate, fingerprinting. Use Tor Browser when anonymity matters.
- Extension support is Electron's subset of Chrome's API; many extensions will not work.
- Chromium security updates arrive by bumping the Electron version; Nevix has no auto-updater.
- The Windows installer, uninstaller and portable build are verified by the CI workflow, not locally in development (Linux sandbox without Windows). macOS and Linux packages are configured but less tested.
- The shipped blocklists are small (bundled core rules + Peter Lowe's list); larger lists are optional downloads you enable yourself.
