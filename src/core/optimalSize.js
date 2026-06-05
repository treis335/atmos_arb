// src/core/optimalSize.js — ternary search para tamanho óptimo de trade
// Maximiza profit absoluto (output - input) dentro de [minIn, maxIn] SUPRA.

const { simulateSwap } = require('../dex/engine');
const config = require('../config');

// Simula a rota inteira com um dado amountIn (em unidades reais, não raw)
// Devolve { finalAmount, hopOutputs } ou null se a rota for inválida
async function simulateRoute(route, amountIn, poolsMap) {
  let amount = amountIn;
  const hopOutputs = [];

  for (const hop of route) {
    const pool = poolsMap[hop.pool];
    if (!pool) return null;

    const isForward  = hop.from === pool.token0Type;
    const decIn      = isForward ? (pool.decimals0 ?? 8) : (pool.decimals1 ?? 8);
    const decOut     = isForward ? (pool.decimals1 ?? 8) : (pool.decimals0 ?? 8);
    const amtInRaw   = Math.round(amount * (10 ** decIn));
    if (amtInRaw < 1) return null;

    // Tenta simulate on-chain; fallback para xy=k se falhar
    let amtOutRaw = await simulateSwap(hop.pool, hop.from, hop.to, amtInRaw, pool.poolType);

    if (!amtOutRaw || amtOutRaw <= 0) {
      const rIn  = isForward ? (pool.reserve0 || 0) : (pool.reserve1 || 0);
      const rOut = isForward ? (pool.reserve1 || 0) : (pool.reserve0 || 0);
      if (!rIn || !rOut) return null;
      const fee = 1 - (Number(pool.swapFeeBps ?? 30) / 10000);
      const aIn = amount * fee;
      amtOutRaw = Math.floor((aIn * rOut * (10 ** decOut)) / (rIn + aIn));
    }

    if (!amtOutRaw || amtOutRaw <= 0) return null;

    hopOutputs.push({ amountInRaw: amtInRaw, expectedOutRaw: amtOutRaw });
    amount = amtOutRaw / (10 ** decOut);
  }

  return { finalAmount: amount, hopOutputs };
}

// Ternary search sobre [minIn, maxIn], maximizando profit = output - input
async function findOptimalAmount(route, poolsMap, minIn, maxIn) {
  minIn = minIn ?? config.execution?.minAmountIn ?? 5;
  maxIn = maxIn ?? config.execution?.maxAmountIn ?? 5000;
  const iterations = config.optimalSearch?.iterations ?? 18;

  // Verificação rápida: rota funciona com o mínimo?
  if (!(await simulateRoute(route, minIn, poolsMap))) return null;

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

  // Calcular raw units para o token de entrada do primeiro hop
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
