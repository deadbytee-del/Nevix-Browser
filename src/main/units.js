'use strict';
// Offline unit conversion: "12 km in miles", "98.6 f to c", "2.5 gb to mb". Currencies are intentionally absent
// (rates need the network).
const { format } = require('./calc');

// Each category maps unit names to a factor relative to its base unit (temperature is special-cased).
const CATS = {
  length: { base: 'm', u: { mm: 0.001, millimeter: 0.001, millimeters: 0.001, millimetre: 0.001, millimetres: 0.001, cm: 0.01, centimeter: 0.01, centimeters: 0.01, centimetre: 0.01, centimetres: 0.01, m: 1, meter: 1, meters: 1, metre: 1, metres: 1, km: 1000, kilometer: 1000, kilometers: 1000, kilometre: 1000, kilometres: 1000, in: 0.0254, inch: 0.0254, inches: 0.0254, ft: 0.3048, foot: 0.3048, feet: 0.3048, yd: 0.9144, yard: 0.9144, yards: 0.9144, mi: 1609.344, mile: 1609.344, miles: 1609.344, nmi: 1852, um: 1e-6, μm: 1e-6 } },
  mass: { base: 'g', u: { mg: 0.001, g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, t: 1e6, tonne: 1e6, tonnes: 1e6, oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125, lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237, st: 6350.29318, stone: 6350.29318 } },
  volume: { base: 'ml', u: { ml: 1, milliliter: 1, milliliters: 1, l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000, tsp: 4.92892159375, teaspoon: 4.92892159375, tbsp: 14.78676478125, tablespoon: 14.78676478125, floz: 29.5735295625, cup: 236.5882365, cups: 236.5882365, pt: 473.176473, pint: 473.176473, pints: 473.176473, qt: 946.352946, quart: 946.352946, quarts: 946.352946, gal: 3785.411784, gallon: 3785.411784, gallons: 3785.411784 } },
  area: { base: 'm2', u: { mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 1e4, hectare: 1e4, hectares: 1e4, ft2: 0.09290304, in2: 0.00064516, yd2: 0.83612736, acre: 4046.8564224, acres: 4046.8564224, mi2: 2589988.110336 } },
  speed: { base: 'ms', u: { ms: 1, 'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, kph: 1 / 3.6, mph: 0.44704, 'mi/h': 0.44704, kn: 0.514444, knot: 0.514444, knots: 0.514444, 'ft/s': 0.3048 } },
  time: { base: 's', u: { ms: 0.001, s: 1, sec: 1, second: 1, seconds: 1, min: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, wk: 604800, week: 604800, weeks: 604800, yr: 31557600, year: 31557600, years: 31557600 } },
  data: { base: 'b', u: { bit: 1 / 8, bits: 1 / 8, b: 1, byte: 1, bytes: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15, kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776, kbit: 125, mbit: 125000, gbit: 125000000 } },
  temp: { base: 'c', u: { c: 1, celsius: 1, '°c': 1, f: 1, fahrenheit: 1, '°f': 1, k: 1, kelvin: 1 } },
};
const TEMP = { c: 'c', celsius: 'c', '°c': 'c', f: 'f', fahrenheit: 'f', '°f': 'f', k: 'k', kelvin: 'k' };

function find(unit) {
  const u = unit.toLowerCase();
  for (const [name, cat] of Object.entries(CATS)) {
    if (name === 'temp') continue;
    if (Object.prototype.hasOwnProperty.call(cat.u, u)) return { cat: name, f: cat.u[u], u };
  }
  if (TEMP[u]) return { cat: 'temp', t: TEMP[u], u };
  return null;
}

function convertTemp(v, from, to) {
  let c = from === 'c' ? v : from === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
  return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
}

/** "12 km in miles" -> { display: '7.4565 mi', value, from, to } or null. */
function tryConvert(text) {
  const m = /^\s*(-?\d[\d,]*\.?\d*|-?\.\d+)\s*([a-zµμ°/0-9²]+)\s+(?:in|to|as|into|=)\s+([a-zµμ°/0-9²]+)\s*$/i.exec(text.replace(/²/g, '2'));
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  const a = find(m[2]), b = find(m[3]);
  if (!a || !b || a.cat !== b.cat || !Number.isFinite(v)) return null;
  let out;
  if (a.cat === 'temp') out = convertTemp(v, a.t, b.t);
  else out = (v * a.f) / b.f;
  const d = format(out);
  if (d === null) return null;
  return { value: out, display: `${d} ${m[3]}`, from: `${format(v)} ${m[2]}` };
}

module.exports = { tryConvert, CATS };
