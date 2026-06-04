// optimalSize.js — Tamanho óptimo via ternary search
// Usa simulateSwap do engine — se falhar, usa rácio de reserves como fallback

const { simulateSwap } = require('./engine');

// Simula a rota completa com um dado amountIn (unidades reais)
// Devolve { finalAmount, hopOutputs } ou null
async function simulateRoute(route, amountIn, poolsMap) {
  let amount = amountIn;
  const hopOutputs = [];

  for (const hop of route) {
    const pool = poolsMap[hop.pool];
    if (!pool) return null;

    const isForward = hop.from === pool.token0Type;
    const decIn  = isForward ? (pool.decimals0 ?? 8) : (pool.decimals1 ?? 8);
    const decOut = isForward ? (pool.decimals1 ?? 8) : (pool.decimals0 ?? 8);

    const amountInRaw = Math.round(amount * (10 ** decIn));
    if (amountInRaw < 1) return null;

    let amountOutRaw = await simulateSwap(
      hop.pool, hop.from, hop.to, amountInRaw, pool.poolType
    );

    // Fallback: rácio de reserves se simulate falhar
    if (!amountOutRaw || amountOutRaw <= 0) {
      const reserveIn  = isForward ? pool.reserve0 : pool.reserve1;
      const reserveOut = isForward ? pool.reserve1 : pool.reserve0;
      if (!reserveIn || !reserveOut) return null;
      const fee = 1 - (Number(pool.swapFeeBps ?? 30) / 10000);
      const amountInReal = amount * fee;
      amountOutRaw = Math.floor((amountInReal * reserveOut * (10 ** decOut)) / (reserveIn + amountInReal));
    }

    if (!amountOutRaw || amountOutRaw <= 0) return null;

    const amountOut = amountOutRaw / (10 ** decOut);
    hopOutputs.push({ amountInRaw, expectedOutRaw: amountOutRaw });
    amount = amountOut;
  }

  return { finalAmount: amount, hopOutputs };
}

// Ternary search: maximiza profit = output - input
async function findOptimalAmount(route, poolsMap, minIn = 10, maxIn = 500, iterations = 12) {
  // Primeiro verificar se a rota funciona com um valor pequeno
  const testResult = await simulateRoute(route, minIn, poolsMap);
  if (!testResult) return null; // rota inválida

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

  // Calcular raw units do primeiro token (assumir decimais do token inicial)
  const firstHop = route[0];
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
