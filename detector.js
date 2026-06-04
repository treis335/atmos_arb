// detector.js — grafo + ciclos de arbitragem (3 e 4 hops)
const config = require('./config');

function buildGraph(reservesData) {
  const graph = new Map();
  for (const r of reservesData) {
    const { pool, rawPrice } = r;
    const fee = 1 - (Number(pool.swapFeeBps) || 0) / 10000;
    const t0 = pool.token0Type;
    const t1 = pool.token1Type;
    if (!graph.has(t0)) graph.set(t0, []);
    if (!graph.has(t1)) graph.set(t1, []);
    graph.get(t0).push({ to: t1, price: rawPrice * fee, pool: pool.address, from: t0, reserve0: r.reserve0, reserve1: r.reserve1 });
    graph.get(t1).push({ to: t0, price: (1 / rawPrice) * fee, pool: pool.address, from: t1, reserve0: r.reserve1, reserve1: r.reserve0 });
  }
  return graph;
}

function findCycles(graph, minProfit, maxHops = 3) {
  const cycles = [];
  const tokens = Array.from(graph.keys());

  for (const start of tokens) {
    const edges = [];
    const visitedPools = new Set();

    function dfs(current, depth) {
      if (depth > 0 && current === start) {
        let product = 1;
        for (const e of edges) product *= e.price;
        const profitPct = (product - 1) * 100;
        if (profitPct >= minProfit) {
          cycles.push({
            route: edges.map(e => ({ from: e.from, to: e.to, pool: e.pool })),
            profitPct,
            product,
            // optimal amount estimate based on smallest reserve (simplified)
            liquidityScore: Math.min(...edges.map(e => e.reserve0 || 0)),
          });
        }
        return;
      }
      if (depth >= maxHops) return;

      const neighbors = graph.get(current) || [];
      for (const edge of neighbors) {
        if (visitedPools.has(edge.pool)) continue;
        if (depth < maxHops - 1 && edge.to === start) {
          // Only allow early close at exactly depth+1 == maxHops
          if (depth + 1 < 2) continue; // minimum 3 hops
        }
        if (depth < maxHops - 1 && edge.to !== start) {
          // Avoid revisiting tokens mid-path (except start)
          const inPath = edges.some(e => e.to === edge.to);
          if (inPath) continue;
        }

        visitedPools.add(edge.pool);
        edges.push(edge);
        dfs(edge.to, depth + 1);
        edges.pop();
        visitedPools.delete(edge.pool);
      }
    }
    dfs(start, 0);
  }

  // Deduplicar: ciclos com as mesmas pools (diferente ponto de partida)
  const seen = new Set();
  const unique = [];
  for (const c of cycles) {
    const key = c.route.map(s => s.pool).sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  return unique.sort((a, b) => b.profitPct - a.profitPct);
}

module.exports = { buildGraph, findCycles };
