'use strict';
// Offline calculator for the address bar. A small recursive-descent parser — the input is never passed to eval().
//
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | '%' | 'mod') unary)*
//   unary   := ('-' | '+') unary | power
//   power   := postfix (('^' | '**') unary)?
//   postfix := primary ('!' | '%')?          (a trailing % divides by 100)
//   primary := number | const | func '(' args ')' | '(' expr ')'
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };
const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot, rad: (d) => (d * Math.PI) / 180, deg: (r) => (r * 180) / Math.PI,
  fact: (n) => factorial(n),
};
function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('factorial');
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}

function tokenize(src) {
  const out = [];
  let i = 0;
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, ' ');
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    let m;
    if ((m = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)))) {
      // a number followed directly by letters is not ours (units, words) — let the caller decide
      out.push({ t: 'num', v: parseFloat(m[0].replace(/,/g, '')) }); i += m[0].length; continue;
    }
    if ((m = /^(\*\*|[+\-*/%^!(),])/.exec(s.slice(i)))) { out.push({ t: 'op', v: m[0] === '**' ? '^' : m[0] }); i += m[0].length; continue; }
    if ((m = /^[a-zπ_][a-zπ_0-9]*/i.exec(s.slice(i)))) { out.push({ t: 'id', v: m[0].toLowerCase() }); i += m[0].length; continue; }
    throw new Error('unexpected ' + c);
  }
  return out;
}

function evaluate(src) {
  const tok = tokenize(src);
  let p = 0;
  const peek = () => tok[p];
  const eat = (v) => { const t = tok[p]; if (t && t.t === 'op' && t.v === v) { p++; return true; } return false; };
  const need = (v) => { if (!eat(v)) throw new Error('expected ' + v); };

  function expr() {
    let v = term();
    for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; }
  }
  function term() {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t && t.t === 'op' && t.v === '*') { p++; v *= unary(); }
      else if (t && t.t === 'op' && t.v === '/') { p++; v /= unary(); }
      else if (t && t.t === 'op' && t.v === '%' && startsOperand(tok[p + 1])) { p++; v %= unary(); }
      else if (t && t.t === 'id' && t.v === 'mod') { p++; v %= unary(); }
      else if (t && (t.t === 'num' || (t.t === 'op' && t.v === '(') || (t.t === 'id' && (t.v in CONSTS || t.v in FUNCS)))) v *= unary(); // implicit multiplication: 2(3), 2pi
      else return v;
    }
  }
  function startsOperand(t) { return !!t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && (t.v === '(' || t.v === '-' || t.v === '+'))); }
  function unary() {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }
  function power() {
    const base = postfix();
    if (eat('^')) return Math.pow(base, unary());
    return base;
  }
  function postfix() {
    let v = primary();
    for (;;) {
      if (eat('!')) v = factorial(v);
      else if (peek() && peek().t === 'op' && peek().v === '%' && !startsOperand(tok[p + 1])) { p++; v /= 100; }
      else return v;
    }
  }
  function primary() {
    const t = tok[p++];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = expr(); need(')'); return v; }
    if (t.t === 'id') {
      if (t.v in FUNCS) {
        need('(');
        const args = [];
        if (!eat(')')) { do args.push(expr()); while (eat(',')); need(')'); }
        return FUNCS[t.v](...args);
      }
      if (t.v in CONSTS) return CONSTS[t.v];
    }
    throw new Error('unexpected token');
  }

  const v = expr();
  if (p !== tok.length) throw new Error('trailing input');
  return v;
}

function format(n) {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  let s;
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) s = n.toExponential(8).replace(/\.?0+e/, 'e');
  else {
    s = (Math.round(n * 1e10) / 1e10).toString();
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  return s;
}

/**
 * Try to treat `text` as arithmetic. Returns { result, display } or null if it isn't a calculation.
 * Plain numbers and anything without an operator/function are not calculations (they are searches or URLs).
 */
function tryCalc(text) {
  const t = text.trim();
  if (!t || t.length > 200) return null;
  // percentage phrases: "20% of 150"
  let m = /^(\d+(?:\.\d+)?)\s*%\s*of\s*(\d[\d,]*(?:\.\d+)?)$/i.exec(t);
  if (m) { const r = (parseFloat(m[1]) / 100) * parseFloat(m[2].replace(/,/g, '')); return { result: r, display: format(r) }; }
  if (!/[+\-*/^%×÷!]|\*\*|\bmod\b|\b(sqrt|cbrt|sin|cos|tan|asin|acos|atan|ln|log|log2|log10|exp|abs|floor|ceil|round|trunc|min|max|pow|hypot|fact|rad|deg)\s*\(/i.test(t)) return null;
  if (/^\d{3,4}-\d{3,4}$/.test(t) || /^\d{1,4}-\d{1,2}-\d{1,4}$/.test(t)) return null;   // phone-number / date shapes
  if (!/^[\d\s+\-*/^%().,!×÷−a-zπ_]+$/i.test(t)) return null;
  try {
    const r = evaluate(t);
    const d = typeof r === 'number' ? format(r) : null;
    return d === null ? null : { result: r, display: d };
  } catch { return null; }
}

module.exports = { tryCalc, evaluate, format };
