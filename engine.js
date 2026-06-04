// engine.js — preços reais via simulate_swap (weighted + stable)
const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');
const { getSymbol } = require('./tokenRegistry');

let _client = null;

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// Simula swap real: devolve amount_out para amount_in numa pool
// Suporta weighted e stable pools
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const client = await getClient();

  // Stable pools usam função diferente
  const fn = poolType === 'stable'
    ? `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${config.atmosModule}::liquidity_pool::simulate_swap_exact_in_weighted`;

  try {
    const result = await client.invokeViewMethod(
      fn,
      [],
      [poolAddress, tokenInAddr, tokenOutAddr, String(amountInRaw), '{"vec":[]}']
    );
    if (!result) return null;
    const amountOut = Number(result.amount_out ?? result[2] ?? 0);
    return amountOut > 0 ? amountOut : null;
  } catch (_) { return null; }
}

// Para o grafo: pool_balances para filtrar pools vazias + simulate para preço real
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

    // Usar decimais do pools.json (fonte de verdade para FA tokens)
    const dec0 = pool.decimals0 ?? 8;
    const dec1 = pool.decimals1 ?? 8;
    const reserve0 = Number(r0) / (10 ** dec0);
    const reserve1 = Number(r1) / (10 ** dec1);

    if (!reserve0 || !reserve1) return null;
    if (reserve0 < config.minLiquidity || reserve1 < config.minLiquidity) return null;

    // Preço real via simulate: 1 token0 como probe
    const probeRaw = 10 ** dec0;
    const amountOutRaw = await simulateSwap(
      pool.address, pool.token0Type, pool.token1Type, probeRaw, pool.poolType
    );

    let rawPrice;
    if (amountOutRaw != null && amountOutRaw > 0) {
      rawPrice = amountOutRaw / (10 ** dec1);
    } else {
      // Fallback: rácio de reserves (menos preciso, mas melhor que nada)
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
