'use strict';
// Runs in every frame of every tab (sandboxed). Applies fingerprint resistance in the page's
// main world before any page script, hides ad/cookie-banner clutter, and — only for nevix:// pages —
// exposes the internal API.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

let cfg = { fp: false, strictFp: false, cosmetic: false, seed: 1, lang: false, thirdPartyCookies: false, autoplay: 'allow', popups: 'allow' };
try { cfg = ipcRenderer.sendSync('nevix:page-config', location.href); } catch {}

if (location.protocol === 'nevix:') {
  const call = (cmd, arg) => ipcRenderer.invoke('nevix:internal', cmd, arg);
  contextBridge.exposeInMainWorld('nevix', {
    call,
    onChange(fn) { ipcRenderer.on('nevix:changed', (_e, topic) => fn(topic)); },
  });
}

// A page tried window.open() without a user gesture (reported by the main-world shim below).
document.addEventListener('__nevix_popup_blocked', () => { try { ipcRenderer.send('nevix:popup-blocked', location.href); } catch {} });

if (/^https?:|^file:|^about:/.test(location.protocol) && (cfg.fp || cfg.thirdPartyCookies || cfg.autoplay !== 'allow' || cfg.popups !== 'allow')) {
  contextBridge.executeInMainWorld({
    args: [{ seed: cfg.seed, lang: cfg.lang, blockCookies: cfg.thirdPartyCookies, fp: cfg.fp, strict: cfg.strictFp, autoplay: cfg.autoplay, popups: cfg.popups }],
    func: function fingerprintShield(opts) {
      'use strict';
      // ---- helpers -------------------------------------------------------------------------
      const nativeSrc = new WeakMap();
      const origToString = Function.prototype.toString;
      const fakeToString = function toString() {
        return nativeSrc.has(this) ? nativeSrc.get(this) : origToString.call(this);
      };
      nativeSrc.set(fakeToString, 'function toString() { [native code] }');
      Function.prototype.toString = fakeToString;
      const mark = (fn, name) => { nativeSrc.set(fn, `function ${name}() { [native code] }`); return fn; };
      const define = (obj, prop, getter) => {
        try {
          Object.defineProperty(obj, prop, { get: mark(getter, 'get ' + prop), configurable: true, enumerable: true });
        } catch {}
      };
      const wrap = (proto, name, make) => {
        try {
          const orig = proto[name];
          if (typeof orig !== 'function') return;
          const w = make(orig);
          mark(w, name);
          Object.defineProperty(proto, name, { value: w, configurable: true, writable: true, enumerable: false });
        } catch {}
      };
      // Small seeded PRNG (mulberry32) — stable per site per browser session, unlinkable across sites.
      let s = opts.seed >>> 0;
      const rnd = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      if (opts.fp) {
      // ---- canvas --------------------------------------------------------------------------
      const noiseImage = (img) => {
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          if (rnd() < 0.08) { // ~8% of pixels get ±1 on one channel — invisible, but changes the hash
            const c = (rnd() * 3) | 0;
            d[i + c] = Math.max(0, Math.min(255, d[i + c] + (rnd() < 0.5 ? -1 : 1)));
          }
        }
        return img;
      };
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      wrap(CanvasRenderingContext2D.prototype, 'getImageData', (orig) => function getImageData(...a) {
        return noiseImage(orig.apply(this, a));
      });
      const noisyCopy = (canvas) => {
        try {
          if (!canvas.width || !canvas.height) return canvas;
          const c = document.createElement('canvas');
          c.width = canvas.width; c.height = canvas.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(canvas, 0, 0);
          const img = origGetImageData.call(ctx, 0, 0, c.width, c.height);
          noiseImage(img);
          ctx.putImageData(img, 0, 0);
          return c;
        } catch { return canvas; }
      };
      wrap(HTMLCanvasElement.prototype, 'toDataURL', (orig) => function toDataURL(...a) {
        return orig.apply(noisyCopy(this), a);
      });
      wrap(HTMLCanvasElement.prototype, 'toBlob', (orig) => function toBlob(...a) {
        return orig.apply(noisyCopy(this), a);
      });
      if (window.OffscreenCanvasRenderingContext2D) {
        wrap(OffscreenCanvasRenderingContext2D.prototype, 'getImageData', (orig) => function getImageData(...a) {
          return noiseImage(orig.apply(this, a));
        });
      }

      // ---- WebGL ---------------------------------------------------------------------------
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        wrap(C.prototype, 'getParameter', (orig) => function getParameter(p) {
          if (p === 0x9245) return 'Google Inc.';              // UNMASKED_VENDOR_WEBGL
          if (p === 0x9246) return 'ANGLE (Generic Renderer)'; // UNMASKED_RENDERER_WEBGL
          return orig.call(this, p);
        });
        wrap(C.prototype, 'getSupportedExtensions', (orig) => function getSupportedExtensions() {
          const e = orig.call(this);
          return e ? e.filter((x) => x !== 'WEBGL_debug_renderer_info') : e;
        });
        wrap(C.prototype, 'readPixels', (orig) => function readPixels(...a) {
          const r = orig.apply(this, a);
          const buf = a[6];
          if (buf && buf.length) for (let i = 0; i < buf.length; i += 53) buf[i] ^= rnd() < 0.5 ? 1 : 0;
          return r;
        });
      }

      // ---- audio ---------------------------------------------------------------------------
      if (window.AudioBuffer) {
        const seen = new WeakSet();
        wrap(AudioBuffer.prototype, 'getChannelData', (orig) => function getChannelData(ch) {
          const data = orig.call(this, ch);
          if (!seen.has(data)) {
            seen.add(data);
            for (let i = 0; i < data.length; i += 97) data[i] += (rnd() - 0.5) * 1e-7;
          }
          return data;
        });
      }
      if (window.AnalyserNode) {
        wrap(AnalyserNode.prototype, 'getFloatFrequencyData', (orig) => function getFloatFrequencyData(arr) {
          orig.call(this, arr);
          for (let i = 0; i < arr.length; i += 7) arr[i] += (rnd() - 0.5) * 1e-3;
        });
      }

      // ---- navigator / screen --------------------------------------------------------------
      const nav = Navigator.prototype;
      define(nav, 'hardwareConcurrency', () => 4);
      define(nav, 'deviceMemory', () => 8);
      define(nav, 'maxTouchPoints', () => 0);
      if (opts.lang) {
        define(nav, 'languages', () => Object.freeze(['en-US', 'en']));
        define(nav, 'language', () => 'en-US');
      }
      if ('getBattery' in nav) define(nav, 'getBattery', () => undefined);
      if ('connection' in nav) {
        define(nav, 'connection', () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false,
          addEventListener() {}, removeEventListener() {} }));
      }
      if (window.NavigatorUAData) {
        wrap(NavigatorUAData.prototype, 'getHighEntropyValues', (orig) => function getHighEntropyValues(hints) {
          return orig.call(this, []).then((low) => low);
        });
      }
      const round = (v) => Math.round(v / 100) * 100 || v;
      for (const prop of ['width', 'height', 'availWidth', 'availHeight']) {
        const desc = Object.getOwnPropertyDescriptor(Screen.prototype, prop);
        if (!desc || !desc.get) continue;
        const real = desc.get;
        define(Screen.prototype, prop, function () { return round(real.call(this)); });
      }
      define(Screen.prototype, 'colorDepth', () => 24);
      define(Screen.prototype, 'pixelDepth', () => 24);

      // ---- timers --------------------------------------------------------------------------
      wrap(Performance.prototype, 'now', (orig) => function now() { return Math.round(orig.call(this) * 10) / 10; });


      // ---- font probing & strict-mode extras ---------------------------------------------------------
      if (window.queryLocalFonts) {
        wrap(window, 'queryLocalFonts', () => function queryLocalFonts() { return Promise.reject(new DOMException('Local font access is not permitted.', 'NotAllowedError')); });
      }
      wrap(CanvasRenderingContext2D.prototype, 'measureText', (orig) => function measureText(...a) {
        const m = orig.apply(this, a);
        const k = opts.strict ? 0.0004 : 0.00008;       // relative noise: invisible to layout, enough to blur width-based font probing
        const f = 1 + (rnd() - 0.5) * k;
        const w = m.width * f;
        try { Object.defineProperty(m, 'width', { value: w }); } catch {}
        return m;
      });
      if (opts.strict) {
        const round2 = (v) => Math.round(v / 100) * 100 || v;
        define(window, 'outerWidth', () => window.innerWidth);
        define(window, 'outerHeight', () => window.innerHeight);
        define(Screen.prototype, 'availWidth', () => round2(window.innerWidth));
        define(Screen.prototype, 'availHeight', () => round2(window.innerHeight));
        define(nav, 'plugins', () => Object.freeze([]));
        define(nav, 'mimeTypes', () => Object.freeze([]));
        if (window.speechSynthesis) wrap(SpeechSynthesis.prototype, 'getVoices', () => function getVoices() { return []; });
        if (document.fonts && document.fonts.check) wrap(FontFaceSet.prototype, 'check', () => function check() { return true; });
        wrap(Performance.prototype, 'now', (orig) => function now() { return Math.round(orig.call(this) * 0.01) / 0.01 * 1; });
        if (window.Date) { /* timers are coarsened via performance.now above; Date stays exact for sites that need it */ }
      }
      }

      // ---- per-site autoplay & pop-up policy (set from the site's permissions) ---------------------------
      const activated = () => { try { return navigator.userActivation.hasBeenActive; } catch { return true; } };
      if (opts.autoplay !== 'allow') {
        wrap(HTMLMediaElement.prototype, 'play', (orig) => function play(...a) {
          if (!activated() && !this.muted) return Promise.reject(new DOMException('play() failed because the user didn\'t interact with the document first.', 'NotAllowedError'));
          return orig.apply(this, a);
        });
        document.addEventListener('play', (e) => {
          const el = e.target;
          if (el && el.pause && !activated() && !el.muted) { try { el.pause(); } catch {} }
        }, true);
        const AC = window.AudioContext;
        if (AC) {
          const Wrapped = function AudioContext(...a) {
            const ctx = new AC(...a);
            if (!activated()) {
              try { ctx.suspend(); } catch {}
              const go = () => { try { ctx.resume(); } catch {} };
              for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, go, { once: true, capture: true });
            }
            return ctx;
          };
          Wrapped.prototype = AC.prototype;
          mark(Wrapped, 'AudioContext');
          try { Object.defineProperty(window, 'AudioContext', { value: Wrapped, configurable: true, writable: true }); } catch {}
        }
      }
      if (opts.popups !== 'allow') {
        wrap(window, 'open', (orig) => function open(...a) {
          let active = true;
          try { active = navigator.userActivation.isActive; } catch {}
          if (!active) { try { document.dispatchEvent(new CustomEvent('__nevix_popup_blocked')); } catch {} return null; }
          return orig.apply(this, a);
        });
      }

      // ---- third-party cookie access via script ---------------------------------------------
      if (opts.blockCookies && window.top !== window) {
        let thirdParty = false;
        try {
          const anc = location.ancestorOrigins;
          const top = anc && anc.length ? anc[anc.length - 1] : '';
          const base = (h) => h.split('.').slice(-2).join('.');
          thirdParty = !!top && base(new URL(top).hostname) !== base(location.hostname);
        } catch {}
        if (thirdParty) {
          try {
            Object.defineProperty(Document.prototype, 'cookie', {
              get: mark(function () { return ''; }, 'get cookie'),
              set: mark(function (v) {}, 'set cookie'),
              configurable: true,
            });
          } catch {}
        }
      }
    },
  });
}

