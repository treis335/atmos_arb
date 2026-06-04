// engine.js
const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');

let client = null;

async function getClient() {
  if (!client) client = await SupraClient.init(config.rpc);
  return client;
}

async function fetchReservesForPool(pool) {
  const client = await getClient();
  try {
    const balances = await client.invokeViewMethod(`${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]);
    if (!balances || balances.length < 2) return null;
    const reserve0Raw = Number(balances[0]);
    const reserve1Raw = Number(balances[1]);
    const reserve0 = reserve0Raw / (10 ** pool.decimals0);
    const reserve1 = reserve1Raw / (10 ** pool.decimals1);
    const price = reserve1 / reserve0; // token0 -> token1
    return {
      pool,
      reserve0,
      reserve1,
      rawPrice: price,
    };
  } catch (err) {
    return null;
  }
}

async function fetchAllReserves(pools, onProgress) {
  const results = [];
  let completed = 0;
  const total = pools.length;
  const limit = config.maxConcurrent;
  const queue = [...pools];
  const promises = [];

  const worker = async () => {
    while (queue.length) {
      const pool = queue.shift();
      const data = await fetchReservesForPool(pool);
      if (data) results.push(data);
      completed++;
      if (onProgress) onProgress(completed, total);
    }
  };

  for (let i = 0; i < limit; i++) promises.push(worker());
  await Promise.all(promises);
  return results;
}

function friendlyToken(type) {
  if (type === '0x1::supra_coin::SupraCoin') return 'SUPRA';
  const parts = type.split('::');
  return parts[parts.length - 1] || type.slice(0, 10);
}

module.exports = { fetchAllReserves, friendlyToken };