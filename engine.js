// engine.js — preços reais via simulate_swap (weighted + stable)
const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');
const { getSymbol } = require('./tokenRegistry');

let _client = null;

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// Simula swap: devolve amount_out (raw) para amount_in (raw) numa pool
// O contrato devolve um SwapSimulate struct — usamos deconstruct_swap_simulate
// para extrair os valores. O campo [1] = amount_out.
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const client = await getClient();

  const fn = poolType === 'stable'
    ? `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_weighted`;

  try {
    // O SDK serializa os args automaticamente:
    // pool = Object<Pool> (address), tokenIn/Out = Object<Metadata> (address), amount = u64
    // option<address> = {"vec":[]} para sem referral
    const swapSim = await client.invokeViewMethod(fn, [], [
      poolAddress, tokenInAddr, tokenOutAddr, String(amountInRaw), '{"vec":[]}'
    ]);

    if (!swapSim) return null;

    // O SDK pode devolver o struct directamente como objecto ou já desestruturado
    // Tentamos várias formas de extrair amount_out
    let amountOut = null;

    if (swapSim && typeof swapSim === 'object' && !Array.isArray(swapSim)) {
      // Struct com campos nomeados (amount_in, amount_out, ...)
      amountOut = Number(swapSim.amount_out ?? swapSim[1] ?? 0);
    } else if (Array.isArray(swapSim)) {
      // Array de valores — usar deconstruct via segunda chamada ou assumir índice
      // deconstruct_swap_simulate retorna: [amount_in, amount_out, fee_amount, ...]
      if (Array.isArray(swapSim[0])) {
        amountOut = Number(swapSim[0][1] ?? 0);
      } else {
        amountOut = Number(swapSim[1] ?? 0);
      }
    }

    return amountOut > 0 ? amountOut : null;
  } catch (_) { return null; }
}

// Fetch reserves + preço real via simulate para uma pool
async function fetchReservesForPool(pool) {
  const client = await getClient();
  try {
    const raw = await client.invokeViewMethod(
      `${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]
    );

    let r0, r1;
    if (Array.isArray(raw)) {
      if (Array.isArray(raw[0])) { [r0, r1] = raw[0]; }
      else { [r0, r1] = raw; }
    } else if (raw && typeof raw === 'object') {
      [r0, r1] = Object.values(raw);
    } else { return null; }

    if (r0 == null || r1 == null) return null;

    const dec0 = pool.decimals0 ?? 8;
    const dec1 = pool.decimals1 ?? 8;
    const reserve0 = Number(r0) / (10 ** dec0);
    const reserve1 = Number(r1) / (10 ** dec1);

    if (!reserve0 || !reserve1) return null;
    if (reserve0 < config.minLiquidity || reserve1 < config.minLiquidity) return null;

    // Preço real via simulate com 1 token0 como probe
    const probeRaw = 10 ** dec0;
    const amountOutRaw = await simulateSwap(
      pool.address, pool.token0Type, pool.token1Type, probeRaw, pool.poolType
    );

    let rawPrice;
    if (amountOutRaw != null && amountOutRaw > 0) {
      rawPrice = amountOutRaw / (10 ** dec1);
    } else {
      // Fallback: rácio de reserves
      rawPrice = reserve1 / reserve0;
    }

    return { pool, reserve0, reserve1, rawPrice };
  } catch (_) { return null; }
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

module.exports = { fetchAllReserves, friendlyToken, simulateSwap };
