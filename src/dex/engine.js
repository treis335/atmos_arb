// src/dex/engine.js — fetch paralelo de reserves via axios (rápido)
// Sem simulate no fetch — usa xy=k local para speed.
// Simulate on-chain só é chamado no optimalSize para o trade final.

const { callView } = require('../utils/callView');
const { getSymbol, getDecimals, isKnown } = require('../config/tokens');
const asyncLimit = require('../utils/asyncLimit');
const config = require('../config');

const ATMOS = config.atmosModule;

// AMM xy=k: calcula amount_out dada reserva e fee
function getAmountOut(reserveIn, reserveOut, amountIn, feeBps) {
  if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0;
  const fee = 1 - feeBps / 10000;
  const aIn = amountIn * fee;
  return (aIn * reserveOut) / (reserveIn + aIn);
}

// Fetch de reserves de UMA pool via HTTP directo
async function fetchPool(pool) {
  const d0 = pool.decimals0 ?? 8;
  const d1 = pool.decimals1 ?? 8;

  let raw;
  try {
    raw = await callView(`${ATMOS}::liquidity_pool::pool_balances`, [], [pool.address]);
  } catch (_) { return null; }

  let arr;
  if (Array.isArray(raw) && Array.isArray(raw[0])) arr = raw[0];
  else if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === 'object') arr = Object.values(raw);
  else return null;

  if (!arr || arr.length < 2) return null;

  const reserve0 = Number(arr[0]) / (10 ** d0);
  const reserve1 = Number(arr[1]) / (10 ** d1);

  if (!reserve0 || !reserve1) return null;
  if (reserve0 < config.minLiquidity || reserve1 < config.minLiquidity) return null;

  const feeBps  = Number(pool.swapFeeBps ?? 30);
  const rawPrice = getAmountOut(reserve0, reserve1, 1, feeBps); // preço de 1 token0 em token1

  const symA = getSymbol(pool.token0Type);
  const symB = getSymbol(pool.token1Type);

  return {
    dex: 'ATMOS',
    tokenA:    symA,
    tokenB:    symB,
    addrA:     pool.token0Type,
    addrB:     pool.token1Type,
    decimalsA: d0,
    decimalsB: d1,
    curve:     pool.poolType,
    poolAddr:  pool.address,
    reserveA:  reserve0,
    reserveB:  reserve1,
    fee:       feeBps,
    feeScale:  10000,
    priceAinB: rawPrice,
    // Interface _simulate unificada (igual ao dexlyn_arb_original)
    _simulate(direction, amountIn) {
      if (amountIn <= 0) return 0;
      return direction === 'AB'
        ? getAmountOut(reserve0, reserve1, amountIn, feeBps)
        : getAmountOut(reserve1, reserve0, amountIn, feeBps);
    },
  };
}

// Fetch de todas as pools em paralelo com limite de concorrência
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

// Simulate on-chain para tamanho óptimo (só chamado no optimalSize)
async function simulateSwapOnChain(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const fn = poolType === 'stable'
    ? `${ATMOS}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${ATMOS}::liquidity_pool::simulate_swap_exact_in_weighted`;
  try {
    const res = await callView(fn, [], [poolAddress, tokenInAddr, tokenOutAddr, String(amountInRaw), { vec: [] }]);
    if (!res) return null;
    if (typeof res === 'object' && !Array.isArray(res)) {
      const v = Number(res.amount_out ?? 0);
      return v > 0 ? v : null;
    }
    const arr = Array.isArray(res[0]) ? res[0] : res;
    const v = Number(arr[2] ?? 0);
    return v > 0 ? v : null;
  } catch (_) { return null; }
}

module.exports = { fetchAllPools, fetchPool, simulateSwapOnChain, getAmountOut };
