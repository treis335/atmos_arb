// src/core/graph.js — grafo usando endereços FA como nós (necessário para execução)
// Nós = endereço FA do token (ex: '0x1::supra_coin::SupraCoin', '0x4b28...')
// tokenA/tokenB no pair = símbolo legível (para display)
// addrA/addrB no pair   = endereço FA (para execução)

function buildGraph(pairStates) {
  const graph = {};
  for (const ps of pairStates) {
    if (!ps || !ps.addrA || !ps.addrB) continue;
    const a = ps.addrA, b = ps.addrB;
    if (!graph[a]) graph[a] = [];
    if (!graph[b]) graph[b] = [];
    graph[a].push({ neighbor: b, pair: ps, direction: 'AB' });
    graph[b].push({ neighbor: a, pair: ps, direction: 'BA' });
  }
  return graph;
}

function findCycles(graph, maxLen = 4) {
  const cycles = [];
  const { getSymbol } = require('../config/tokens');

  const dfs = (start, cur, path, edges, visited) => {
    if (path.length > 1 && cur === start) {
      cycles.push({
        path: [...path, start].map(a => getSymbol(a)),  // display
        addrs: [...path, start],                          // execução
        edges: [...edges],
      });
      return;
    }
    if (path.length >= maxLen) return;
    for (const edge of (graph[cur] || [])) {
      if (edge.neighbor === start && path.length > 1) {
        cycles.push({
          path: [...path, start].map(a => getSymbol(a)),
          addrs: [...path, start],
          edges: [...edges, edge],
        });
        continue;
      }
      if (!visited.has(edge.neighbor)) {
        visited.add(edge.neighbor);
        dfs(start, edge.neighbor, [...path, edge.neighbor], [...edges, edge], visited);
        visited.delete(edge.neighbor);
      }
    }
  };

  for (const token of Object.keys(graph)) {
    dfs(token, token, [token], [], new Set([token]));
  }

  // Deduplicar por conjunto de pools
  const seen = new Set();
  return cycles.filter(c => {
    const k = c.edges.map(e => e.pair.poolAddr).sort().join('|');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

module.exports = { buildGraph, findCycles };
