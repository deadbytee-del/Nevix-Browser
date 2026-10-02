'use strict';
// Compact registrable-domain helper (a small public-suffix approximation, no dependency).
const TWO_LEVEL = new Set((
  'co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk com.au net.au org.au edu.au gov.au co.nz org.nz net.nz ' +
  'co.jp ne.jp or.jp ac.jp go.jp co.kr or.kr co.in net.in org.in gen.in firm.in com.br net.br org.br com.mx ' +
  'com.cn net.cn org.cn gov.cn com.tw org.tw com.hk org.hk com.sg edu.sg co.za org.za com.tr org.tr com.ar ' +
  'co.id or.id com.ua com.pl com.ru com.sa com.my com.ph com.vn com.eg com.ng com.pk com.co co.il org.il co.th ' +
  'github.io gitlab.io blogspot.com herokuapp.com vercel.app netlify.app pages.dev workers.dev web.app ' +
  'firebaseapp.com azurewebsites.net cloudfront.net appspot.com s3.amazonaws.com fly.dev onrender.com ' +
  'wordpress.com tumblr.com myshopify.com substack.com repl.co glitch.me surge.sh'
).split(' '));

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function registrable(host) {
  if (!host) return '';
  host = host.toLowerCase().replace(/\.$/, '');
  if (host.includes(':') || IPV4.test(host)) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const two = parts.slice(-2).join('.');
  if (TWO_LEVEL.has(two)) return parts.slice(-3).join('.');
  return two;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { return ''; }
}

function isLocalHost(host) {
  return (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === '::1' ||
    /^f[cd][0-9a-f]{2}:/i.test(host)
  );
}

function sameSite(a, b) {
  return registrable(hostOf(a)) === registrable(hostOf(b));
}

module.exports = { registrable, hostOf, isLocalHost, sameSite };
