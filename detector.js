// detector.js — grafo + ciclos de arbitragem (3 e 4 hops)
// v2: deduplicação melhorada, hops mínimos corrigidos, liquidityScore adicionado
const config = require('./config');

function buildGraph(reservesData) {
  const graph = new Map();
  for (const r of reservesData) {
    const { pool, rawPrice, reserve0, reserve1 } = r;
    const fee = 1 - (Number(pool.swapFeeBps) || 30) / 10000;
    const t0 = pool.token0Type;
    const t1 = pool.token1Type;
    if (!graph.has(t0)) graph.set(t0, []);
    if (!graph.has(t1)) graph.set(t1, []);
    graph.get(t0).push({ to: t1, price: rawPrice * fee,       pool: pool.address, from: t0, poolType: pool.poolType, reserve0, reserve1 });
    graph.get(t1).push({ to: t0, price: (1/rawPrice) * fee,   pool: pool.address, from: t1, poolType: pool.poolType, reserve0: reserve1, reserve1: reserve0 });
  }
  return graph;
}

function findCycles(graph, minProfit, maxHops = 4) {
  const cycles = [];
  const tokens = Array.from(graph.keys());

  for (const start of tokens) {
    const edges = [];
    const visitedPools = new Set();
    const visitedTokens = new Set([start]);

    function dfs(current, depth) {
      if (depth >= 2 && current === start) {
        let product = 1;
        for (const e of edges) product *= e.price;
        const profitPct = (product - 1) * 100;
        if (profitPct >= minProfit) {
          cycles.push({
            route: edges.map(e => ({ from: e.from, to: e.to, pool: e.pool, poolType: e.poolType })),
            profitPct,
            product,
            liquidityScore: Math.min(...edges.map(e => Math.min(e.reserve0 || 0, e.reserve1 || 0))),
          });
        }
        return;
      }
      if (depth >= maxHops) return;

      for (const edge of (graph.get(current) || [])) {
        if (visitedPools.has(edge.pool)) continue;
        if (edge.to === start) {
          if (depth >= 2) {
            visitedPools.add(edge.pool);
            edges.push(edge);
            dfs(edge.to, depth + 1);
            edges.pop();
            visitedPools.delete(edge.pool);
          }
          continue;
        }
        if (visitedTokens.has(edge.to)) continue;

        visitedPools.add(edge.pool);
        visitedTokens.add(edge.to);
        edges.push(edge);
        dfs(edge.to, depth + 1);
        edges.pop();
        visitedTokens.delete(edge.to);
        visitedPools.delete(edge.pool);
      }
    }
    dfs(start, 0);
  }

  // Deduplicar por conjunto de pools (ordem irrelevante)
  const seen = new Set();
  const unique = [];
  for (const c of cycles) {
    const key = c.route.map(s => s.pool).sort().join('|');
    if (!seen.has(key)) { seen.add(key); unique.push(c); }
  }

  return unique.sort((a, b) => b.profitPct - a.profitPct);
}

module.exports = { buildGraph, findCycles };
