// engine.js — preços reais via simulate_swap + fetch reserves
// v2: retry automático, timeout, extractAmountOut robusto
require('dotenv').config();
const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');
const { getSymbol } = require('./tokenRegistry');

let _client = null;

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// Extrai amount_out de qualquer formato que o SDK devolva
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

// callView com retry e timeout
async function callView(fn, typeArgs, args, retries = 2) {
  const client = await getClient();
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await Promise.race([
        client.invokeViewMethod(fn, typeArgs, args),
        new Promise((_, rej) => setTimeout(() => rej(new Error('view timeout')), config.viewTimeoutMs || 10000)),
      ]);
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// Simula swap real — devolve amount_out (raw) ou null se falhar
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const fn = poolType === 'stable'
    ? `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_weighted`;
  try {
    const result = await callView(fn, [], [
      poolAddress, tokenInAddr, tokenOutAddr,
      String(amountInRaw), { vec: [] },
    ]);
    return extractAmountOut(result);
  } catch (_) { return null; }
}

// Fetch reserves + preço via simulate para uma pool
async function fetchReservesForPool(pool) {
  let reserve0, reserve1;
  try {
    const raw = await callView(
      `${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]
    );
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
  const probeRaw = 10 ** d0;

  const amountOutRaw = await simulateSwap(
    pool.address, pool.token0Type, pool.token1Type, probeRaw, pool.poolType
  );

  const rawPrice = (amountOutRaw != null && amountOutRaw > 0)
    ? amountOutRaw / (10 ** d1)
    : reserve1 / reserve0;

  return { pool, reserve0, reserve1, rawPrice };
}

async function fetchAllReserves(pools, onProgress) {
  const results = [];
  let completed = 0;
  const queue = [...pools];

  const worker = async () => {
    while (queue.length) {
      const pool = queue.shift();
      const data = await fetchReservesForPool(pool).catch(() => null);
      if (data) results.push(data);
      completed++;
      if (onProgress) onProgress(completed, pools.length);
    }
  };

  await Promise.all(Array.from({ length: config.maxConcurrent }, worker));
  return results;
}

function friendlyToken(addr) { return getSymbol(addr); }

module.exports = { fetchAllReserves, friendlyToken, simulateSwap, extractAmountOut, callView };
