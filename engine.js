// engine.js — preços reais via simulate_swap (weighted + stable)
// SwapSimulate struct campos: [0]=amount_in, [1]=amount_in_post_fee, [2]=amount_out, ...
const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');
const { getSymbol } = require('./tokenRegistry');

let _client = null;

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// Extrai amount_out do SwapSimulate que o SDK devolve
// O SDK pode devolver struct como objecto nomeado OU como array
function extractAmountOut(swapSim) {
  if (!swapSim) return null;

  // Objecto nomeado (o mais comum com supra-l1-sdk)
  if (typeof swapSim === 'object' && !Array.isArray(swapSim)) {
    const v = Number(swapSim.amount_out ?? 0);
    return v > 0 ? v : null;
  }

  // Array: [amount_in, amount_in_post_fee, amount_out, ...]
  if (Array.isArray(swapSim)) {
    // array nested [[...]] ou flat [...]
    const arr = Array.isArray(swapSim[0]) ? swapSim[0] : swapSim;
    const v = Number(arr[2] ?? 0); // índice 2 = amount_out
    return v > 0 ? v : null;
  }

  return null;
}

// Simula swap real — devolve amount_out (raw) ou null se falhar
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const client = await getClient();
  const fn = poolType === 'stable'
    ? `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_weighted`;

  try {
    const result = await client.invokeViewMethod(fn, [], [
      poolAddress,
      tokenInAddr,
      tokenOutAddr,
      String(amountInRaw),
      { vec: [] },   // Option<address> = None (sem referral)
    ]);
    return extractAmountOut(result);
  } catch (_) { return null; }
}

// Fetch reserves + preço via simulate para uma pool
async function fetchReservesForPool(pool) {
  const client = await getClient();

  // ── 1. Fetch reserves ─────────────────────────────────────────
  let reserve0, reserve1;
  try {
    const raw = await client.invokeViewMethod(
      `${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]
    );

    // pool_balances devolve vector<u64> → SDK envolve em array: [[r0, r1]] ou [r0, r1]
    let arr;
    if (Array.isArray(raw) && Array.isArray(raw[0])) arr = raw[0];
    else if (Array.isArray(raw)) arr = raw;
    else arr = Object.values(raw);

    if (arr.length < 2) return null;

    const dec0 = pool.decimals0 ?? 8;
    const dec1 = pool.decimals1 ?? 8;
    reserve0 = Number(arr[0]) / (10 ** dec0);
    reserve1 = Number(arr[1]) / (10 ** dec1);
  } catch (_) { return null; }

  if (!reserve0 || !reserve1) return null;
  if (reserve0 < config.minLiquidity || reserve1 < config.minLiquidity) return null;

  // ── 2. Preço via simulate (separado do reserves para não perder a pool) ──
  const dec0 = pool.decimals0 ?? 8;
  const dec1 = pool.decimals1 ?? 8;
  const probeRaw = 10 ** dec0; // 1 token0

  const amountOutRaw = await simulateSwap(
    pool.address, pool.token0Type, pool.token1Type, probeRaw, pool.poolType
  );

  const rawPrice = (amountOutRaw != null && amountOutRaw > 0)
    ? amountOutRaw / (10 ** dec1)
    : reserve1 / reserve0; // fallback: rácio de reserves

  return { pool, reserve0, reserve1, rawPrice };
}

async function fetchAllReserves(pools, onProgress) {
  const results = [];
  let completed = 0;
  const queue = [...pools];

  const worker = async () => {
    while (queue.length) {
      const pool = queue.shift();
      const data = await fetchReservesForPool(pool);
      if (data) results.push(data);
      completed++;
      if (onProgress) onProgress(completed, pools.length);
    }
  };

  await Promise.all(Array.from({ length: config.maxConcurrent }, worker));
  return results;
}

function friendlyToken(addr) { return getSymbol(addr); }

module.exports = { fetchAllReserves, friendlyToken, simulateSwap, extractAmountOut };
