'use strict';

const WORLD_COUNT = 258;
const MAX_STATE_BYTES = 220 * 1024;

function finiteIn(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validCountry(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  return Number.isInteger(c.owner) && c.owner >= 0 && c.owner < WORLD_COUNT &&
    finiteIn(c.army, 0, 1e7) && finiteIn(c.industry, 0, 1e6) &&
    finiteIn(c.cash, -1e12, 1e12) && finiteIn(c.stance, 0, 1) &&
    finiteIn(c.fatigue, 0, 1e6) &&
    (c.taxRate === undefined || finiteIn(c.taxRate, 0, 30)) &&
    (c.stability === undefined || finiteIn(c.stability, 0, 100));
}

function validGameState(s, expectedCountry) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.version !== 3 ||
      s.player !== expectedCountry || !Number.isInteger(s.turn) || s.turn < 0 || s.turn > 100000) return null;
  if (!Array.isArray(s.countries) || s.countries.length !== WORLD_COUNT || !s.countries.every(validCountry)) return null;
  if (!Array.isArray(s.relations) || s.relations.length !== WORLD_COUNT || !s.relations.every(v => finiteIn(v, 0, 100))) return null;
  if (!Array.isArray(s.wars) || s.wars.length > WORLD_COUNT) return null;
  if (!Number.isFinite(s.money) || Math.abs(s.money) > 1e12) return null;
  if (!Array.isArray(s.seats) || s.seats.length !== 5 || !s.seats.every(v => Number.isInteger(v) && v >= 0 && v <= 300) || s.seats.reduce((a,b)=>a+b,0) !== 300) return null;
  if (!Array.isArray(s.groups) || s.groups.length !== 5 || !s.groups.every(v => finiteIn(v, 0, 100))) return null;
  if (!s.inventory || typeof s.inventory !== 'object' || Array.isArray(s.inventory)) return null;
  for (const [id, item] of Object.entries(s.inventory)) {
    if (!/^\d{1,6}$/.test(id) || !item || typeof item !== 'object' || Array.isArray(item) ||
        !Number.isInteger(item.qty) || item.qty < 0 || item.qty > 1e6 ||
        !Number.isInteger(item.level) || item.level < 1 || item.level > 5) return null;
  }
  let serialized;
  try { serialized = JSON.stringify(s); } catch { return null; }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) return null;
  try { return JSON.parse(serialized); } catch { return null; }
}

function pickCountryState(state, country) {
  const c = state && Array.isArray(state.countries) ? state.countries[country] : null;
  if (!validCountry(c)) return null;
  return { owner: c.owner, army: c.army, industry: c.industry, cash: c.cash, stance: c.stance, fatigue: c.fatigue, taxRate: finiteIn(c.taxRate,0,30) ? c.taxRate : 10, stability: finiteIn(c.stability,0,100) ? c.stability : 70 };
}

module.exports = { WORLD_COUNT, validGameState, pickCountryState, validCountry };
