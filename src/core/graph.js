// src/core/graph.js — grafo com preços Balancer correctos + fee
//
// Para weighted pools:
//   spot_price_A→B = (r1/w1) / (r0/w0)  [já calculado no engine]
//   com fee: effective = spot × (1 - fee/10000)
//
// Para stable pools:
//   preço ≈ 1:1 (StableSwap), rawPrice já vem como r1/r0 ≈ 1

function buildGraph(reservesData) {
  const graph = new Map();

  for (const r of reservesData) {
    const { pool, rawPrice, reserve0, reserve1 } = r;
    const fee  = (Number(pool.swapFeeBps) || 30) / 10000;
    const mult = 1 - fee;
    const t0   = pool.token0Type;
    const t1   = pool.token1Type;

    if (!graph.has(t0)) graph.set(t0, []);
    if (!graph.has(t1)) graph.set(t1, []);

    // t0 → t1
    graph.get(t0).push({
      from: t0, to: t1,
      price:    rawPrice * mult,
      pool:     pool.address,
      poolType: pool.poolType,
      feeBps:   Number(pool.swapFeeBps),
      reserve0, reserve1,
    });

    // t1 → t0 (inverso: 1/rawPrice)
    graph.get(t1).push({
      from: t1, to: t0,
      price:    (1 / rawPrice) * mult,
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
