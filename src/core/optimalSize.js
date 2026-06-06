// src/core/optimalSize.js — tamanho óptimo via ternary search
// CRÍTICO: max é limitado à liquidez real da pool para evitar lucros fictícios
// xy=k com amountIn > reserva produz outputs impossíveis!

function simulateCycleAmount(cycle, amountIn) {
  let amount = amountIn;
  for (const edge of cycle.edges) {
    const ps = edge.pair;
    if (typeof ps._simulate === 'function') {
      const out = ps._simulate(edge.direction, amount);
      if (!out || out <= 0) return 0;
      amount = out;
    } else {
      const rIn  = edge.direction === 'AB' ? (ps.reserveA || 0) : (ps.reserveB || 0);
      const rOut = edge.direction === 'AB' ? (ps.reserveB || 0) : (ps.reserveA || 0);
      if (rIn <= 0 || rOut <= 0 || amount <= 0) return 0;
      const f   = 1 - ps.fee / (ps.feeScale || 10000);
      const aIn = amount * f;
      amount = (aIn * rOut) / (rIn + aIn);
      if (!amount || amount <= 0) return 0;
    }
  }
  return amount;
}

function findOptimalAmount(cycle, config) {
  const cfgMin = config.optimalSearch?.min ?? 1;
  const cfgMax = config.optimalSearch?.max ?? 500;

  // CRÍTICO: limitar max à liquidez mínima do ciclo × 5%
  // Previne lucros fictícios de xy=k com amountIn > reserva
  let liquidityMax = cfgMax;
  for (const edge of cycle.edges) {
    const ps  = edge.pair;
    const rIn = edge.direction === 'AB' ? (ps.reserveA || 0) : (ps.reserveB || 0);
    if (rIn > 0) {
      liquidityMax = Math.min(liquidityMax, rIn * 0.05);
    }
  }

  const min  = cfgMin;
  const max  = Math.max(min * 1.1, liquidityMax);
  const iters = config.optimalSearch?.iterations ?? 20;

  // Verificar se há lucro antes de pesquisar
  const testOut = simulateCycleAmount(cycle, min);
  if (!testOut || testOut <= min) {
    return { optimalAmount: min, optimalProfit: testOut - min };
  }

  let lo = min, hi = max;
  for (let i = 0; i < iters; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const p1 = simulateCycleAmount(cycle, m1) - m1;
    const p2 = simulateCycleAmount(cycle, m2) - m2;
    if (p1 < p2) lo = m1; else hi = m2;
  }

  const optimalAmount = (lo + hi) / 2;
  const optimalOut    = simulateCycleAmount(cycle, optimalAmount);
  const optimalProfit = optimalOut - optimalAmount;

  return { optimalAmount, optimalProfit };
}

module.exports = { findOptimalAmount, simulateCycleAmount };
