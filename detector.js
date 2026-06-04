// detector.js
const config = require('./config');

function buildGraph(reservesData) {
  const graph = new Map();
  for (const r of reservesData) {
    const { pool, rawPrice } = r;
    const feeFactor = 1 - pool.swapFeeBps / 10000;
    const price0to1 = rawPrice * feeFactor;
    const price1to0 = (1 / rawPrice) * feeFactor;
    const token0 = pool.token0Type;
    const token1 = pool.token1Type;
    if (!graph.has(token0)) graph.set(token0, []);
    if (!graph.has(token1)) graph.set(token1, []);
    graph.get(token0).push({ to: token1, price: price0to1, pool: pool.address });
    graph.get(token1).push({ to: token0, price: price1to0, pool: pool.address });
  }
  return graph;
}

function findTriangularCycles(graph, minProfit) {
  const cycles = [];
  const tokens = Array.from(graph.keys());

  for (const start of tokens) {
    const visited = new Set();
    const path = [];
    const edges = [];

    function dfs(current, depth) {
      if (depth === 3) {
        if (current === start && edges.length === 3) {
          let product = 1;
          for (const e of edges) product *= e.price;
          const profitPct = (product - 1) * 100;
          if (profitPct >= minProfit) {
            cycles.push({
              route: edges.map(e => ({
                from: e.from,
                to: e.to,
                pool: e.pool.slice(0, 10)
              })),
              profitPct,
              product
            });
          }
        }
        return;
      }
      const neighbors = graph.get(current) || [];
      for (const edge of neighbors) {
        if (depth === 2 && edge.to !== start) continue;
        if (depth < 2 && visited.has(edge.to)) continue;
        visited.add(edge.to);
        edges.push({ ...edge, from: current });
        dfs(edge.to, depth + 1);
        edges.pop();
        visited.delete(edge.to);
      }
    }
    dfs(start, 0);
  }

  // remover duplicados (ciclos iguais começando em tokens diferentes)
  const unique = [];
  const seen = new Set();
  for (const c of cycles) {
    const key = c.route.map(s => s.pool).sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  unique.sort((a, b) => b.profitPct - a.profitPct);
  return unique;
}

module.exports = { buildGraph, findTriangularCycles };