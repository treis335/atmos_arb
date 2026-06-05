// src/core/graph.js — constrói o grafo dirigido de tokens a partir das reserves
// Cada aresta representa um swap possível numa pool, com preço pós-fee.

function buildGraph(reservesData) {
  // Map<tokenType, Edge[]>
  const graph = new Map();

  for (const r of reservesData) {
    const { pool, rawPrice, reserve0, reserve1 } = r;
    const fee  = 1 - (Number(pool.swapFeeBps) || 30) / 10000;
    const t0   = pool.token0Type;
    const t1   = pool.token1Type;

    if (!graph.has(t0)) graph.set(t0, []);
    if (!graph.has(t1)) graph.set(t1, []);

    // t0 → t1
    graph.get(t0).push({
      from: t0, to: t1,
      price:    rawPrice * fee,
      pool:     pool.address,
      poolType: pool.poolType,
      reserve0, reserve1,          // para liquidityScore
    });

    // t1 → t0 (preço inverso)
    graph.get(t1).push({
      from: t1, to: t0,
      price:    (1 / rawPrice) * fee,
      pool:     pool.address,
      poolType: pool.poolType,
      reserve0: reserve1,          // flip para o sentido inverso
      reserve1: reserve0,
    });
  }

  return graph;
}

module.exports = { buildGraph };
