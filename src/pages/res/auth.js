'use strict';
(() => {
  const { $, el, call } = NX;
  const q = new URLSearchParams(location.search);
  const id = q.get('id');
  const user = el('input', { type: 'text', placeholder: 'Username', autofocus: true });
  const pass = el('input', { type: 'text', placeholder: 'Password', style: '-webkit-text-security:disc' });
  const submit = () => call('auth:submit', { id, user: user.value, pass: pass.value });
  for (const i of [user, pass]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  const root = $('#root');
  root.style.cssText = 'padding:26px 28px;max-width:none';
  root.append(el('h1', { style: 'font-size:18px' }, 'Sign in'),
    el('p', { class: 'dim', style: 'margin:6px 0 16px' }, (q.get('proxy') ? 'Proxy ' : '') + q.get('host') + (q.get('realm') ? ' says: “' + q.get('realm') + '”' : '')),
    el('div', { style: 'display:grid;gap:10px' }, user, pass),
    el('div', { style: 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px' }, el('button', { class: 'btn', onclick: () => call('auth:submit', { id, cancel: true }) }, 'Cancel'), el('button', { class: 'btn primary', onclick: submit }, 'Sign in')));
})();
