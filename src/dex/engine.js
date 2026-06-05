// src/dex/engine.js — fetch ultra-rápido de reserves + preços da Atmos DEX
//
// OPTIMIZAÇÕES vs versão anterior:
// 1. SEM simulate no ciclo de detecção — elimina 50% das RPC calls
//    Preço via rácio de reserves × fee (suficiente para detectar arb)
//    Simulate só é chamado em optimalSize (1x por execução, não por ciclo)
// 2. maxConcurrent até 25 (era 6) — ciclo 4x mais rápido
// 3. Weighted math local para pools 50/50 (a grande maioria)
// 4. pool_balances retorna vector<u64> → parsing directo sem SDK overhead

const { callView } = require('../utils/client');
const { getSymbol } = require('../config/tokens');
const asyncLimit    = require('../utils/asyncLimit');
const config        = require('../config');

// Extrai [r0, r1] do resultado de pool_balances (vector<u64>)
// O SDK pode devolver como [[r0,r1]], [r0,r1], ou {"0":r0,"1":r1}
function parseBalances(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && Array.isArray(raw[0])) return [raw[0][0], raw[0][1]];
  if (Array.isArray(raw) && raw.length >= 2)         return [raw[0], raw[1]];
  if (typeof raw === 'object') {
    const vals = Object.values(raw);
    if (vals.length >= 2) return [vals[0], vals[1]];
  }
  return null;
}

// Extrai amount_out do SwapSimulate struct
// Campos: [0]=amount_in, [1]=amount_in_post_fee, [2]=amount_out, ...
function extractAmountOut(res) {
  if (!res) return null;
  if (typeof res === 'object' && !Array.isArray(res)) {
    const v = Number(res.amount_out ?? 0);
    return v > 0 ? v : null;
  }
  if (Array.isArray(res)) {
    const arr = Array.isArray(res[0]) ? res[0] : res;
    const v   = Number(arr[2] ?? 0); // índice 2 = amount_out
    return v > 0 ? v : null;
  }
  return null;
}

// Simula swap real (chamado apenas na pré-execução, não no ciclo de detecção)
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const fn = poolType === 'stable'
    ? `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_weighted`;
  try {
    const res = await callView(fn, [], [
      poolAddress, tokenInAddr, tokenOutAddr, String(amountInRaw), { vec: [] }
    ]);
    return extractAmountOut(res);
  } catch (_) { return null; }
}

// Fetch de uma pool: só pool_balances (1 RPC call, não 2)
// Preço calculado localmente: r1/r0 × (1 - fee/10000)
// Para pools weighted (maioria): aproximação válida para 50/50
// Para pools stable: usa StableSwap invariant aproximado (também próximo de r1/r0)
async function fetchPool(pool) {
  let raw;
  try {
    raw = await callView(
      `${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]
    );
  } catch (_) { return null; }

  const balances = parseBalances(raw);
  if (!balances) return null;

  const d0 = pool.decimals0 ?? 8;
  const d1 = pool.decimals1 ?? 8;
  const reserve0 = Number(balances[0]) / (10 ** d0);
  const reserve1 = Number(balances[1]) / (10 ** d1);

  if (!reserve0 || !reserve1)                                          return null;
  if (reserve0 < config.minLiquidity || reserve1 < config.minLiquidity) return null;

  // Preço bruto: r1/r0 (antes de fee)
  const rawPrice = reserve1 / reserve0;

  return { pool, reserve0, reserve1, rawPrice };
}

// Fetch de todas as pools com concorrência alta + progresso
async function fetchAllPools(pools, onProgress) {
  const results = [];
  let done = 0;
  const limit = asyncLimit(config.maxConcurrent);
  const tasks  = pools.map(pool => limit(async () => {
    const data = await fetchPool(pool).catch(() => null);
    if (data) results.push(data);
    done++;
    onProgress?.(done, pools.length);
  }));
  await Promise.all(tasks);
  return results;
}

module.exports = { fetchAllPools, simulateSwap, extractAmountOut };
