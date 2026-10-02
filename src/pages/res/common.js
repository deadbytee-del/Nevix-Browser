'use strict';
// Helpers shared by every nevix:// page (no framework: a tiny DOM builder and a few formatters).
(() => {
  // DOM insertion helpers stringify null/false; make them skip empty children instead (lets pages use `cond ? node : null`).
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const orig = Element.prototype[m];
    Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false)); };
  }
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = !!v;
      else if (v !== undefined && v !== false && v !== null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const fav = (url) => { const h = hostOf(url); return el('span', { class: 'fav' }, (h[0] || '•').toUpperCase()); };
  const PATHS = {
    shield: 'M12 21s8-3.5 8-10V5.5L12 3 4 5.5V11c0 6.5 8 10 8 10z', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z', download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
    x: 'M18 6L6 18M6 6l12 12', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    warn: 'M12 4l9 16H3zM12 10v4M12 17h.01', reset: 'M4 12a8 8 0 1 1 2.3 5.7M4 18v-5h5', check: 'M5 12.5l4.5 4.5L19 7.5',
  };
  const icon = (n) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('style', 'width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;vertical-align:-3px');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', PATHS[n] || PATHS.globe); s.append(p); return s;
  };
  const num = (n) => (n || 0).toLocaleString();
  const bytes = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(n >= 1e8 ? 0 : 1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B');
  const dur = (s) => (s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm' : s >= 60 ? Math.round(s / 60) + ' min' : Math.round(s) + ' s');
  const ago = (t) => { const d = (Date.now() - t) / 1000; return d < 60 ? 'just now' : d < 3600 ? Math.round(d / 60) + ' min ago' : d < 86400 ? Math.round(d / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };
  const call = (c, a) => window.nevix.call(c, a);

  let toastTimer;
  const toast = (msg, danger) => {
    let t = $('.toast');
    if (!t) { t = el('div', { class: 'toast' }); document.body.append(t); }
    t.textContent = msg; t.classList.toggle('danger', !!danger); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  };

  /** In-page confirmation dialog (native dialogs are suppressed on internal pages). */
  const confirmDialog = (title, text, { danger = false, ok = 'Confirm' } = {}) => new Promise((resolve) => {
    const done = (v) => { b.remove(); resolve(v); };
    const b = el('div', { class: 'dialog-backdrop', onclick: (e) => { if (e.target === b) done(false); } },
      el('div', { class: 'dialog' }, el('h3', {}, title), el('p', { class: 'dim' }, text),
        el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, ok))));
    document.body.append(b);
  });

  /** Text-input dialog. */
  const askText = (title, label, value = '', { ok = 'Save', type = 'text' } = {}) => new Promise((resolve) => {
    const input = el('input', { type, value, placeholder: label, style: 'width:100%;margin-top:10px' });
    const done = (v) => { b.remove(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); });
    const b = el('div', { class: 'dialog-backdrop' }, el('div', { class: 'dialog' }, el('h3', {}, title), input,
      el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'), el('button', { class: 'btn primary', onclick: () => done(input.value) }, ok))));
    document.body.append(b); setTimeout(() => input.focus(), 20);
  });

  const header = (title, sub, ...right) => [el('header', {}, el('h1', {}, title), el('span', { class: 'spacer' }), ...right), sub ? el('p', { class: 'sub' }, sub) : null];

  // Accent override from settings (the palette itself comes from tokens.css).
  call('settings:get').then((s) => { if (s.general.accent) document.documentElement.style.setProperty('--color-primary', s.general.accent); }).catch(() => {});
  window.NX = { $, el, hostOf, fav, icon, num, bytes, dur, ago, call, toast, confirmDialog, askText, header };
})();
