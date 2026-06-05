// src/core/detector.js — DFS para encontrar ciclos de arbitragem
//
// OPTIMIZAÇÕES:
// - Early termination: abandona ramo se produto acumulado × max_possível < 1
// - Limit de ciclos: para após encontrar os N mais lucrativos (evita OOM)
// - Dedup rápido por Set de pool addresses ordenadas

const config = require('../config');

const MAX_RESULTS = 200; // máximo de ciclos a retornar

function findCycles(graph, minProfitPct, maxHops) {
  minProfitPct = minProfitPct ?? config.minProfitPercent;
  maxHops      = maxHops      ?? config.maxHops;

  const cycles       = [];
  const seenKeys     = new Set();

  for (const start of graph.keys()) {
    const edges        = [];
    const visitedPools = new Set();
    const visitedNodes = new Set([start]);
    let   product      = 1;

    function dfs(current, depth) {
      // Ciclo fechado
      if (depth >= 2 && current === start) {
        const profitPct = (product - 1) * 100;
        if (profitPct >= minProfitPct) {
          const key = edges.map(e => e.pool).sort().join('|');
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cycles.push({
              route: edges.map(e => ({
                from: e.from, to: e.to,
                pool: e.pool, poolType: e.poolType,
              })),
              profitPct,
              product,
              liquidityMin: Math.min(...edges.map(e => Math.min(e.reserve0 || 0, e.reserve1 || 0))),
            });
          }
        }
        return;
      }

      if (depth >= maxHops) return;
      if (cycles.length >= MAX_RESULTS) return;

      for (const edge of (graph.get(current) || [])) {
        if (visitedPools.has(edge.pool)) continue;

        // Early termination: se mesmo com price=1 para hops restantes não chega a minProfit, skip
        const remaining = maxHops - depth - 1;
        if (product * edge.price * Math.pow(1, remaining) < (1 + minProfitPct / 100) * 0.01) continue;

        if (edge.to === start) {
          if (depth >= 2) {
            visitedPools.add(edge.pool);
            edges.push(edge);
            const prev = product;
            product *= edge.price;
            dfs(start, depth + 1);
            product = prev;
            edges.pop();
            visitedPools.delete(edge.pool);
          }
          continue;
        }

        if (visitedNodes.has(edge.to)) continue;

        visitedPools.add(edge.pool);
        visitedNodes.add(edge.to);
        edges.push(edge);
        const prev = product;
        product *= edge.price;
        dfs(edge.to, depth + 1);
        product = prev;
        edges.pop();
        visitedNodes.delete(edge.to);
        visitedPools.delete(edge.pool);
      }
    }

    dfs(start, 0);
    if (cycles.length >= MAX_RESULTS) break;
  }

  return cycles.sort((a, b) => b.profitPct - a.profitPct);
}

module.exports = { findCycles };
