'use strict';
(() => {
  const { $, el, call, icon } = NX;
  const q = new URLSearchParams(location.search);
  const type = q.get('type'), url = q.get('url') || '', desc = q.get('desc') || '', http = q.get('http') || '';
  let host = url; try { host = new URL(url).hostname; } catch {}
  const NAMES = { ERR_NAME_NOT_RESOLVED: 'We couldn’t find that site. Check the address for typos.', ERR_INTERNET_DISCONNECTED: 'You appear to be offline.', ERR_CONNECTION_REFUSED: 'The site refused the connection.', ERR_CONNECTION_TIMED_OUT: 'The site took too long to respond.', ERR_CONNECTION_RESET: 'The connection was reset.' };
  const title = type === 'https' ? 'No secure connection available' : type === 'cert' ? 'Your connection isn’t private' : type === 'crash' ? 'This page crashed' : 'Can’t reach this page';
  let body = NAMES[desc] || 'Something went wrong while loading ' + host + '.';
  if (type === 'https') body = `Nevix tried to open ${host} over HTTPS, but it isn’t available. Continuing would send your data unencrypted — anyone on the network could read it.`;
  if (type === 'cert') body = `The identity of ${host} couldn’t be verified (${desc}). Attackers might be trying to steal your information.`;
  document.title = title;
  const danger = type === 'https' || type === 'cert';
  const root = $('#root');
  root.style.cssText = 'max-width:600px;padding-top:12vh';
  const acts = [el('button', { class: 'btn primary', onclick: () => call('error:back') }, danger ? 'Back to safety' : 'Go back')];
  if (!danger) acts.unshift(el('button', { class: 'btn primary', onclick: () => call('error:retry', url) }, 'Try again'));
  if (!danger) acts[1].className = 'btn';
  const adv = [];
  if (danger) adv.push(el('button', { class: 'btn danger sm', onclick: () => call('error:proceed', { kind: type, url, http }) }, type === 'https' ? 'Continue to HTTP site (unsafe)' : 'Proceed to ' + host + ' (unsafe)'));
  root.append(el('div', { style: `color:var(--color-${danger ? 'danger-text' : 'text-secondary'});margin-bottom:14px;font-size:44px` }, icon(danger ? 'warn' : 'globe')),
    el('h1', {}, title), el('p', { class: 'dim', style: 'margin:10px 0 24px;font-size:15px' }, body),
    el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, acts), adv.length ? el('div', { style: 'margin-top:28px' }, adv) : null,
    el('p', { class: 'dim', style: 'margin-top:34px;font-size:12px' }, desc + (q.get('code') ? ' (' + q.get('code') + ')' : '')));
  for (const s of root.querySelectorAll('svg')) { s.style.width = '44px'; s.style.height = '44px'; }
})();