// ---- cosmetic filtering ----------------------------------------------------------------------
if (cfg.cosmetic && /^https?:/.test(location.protocol)) {
  const css = `
    #onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay,
    .cc-window, .cc-banner, #cookie-law-info-bar, #cookie-notice, .cookie-notice, #cookieNotice, .cookie-banner,
    .cookie-consent, #cookie-consent, #cookieconsent, .cookieconsent, .cookie-bar, #cookie-bar, #gdpr-cookie-notice,
    .gdpr-banner, #gdpr-consent, .truste_overlay, .truste_box_overlay, #truste-consent-track, #didomi-host,
    #didomi-popup, .fc-consent-root, .fc-dialog-overlay, #qc-cmp2-container, [id^="sp_message_container"],
    .osano-cm-window, .osano-cm-dialog, #usercentrics-root, #cmpbox, #cmpbox2, .cmp-popup, .iubenda-cs-container,
    #iubenda-cs-banner, .evidon-banner, #_evidon_banner, .optanon-alert-box-wrapper, #sd-cmp, #cookiescript_injected,
    .klaro, #CookieBoxSaveButton, .cli-modal-backdrop, #cookiefirst-root, .termly-styles-root,
    ins.adsbygoogle, [id^="google_ads_iframe"], [id^="div-gpt-ad"], .adsbygoogle, .ad-slot, .ad-banner,
    .ad-container, .advert, .advertisement, [data-ad-slot], [data-google-query-id], .sponsored-post-label,
    #taboola-below-article-thumbnails, .trc_rbox_container, .OUTBRAIN, .ob-widget, .mgid-container,
    iframe[src*="doubleclick.net"], iframe[src*="googlesyndication"], .newsletter-popup-overlay
    { display: none !important; }
    html.nevix-unlock, html.nevix-unlock body { overflow: auto !important; }
  `;
  const inject = () => { try { webFrame.insertCSS(css, { cssOrigin: 'user' }); } catch {} };
  inject();
  // Un-freeze pages whose cookie banner locked scrolling once we hid it.
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const b = document.body;
      if (b && getComputedStyle(b).overflow === 'hidden' &&
          document.querySelector('#onetrust-consent-sdk, #CybotCookiebotDialog, #didomi-host, .fc-consent-root, #qc-cmp2-container')) {
        document.documentElement.classList.add('nevix-unlock');
      }
    }, 800);
  });
}
