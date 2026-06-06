// src/core/optimalSize.js — ternary search, interface igual ao dexlyn_arb_original
function simulateCycleAmount(cycle, amountIn) {
  let amount = amountIn;
  for (const edge of cycle.edges) {
    const ps = edge.pair;
    let out = 0;
    if (typeof ps._simulate === 'function') {
      out = ps._simulate(edge.direction, amount);
    } else {
      const rIn  = edge.direction === 'AB' ? ps.reserveA : ps.reserveB;
      const rOut = edge.direction === 'AB' ? ps.reserveB : ps.reserveA;
      if (rIn > 0 && rOut > 0 && amount > 0) {
        const f = 1 - ps.fee / ps.feeScale;
        out = (amount * f * rOut) / (rIn + amount * f);
      }
    }
    if (!out || out <= 0) return 0;
    amount = out;
  }
  return amount;
}

function findOptimalAmount(cycle, config) {
  const { min, max, iterations } = config.optimalSearch;
  let lo = min, hi = max;
  for (let i = 0; i < iterations; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const p1 = simulateCycleAmount(cycle, m1) - m1;
    const p2 = simulateCycleAmount(cycle, m2) - m2;
    if (p1 < p2) lo = m1; else hi = m2;
  }
  const optimalAmount = (lo + hi) / 2;
  const optimalProfit = simulateCycleAmount(cycle, optimalAmount) - optimalAmount;
  return { optimalAmount, optimalProfit };
}

module.exports = { findOptimalAmount, simulateCycleAmount };
