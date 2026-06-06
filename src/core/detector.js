// src/core/detector.js
const { findOptimalAmount } = require('./optimalSize');
const config = require('../config');
const { priceHistory } = require('../tracker/priceTracker');

const arbDetector = {
  simulateCycle(cycle, amountIn) {
    let amount = amountIn;
    const steps = [];
    for (const edge of cycle.edges) {
      const ps  = edge.pair;
      const out = typeof ps._simulate === 'function'
        ? ps._simulate(edge.direction, amount) : 0;
      const from    = edge.direction === 'AB' ? ps.addrA : ps.addrB;
      const to      = edge.direction === 'AB' ? ps.addrB : ps.addrA;
      const fromSym = edge.direction === 'AB' ? ps.tokenA : ps.tokenB;
      const toSym   = edge.direction === 'AB' ? ps.tokenB : ps.tokenA;
      steps.push({ from, to, fromSym, toSym, amtIn: amount, amtOut: out, dex: ps.dex, pair: ps });
      if (!out || out <= 0) return { steps, startAmount: amountIn, endAmount: 0, profitAbs: -amountIn, profitPct: -100 };
      amount = out;
    }
    const profitAbs = amount - amountIn;
    const profitPct = (profitAbs / amountIn) * 100;
    return { steps, startAmount: amountIn, endAmount: amount, profitAbs, profitPct };
  },

  scoreOpportunity(cycle, result) {
    const { profit: wP, liquidity: wL, trend: wT } = config.scoreWeights;
    const profitScore    = Math.min(1, result.profitPct / 2);
    const minLiq         = Math.min(...result.steps.map(s =>
      s.pair.tokenB === s.toSym ? (s.pair.reserveB || 0) : (s.pair.reserveA || 0)));
    const liquidityScore = Math.min(1, Math.log10(Math.max(1, minLiq)) / 6);
    let trendAlign = 0, trendCount = 0;
    for (const step of result.steps) {
      const ps = step.pair;
      const h  = priceHistory[`ATMOS_${ps.tokenA}_${ps.tokenB}_${ps.curve||'w'}`];
      if (!h) continue;
      trendAlign += (step.from === ps.addrA ? h.ema > 0 : h.ema < 0) ? 1 : -0.5;
      trendCount++;
    }
    const trendScore = trendCount ? Math.max(0, Math.min(1, (trendAlign / trendCount + 0.5) / 1.5)) : 0.5;
    const score = Math.round((wP * profitScore + wL * liquidityScore + wT * trendScore) * 100);
    return { score, profitScore, liquidityScore, trendScore };
  },

  analyzeAll(cycles) {
    const results = [];
    for (const cycle of cycles) {
      const { optimalAmount, optimalProfit } = findOptimalAmount(cycle, config);
      if (optimalProfit <= 0) continue;
      const result = this.simulateCycle(cycle, optimalAmount);
      if (result.profitPct < config.minProfitPct) continue;
      // SEM cap de 5% — xy=k local é uma aproximação conservadora
      // lucros >5% podem ser reais em pools desequilibradas
      const scoring = this.scoreOpportunity(cycle, result);
      results.push({ cycle, result, optimalAmount, ...scoring });
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

module.exports = { arbDetector };
