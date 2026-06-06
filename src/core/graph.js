// src/core/graph.js — grafo de tokens, interface idêntica ao dexlyn_arb_original
function buildGraph(pairStates) {
  const graph = {};
  for (const ps of pairStates) {
    if (!ps || !ps.tokenA || !ps.tokenB) continue;
    if (!graph[ps.tokenA]) graph[ps.tokenA] = [];
    if (!graph[ps.tokenB]) graph[ps.tokenB] = [];
    graph[ps.tokenA].push({ neighbor: ps.tokenB, pair: ps, direction: 'AB' });
    graph[ps.tokenB].push({ neighbor: ps.tokenA, pair: ps, direction: 'BA' });
  }
  return graph;
}

function findCycles(graph, maxLen = 4) {
  const cycles = [];
  const dfs = (start, cur, path, edges, visited) => {
    if (path.length > 1 && cur === start) {
      cycles.push({ path: [...path, start], edges: [...edges] });
      return;
    }
    if (path.length >= maxLen) return;
    for (const edge of (graph[cur] || [])) {
      if (edge.neighbor === start && path.length > 1) {
        cycles.push({ path: [...path, start], edges: [...edges, edge] });
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
  const seen = new Set();
  return cycles.filter(c => {
    const k = c.path.slice(0, -1).sort().join('-');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = { buildGraph, findCycles };
