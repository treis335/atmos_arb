const config = require('../config');
const priceHistory = {};
const BLOCKS = ['▁','▂','▃','▄','▅','▆','▇','█'];

function sparkline(ticks) {
  const pad = ' '.repeat(Math.max(0, config.tickHistory - ticks.length));
  if (!ticks.length) return pad + ' '.repeat(config.tickHistory);
  const maxAbs = Math.max(...ticks.map(Math.abs), 0.0001);
  return pad + ticks.map(pct => {
    const idx   = Math.min(7, Math.round((Math.abs(pct) / maxAbs) * 7));
    const color = pct > 0.00001 ? 'green' : pct < -0.00001 ? 'red' : 'grey';
    return `{${color}-fg}${BLOCKS[idx]}{/}`;
  }).join('');
}

function trackPrice(key, cur) {
  if (!priceHistory[key]) {
    priceHistory[key] = { prev: cur, ema: 0, streak: 0, ticks: [], min: cur, max: cur };
    return { isNew: true, ema: 0, streak: 0, ticks: [], priceTag: 'bright-cyan', dirTag: 'bright-cyan', pctStr: 'new', trendStr: '─' };
  }
  const h   = priceHistory[key];
  const pct = h.prev !== 0 ? ((cur - h.prev) / h.prev) * 100 : 0;
  h.ema     = config.emaAlpha * pct + (1 - config.emaAlpha) * h.ema;
  const emaDir = h.ema > 0.00001 ? 1 : h.ema < -0.00001 ? -1 : 0;
  if      (emaDir ===  1) h.streak = h.streak > 0 ? h.streak + 1 : 1;
  else if (emaDir === -1) h.streak = h.streak < 0 ? h.streak - 1 : -1;
  h.ticks.push(pct);
  if (h.ticks.length > config.tickHistory) h.ticks.shift();
  if (cur < h.min) h.min = cur;
  if (cur > h.max) h.max = cur;
  h.prev = cur;

  const absPct = Math.abs(pct);
  const absEma = Math.abs(h.ema);
  let dir, priceTag, dirTag;
  if      (h.ema > 0.00001)  { dir = 'up';   priceTag = absPct >= 0.5 ? 'bright-green' : 'green'; dirTag = absEma >= 0.5 ? 'bright-green' : 'green'; }
  else if (h.ema < -0.00001) { dir = 'down'; priceTag = absPct >= 0.5 ? 'bright-red'   : 'red';   dirTag = absEma >= 0.5 ? 'bright-red'   : 'red';   }
  else                       { dir = 'flat'; priceTag = 'white'; dirTag = 'grey'; }

  const strength = absEma >= 0.5 ? 3 : absEma >= 0.1 ? 2 : 1;
  const sym      = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '─';
  const trendStr = dir === 'flat' ? '{grey-fg}─  {/}' : `{${dirTag}-fg}${sym.repeat(strength)}{/}`;
  const pctStr   = `${pct >= 0 ? '+' : ''}${pct.toFixed(3)}%`;

  return { isNew: false, dir, ema: h.ema, streak: h.streak, ticks: [...h.ticks], min: h.min, max: h.max, priceTag, dirTag, pctStr, trendStr };
}

module.exports = { trackPrice, sparkline, priceHistory };
