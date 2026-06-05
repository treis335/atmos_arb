// src/core/optimalSize.js — tamanho óptimo via ternary search
// Só chamado PRÉ-EXECUÇÃO (não no ciclo de detecção)
// Usa simulate on-chain para preço real; fallback xy=k se RPC falhar

const { simulateSwap } = require('../dex/engine');
const config = require('../config');

// Simula rota com amountIn real → { finalAmount, hopOutputs } ou null
async function simulateRoute(route, amountIn, poolsMap) {
  let amount = amountIn;
  const hopOutputs = [];

  for (const hop of route) {
    const pool = poolsMap[hop.pool];
    if (!pool) return null;

    const isForward = hop.from === pool.token0Type;
    const decIn     = isForward ? (pool.decimals0 ?? 8) : (pool.decimals1 ?? 8);
    const decOut    = isForward ? (pool.decimals1 ?? 8) : (pool.decimals0 ?? 8);
    const amtInRaw  = Math.round(amount * (10 ** decIn));
    if (amtInRaw < 1) return null;

    // Simulate on-chain (preço real com fee + slippage)
    let amtOutRaw = await simulateSwap(hop.pool, hop.from, hop.to, amtInRaw, pool.poolType);

    // Fallback: xy=k aproximado se simulate falhar
    if (!amtOutRaw || amtOutRaw <= 0) {
      const rIn  = isForward ? (pool.reserve0 || 0) : (pool.reserve1 || 0);
      const rOut = isForward ? (pool.reserve1 || 0) : (pool.reserve0 || 0);
      if (!rIn || !rOut) return null;
      const fee      = 1 - (Number(pool.swapFeeBps ?? 30) / 10000);
      const aIn      = amount * fee;
      amtOutRaw = Math.floor((aIn * rOut * (10 ** decOut)) / (rIn + aIn));
    }

    if (!amtOutRaw || amtOutRaw <= 0) return null;
    hopOutputs.push({ amountInRaw: amtInRaw, expectedOutRaw: amtOutRaw });
    amount = amtOutRaw / (10 ** decOut);
  }

  return { finalAmount: amount, hopOutputs };
}

// Ternary search: maximiza profit = output - input
async function findOptimalAmount(route, poolsMap, minIn, maxIn) {
  minIn = minIn ?? config.execution?.minAmountIn ?? 5;
  maxIn = maxIn ?? config.execution?.maxAmountIn ?? 2000;
  const iterations = config.optimalSearch?.iterations ?? 14;

  // Teste rápido: rota funciona?
  const test = await simulateRoute(route, minIn, poolsMap);
  if (!test) return null;

  let lo = minIn, hi = maxIn;
  for (let i = 0; i < iterations; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const [r1, r2] = await Promise.all([
      simulateRoute(route, m1, poolsMap),
      simulateRoute(route, m2, poolsMap),
    ]);
    const p1 = r1 ? r1.finalAmount - m1 : -Infinity;
    const p2 = r2 ? r2.finalAmount - m2 : -Infinity;
    if (p1 < p2) lo = m1; else hi = m2;
  }

  const optimal = (lo + hi) / 2;
  const result  = await simulateRoute(route, optimal, poolsMap);
  if (!result) return null;

  const profit    = result.finalAmount - optimal;
  const profitPct = (profit / optimal) * 100;

  const firstHop  = route[0];
  const firstPool = poolsMap[firstHop.pool];
  const isForward = firstHop.from === firstPool?.token0Type;
  const decStart  = isForward ? (firstPool?.decimals0 ?? 8) : (firstPool?.decimals1 ?? 8);

  return {
    optimalAmount:    optimal,
    optimalAmountRaw: Math.round(optimal * (10 ** decStart)),
    profit,
    profitPct,
    hopOutputs: result.hopOutputs,
  };
}

module.exports = { findOptimalAmount, simulateRoute };
