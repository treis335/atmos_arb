// src/core/detector.js — DFS optimizado para ciclos de arbitragem
//
// OPTIMIZAÇÕES:
// - Early termination CONSERVADOR: só corta se produto × 1^N < 0.001 (não 1+minProfit)
// - Sem corte por produto parcial — evita falsos negativos
// - MAX_RESULTS para evitar OOM
// - Dedup por sorted pool keys

const config = require('../config');
const MAX_RESULTS = 300;

function findCycles(graph, minProfitPct, maxHops) {
  minProfitPct = minProfitPct ?? config.minProfitPercent ?? 0.05;
  maxHops      = maxHops      ?? config.maxHops ?? 4;
  const minProduct = 1 + minProfitPct / 100;

  const cycles   = [];
  const seenKeys = new Set();

  for (const start of graph.keys()) {
    const edges   = [];
    const visited = new Set([start]); // tokens visitados (não pools)
    const usedPools = new Set();
    let product = 1;

    function dfs(node, depth) {
      if (cycles.length >= MAX_RESULTS) return;

      // Ciclo fechado de volta ao início
      if (depth >= 2 && node === start) {
        if (product >= minProduct) {
          const key = edges.map(e => e.pool).sort().join('|');
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cycles.push({
              route: edges.map(e => ({
                from: e.from, to: e.to,
                pool: e.pool, poolType: e.poolType, feeBps: e.feeBps,
              })),
              profitPct:    (product - 1) * 100,
              product,
              liquidityMin: Math.min(...edges.map(e =>
                Math.min(e.reserve0 || 0, e.reserve1 || 0)
              )),
            });
          }
        }
        return;
      }

      if (depth >= maxHops) return;

      for (const edge of (graph.get(node) || [])) {
        if (usedPools.has(edge.pool)) continue;

        // Permitir fechar o ciclo para start
        if (edge.to === start) {
          if (depth >= 2) {
            usedPools.add(edge.pool);
            edges.push(edge);
            const prev = product;
            product *= edge.price;
            dfs(start, depth + 1);
            product = prev;
            edges.pop();
            usedPools.delete(edge.pool);
          }
          continue;
        }

        // Não revisitar tokens intermédios
        if (visited.has(edge.to)) continue;

        usedPools.add(edge.pool);
        visited.add(edge.to);
        edges.push(edge);
        const prev = product;
        product *= edge.price;
        dfs(edge.to, depth + 1);
        product = prev;
        edges.pop();
        visited.delete(edge.to);
        usedPools.delete(edge.pool);
      }
    }

    dfs(start, 0);
    if (cycles.length >= MAX_RESULTS) break;
  }

  return cycles.sort((a, b) => b.profitPct - a.profitPct);
}

module.exports = { findCycles };
