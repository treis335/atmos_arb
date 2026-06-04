// engine.js — fetch reserves para todos os pools Atmos
const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');
const { getSymbol, getDecimals } = require('./tokenRegistry');

let _client = null;
async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

async function fetchReservesForPool(pool) {
  const client = await getClient();
  try {
    const balances = await client.invokeViewMethod(
      `${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]
    );
    if (!balances || balances.length < 2) return null;

    const dec0 = getDecimals(pool.token0Type);
    const dec1 = getDecimals(pool.token1Type);
    const reserve0 = Number(balances[0]) / (10 ** dec0);
    const reserve1 = Number(balances[1]) / (10 ** dec1);

    if (reserve0 === 0 || reserve1 === 0) return null;
    const price = reserve1 / reserve0;

    return { pool, reserve0, reserve1, rawPrice: price };
  } catch (_) { return null; }
}

async function fetchAllReserves(pools, onProgress) {
  const results = [];
  let completed = 0;
  const queue = [...pools];
  const limit = config.maxConcurrent;

  const worker = async () => {
    while (queue.length) {
      const pool = queue.shift();
      const data = await fetchReservesForPool(pool);
      if (data) results.push(data);
      completed++;
      if (onProgress) onProgress(completed, pools.length);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function friendlyToken(addr) {
  return getSymbol(addr);
}

module.exports = { fetchAllReserves, friendlyToken };
