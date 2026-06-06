// src/core/detector.js — detector de arb, baseado no dexlyn_arb_original
// Usa _simulate de cada par (interface unificada), EMA trend, score multi-factor

const { findOptimalAmount } = require('./optimalSize');
const { trackPrice } = require('../tracker/priceTracker');
const config = require('../config');
const MAX_RESULTS = 300;

const arbDetector = {
  simulateCycle(cycle, amountIn) {
    let amount = amountIn;
    const steps = [];
    for (const edge of cycle.edges) {
      const ps  = edge.pair;
      let out = 0;
      if (typeof ps._simulate === 'function') {
        out = ps._simulate(edge.direction, amount);
      } else {
        // fallback xy=k genérico
        const { reserveA, reserveB, fee, feeScale } = ps;
        const rIn  = edge.direction === 'AB' ? reserveA : reserveB;
        const rOut = edge.direction === 'AB' ? reserveB : reserveA;
        if (rIn > 0 && rOut > 0 && amount > 0) {
          const f = 1 - fee / feeScale;
          out = (amount * f * rOut) / (rIn + amount * f);
        }
      }
      const from = edge.direction === 'AB' ? ps.tokenA : ps.tokenB;
      const to   = edge.direction === 'AB' ? ps.tokenB : ps.tokenA;
      steps.push({ from, to, amtIn: amount, amtOut: out, dex: ps.dex, pair: ps });
      if (!out || out <= 0) return { steps, startAmount: amountIn, endAmount: 0, profitAbs: -amountIn, profitPct: -100 };
      amount = out;
    }
    const profitAbs = amount - amountIn;
    const profitPct = (profitAbs / amountIn) * 100;
    return { steps, startAmount: amountIn, endAmount: amount, profitAbs, profitPct };
  },

  scoreOpportunity(cycle, result) {
    const { profit: wP, liquidity: wL, trend: wT } = config.scoreWeights;

    const profitScore = Math.min(1, result.profitPct / 2);

    const minLiquidity = Math.min(...result.steps.map(s => {
      const ps = s.pair;
      const res = ps.tokenB === s.to ? (ps.reserveB || 0) : (ps.reserveA || 0);
      return res;
    }));
    const liquidityScore = Math.min(1, Math.log10(Math.max(1, minLiquidity)) / 6);

    let trendAlign = 0, trendCount = 0;
    for (const step of result.steps) {
      const ps  = step.pair;
      const key = `ATMOS_${ps.tokenA}_${ps.tokenB}_${ps.curve || 'w'}`;
      const h   = require('../tracker/priceTracker').priceHistory[key];
      if (!h) continue;
      const isAB = step.from === ps.tokenA;
      trendAlign += (isAB ? h.ema > 0 : h.ema < 0) ? 1 : -0.5;
      trendCount++;
    }
    const trendScore = trendCount
      ? Math.max(0, Math.min(1, (trendAlign / trendCount + 0.5) / 1.5))
      : 0.5;

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
      const scoring = this.scoreOpportunity(cycle, result);
      results.push({ cycle, result, optimalAmount, ...scoring });
    }
    return results.sort((a, b) => b.score - a.score);
  },
};

module.exports = { arbDetector };
