// src/dex/engine.js — fetch de reserves e simulação de swaps da DEX Atmos
// Cada pool devolve: { pool, reserve0, reserve1, rawPrice }
// rawPrice = quantos token1 por 1 token0, já com fee reflectido

const { callView } = require('../utils/client');
const { getSymbol, registerRuntime } = require('../config/tokens');
const asyncLimit = require('../utils/asyncLimit');
const config = require('../config');

// Extrai amount_out do resultado do SDK (suporta todos os formatos conhecidos)
function extractAmountOut(res) {
  if (!res) return null;
  if (typeof res === 'object' && !Array.isArray(res)) {
    const v = Number(res.amount_out ?? 0);
    return v > 0 ? v : null;
  }
  if (Array.isArray(res)) {
    const arr = Array.isArray(res[0]) ? res[0] : res;
    const v = Number(arr[2] ?? 0);
    return v > 0 ? v : null;
  }
  return null;
}

// Simula um swap na Atmos e devolve amount_out raw, ou null se falhar
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const fn = poolType === 'stable'
    ? `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_weighted`;
  try {
    const res = await callView(fn, [], [poolAddress, tokenInAddr, tokenOutAddr, String(amountInRaw), { vec: [] }]);
    return extractAmountOut(res);
  } catch (_) { return null; }
}

// Fetch completo de uma pool: reserves + preço via simulate
async function fetchPool(pool) {
  let reserve0, reserve1;
  try {
    const raw = await callView(`${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]);
    let arr;
    if (Array.isArray(raw) && Array.isArray(raw[0])) arr = raw[0];
    else if (Array.isArray(raw)) arr = raw;
    else arr = Object.values(raw);
    if (!arr || arr.length < 2) return null;
    const d0 = pool.decimals0 ?? 8;
    const d1 = pool.decimals1 ?? 8;
    reserve0 = Number(arr[0]) / (10 ** d0);
    reserve1 = Number(arr[1]) / (10 ** d1);
  } catch (_) { return null; }

  if (!reserve0 || !reserve1) return null;
  if (reserve0 < config.minLiquidity || reserve1 < config.minLiquidity) return null;

  const d0 = pool.decimals0 ?? 8;
  const d1 = pool.decimals1 ?? 8;
  const outRaw = await simulateSwap(pool.address, pool.token0Type, pool.token1Type, 10 ** d0, pool.poolType);
  const rawPrice = (outRaw != null && outRaw > 0)
    ? outRaw / (10 ** d1)
    : reserve1 / reserve0;

  return { pool, reserve0, reserve1, rawPrice };
}

// Fetch de todas as pools com progresso opcional
async function fetchAllPools(pools, onProgress) {
  const results = [];
  let done = 0;
  const limit = asyncLimit(config.maxConcurrent);
  const tasks = pools.map(pool => limit(async () => {
    const data = await fetchPool(pool).catch(() => null);
    if (data) results.push(data);
    done++;
    onProgress?.(done, pools.length);
  }));
  await Promise.all(tasks);
  return results;
}

module.exports = { fetchAllPools, simulateSwap, extractAmountOut };
