'use strict';
const fs = require('fs');
const path = require('path');

function getPath(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, key, value) {
  const parts = key.split('.');
  const last = parts.pop();
  let o = obj;
  for (const p of parts) {
    if (typeof o[p] !== 'object' || o[p] === null) o[p] = {};
    o = o[p];
  }
  o[last] = value;
}
function merge(defaults, loaded) {
  if (Array.isArray(defaults) || typeof defaults !== 'object' || defaults === null) {
    return loaded === undefined ? defaults : loaded;
  }
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = merge(defaults[k], loaded && loaded[k]);
  if (loaded && typeof loaded === 'object') {
    for (const k of Object.keys(loaded)) if (!(k in out)) out[k] = loaded[k];
  }
  return out;
}

/** Tiny atomic JSON store with debounced writes. */
class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.timer = null;
    let loaded;
    try { loaded = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { loaded = undefined; }
    this.data = merge(defaults, loaded);
  }
  get(key, fallback) {
    const v = key ? getPath(this.data, key) : this.data;
    return v === undefined ? fallback : v;
  }
  set(key, value) {
    setPath(this.data, key, value);
    this.save();
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 400);
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('store flush failed', this.file, e.message); }
  }
}

module.exports = { Store };
