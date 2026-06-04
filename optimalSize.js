// optimalSize.js — Calcula o tamanho óptimo de entrada para maximizar lucro
// Usa ternary search (golden section) — mesmo padrão do arb_bot_dexyln

const { simulateSwap } = require('./engine');

// Simula toda a rota com um dado amountIn (em unidades reais, não raw)
// Devolve o output final em unidades reais
async function simulateRoute(route, amountIn, poolsMap) {
  let amount = amountIn;
  const hopOutputs = [];

  for (const hop of route) {
    const pool = poolsMap[hop.pool];
    if (!pool) return null;

    const dec0 = pool.decimals0 ?? 8;
    const dec1 = pool.decimals1 ?? 8;

    // Determinar decimais de entrada/saída
    const isForward = hop.from === pool.token0Type;
    const decIn  = isForward ? dec0 : dec1;
    const decOut = isForward ? dec1 : dec0;

    const amountInRaw = Math.round(amount * (10 ** decIn));
    if (amountInRaw < 1) return null;

    const amountOutRaw = await simulateSwap(
      hop.pool, hop.from, hop.to, amountInRaw, pool.poolType
    );

    if (!amountOutRaw || amountOutRaw <= 0) return null;

    const amountOut = amountOutRaw / (10 ** decOut);
    hopOutputs.push({ amountInRaw, expectedOutRaw: amountOutRaw });
    amount = amountOut;
  }

  return { finalAmount: amount, hopOutputs };
}

// Ternary search para encontrar o tamanho óptimo de entrada
// Maximiza profit = output - input
async function findOptimalAmount(route, poolsMap, minIn = 10, maxIn = 5000, iterations = 15) {
  let lo = minIn;
  let hi = maxIn;

  for (let i = 0; i < iterations; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;

    const r1 = await simulateRoute(route, m1, poolsMap);
    const r2 = await simulateRoute(route, m2, poolsMap);

    const p1 = r1 ? r1.finalAmount - m1 : -Infinity;
    const p2 = r2 ? r2.finalAmount - m2 : -Infinity;

    if (p1 < p2) lo = m1; else hi = m2;
  }

  const optimalAmount = (lo + hi) / 2;
  const result = await simulateRoute(route, optimalAmount, poolsMap);

  if (!result) return null;

  const profit = result.finalAmount - optimalAmount;
  const profitPct = (profit / optimalAmount) * 100;

  return {
    optimalAmount,
    optimalAmountRaw: Math.round(optimalAmount * 1e8), // assume SUPRA decimals=8 para o token inicial
    profit,
    profitPct,
    hopOutputs: result.hopOutputs,
  };
}

module.exports = { findOptimalAmount, simulateRoute };
