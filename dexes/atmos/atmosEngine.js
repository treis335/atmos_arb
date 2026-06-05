// dexes/atmos/atmosEngine.js
// Fetch de reservas e simulação de swaps para a DEX Atmos (Supra FA tokens)
// Suporta pools weighted e stable.

const { CONFIG } = require('../../config/config');
const { callView } = require('../../utils/callView');

const typeToKey = {};
function buildTypeMap() {
  for (const [key, info] of Object.entries(CONFIG.tokens)) {
    typeToKey[info.type] = key;
  }
}
buildTypeMap();

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

function resolveKey(type) {
  if (typeToKey[type]) return typeToKey[type];
  const short = type.includes('::') ? type.split('::').pop() : 'FA_' + type.slice(2, 10);
  typeToKey[type] = short;
  CONFIG.tokens[short] = { type, decimals: 1e8, symbol: short };
  return short;
}

async function fetchPoolState(pool) {
  const mod = CONFIG.atmos.moduleAddress;

  let reserve0, reserve1;
  try {
    const raw = await callView(`${mod}::liquidity_pool::pool_balances`, [], [pool.address]);
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
  if (reserve0 < CONFIG.atmos.minLiquidity || reserve1 < CONFIG.atmos.minLiquidity) return null;

  const d0 = pool.decimals0 ?? 8;
  const d1 = pool.decimals1 ?? 8;
  const probeRaw = 10 ** d0;
  const fn = pool.poolType === 'stable'
    ? `${mod}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${mod}::liquidity_pool::simulate_swap_exact_in_weighted`;

  let priceAB;
  try {
    const sim = await callView(fn, [], [
      pool.address, pool.token0Type, pool.token1Type,
      String(probeRaw), { vec: [] },
    ]);
    const out = extractAmountOut(sim);
    priceAB = (out != null && out > 0) ? out / (10 ** d1) : reserve1 / reserve0;
  } catch (_) {
    priceAB = reserve1 / reserve0;
  }

  const keyA = resolveKey(pool.token0Type);
  const keyB = resolveKey(pool.token1Type);
  const fee = Number(pool.swapFeeBps ?? 30);

  const state = {
    dex: 'ATMOS',
    tokenA: keyA,
    tokenB: keyB,
    curve: pool.poolType,
    poolAddress: pool.address,
    reserveA: reserve0,
    reserveB: reserve1,
    priceAinB: priceAB,
    fee,
    feeScale: 10000,
    _pool: pool,
  };

  state._simulate = (direction, amountIn) => {
    if (!amountIn || amountIn <= 0) return 0;
    const decIn  = direction === 'AB' ? d0 : d1;
    const decOut = direction === 'AB' ? d1 : d0;
    const resIn  = direction === 'AB' ? reserve0 : reserve1;
    const resOut = direction === 'AB' ? reserve1 : reserve0;
    if (resIn <= 0 || resOut <= 0) return 0;
    const feeMultiplier = 1 - fee / 10000;
    const amtInRaw = amountIn * (10 ** decIn);
    const amtInFee = amtInRaw * feeMultiplier;
    const amtOutRaw = (amtInFee * resOut * (10 ** decOut)) / (resIn * (10 ** decIn) + amtInFee);
    return amtOutRaw / (10 ** decOut);
  };

  return state;
}

async function fetchAllAtmosPools(atmosPools, maxConcurrent) {
  maxConcurrent = maxConcurrent || CONFIG.maxConcurrent;
  const results = [];
  const queue = [...atmosPools];
  const worker = async () => {
    while (queue.length) {
      const pool = queue.shift();
      const s = await fetchPoolState(pool).catch(() => null);
      if (s) results.push(s);
    }
  };
  await Promise.all(Array.from({ length: maxConcurrent }, worker));
  return results;
}

module.exports = { fetchAllAtmosPools, fetchPoolState };
