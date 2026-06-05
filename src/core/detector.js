// src/core/detector.js — DFS para encontrar ciclos de arbitragem no grafo
// Retorna ciclos ordenados por profitPct (maior primeiro), sem duplicados.

const config = require('../config');

function findCycles(graph, minProfitPct, maxHops) {
  minProfitPct = minProfitPct ?? config.minProfitPercent;
  maxHops      = maxHops      ?? config.maxHops;

  const cycles = [];

  for (const start of graph.keys()) {
    const edges        = [];
    const visitedPools = new Set();
    const visitedNodes = new Set([start]);

    function dfs(current, depth) {
      // Fechou o ciclo?
      if (depth >= 2 && current === start) {
        let product = 1;
        for (const e of edges) product *= e.price;
        const profitPct = (product - 1) * 100;
        if (profitPct >= minProfitPct) {
          cycles.push({
            route: edges.map(e => ({
              from: e.from, to: e.to,
              pool: e.pool, poolType: e.poolType,
            })),
            profitPct,
            product,
            // Liquidez mínima do ciclo (proxy para risco de slippage)
            liquidityMin: Math.min(...edges.map(e => Math.min(e.reserve0 || 0, e.reserve1 || 0))),
          });
        }
        return;
      }
      if (depth >= maxHops) return;

      for (const edge of (graph.get(current) || [])) {
        if (visitedPools.has(edge.pool)) continue;

        if (edge.to === start) {
          // Só fecha se tiver pelo menos 2 hops percorridos
          if (depth >= 2) {
            visitedPools.add(edge.pool);
            edges.push(edge);
            dfs(start, depth + 1);
            edges.pop();
            visitedPools.delete(edge.pool);
          }
          continue;
        }

        if (visitedNodes.has(edge.to)) continue;

        visitedPools.add(edge.pool);
        visitedNodes.add(edge.to);
        edges.push(edge);
        dfs(edge.to, depth + 1);
        edges.pop();
        visitedNodes.delete(edge.to);
        visitedPools.delete(edge.pool);
      }
    }

    dfs(start, 0);
  }

  // Deduplicar: ciclos com o mesmo conjunto de pools são equivalentes
  const seen = new Set();
  return cycles
    .filter(c => {
      const key = c.route.map(e => e.pool).sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.profitPct - a.profitPct);
}

module.exports = { findCycles };
