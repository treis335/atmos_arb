// src/core/graph.js — grafo de tokens para detecção de arbitragem
//
// OPTIMIZAÇÃO: Para pares com múltiplas pools (ex: SUPRA/FA:4b28 com 31 pools),
// mantemos TODAS as pools no grafo mas identificamos a "best" por par para o TUI.
// O DFS vai encontrar naturalmente a melhor rota mesmo com pools duplicadas.
//
// Fee incluída no price: price = rawPrice × (1 - fee)
// rawPrice = r1/r0 (calculado no engine sem RPC extra)

function buildGraph(reservesData) {
  const graph = new Map();

  for (const r of reservesData) {
    const { pool, rawPrice, reserve0, reserve1 } = r;
    const feeMult = 1 - (Number(pool.swapFeeBps) || 30) / 10000;
    const t0      = pool.token0Type;
    const t1      = pool.token1Type;

    if (!graph.has(t0)) graph.set(t0, []);
    if (!graph.has(t1)) graph.set(t1, []);

    // t0 → t1 (direcção forward)
    graph.get(t0).push({
      from: t0, to: t1,
      price:    rawPrice * feeMult,
      pool:     pool.address,
      poolType: pool.poolType,
      feeBps:   Number(pool.swapFeeBps),
      reserve0, reserve1,
    });

    // t1 → t0 (direcção inversa)
    graph.get(t1).push({
      from: t1, to: t0,
      price:    (1 / rawPrice) * feeMult,
      pool:     pool.address,
      poolType: pool.poolType,
      feeBps:   Number(pool.swapFeeBps),
      reserve0: reserve1,
      reserve1: reserve0,
    });
  }

  return graph;
}

module.exports = { buildGraph };
