// engine.js
const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');
const { getSymbol, getDecimals } = require('./tokenRegistry');

let _client = null;
let _debugLogged = false;

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

async function fetchReservesForPool(pool) {
  const client = await getClient();
  try {
    const raw = await client.invokeViewMethod(
      `${config.atmosModule}::liquidity_pool::pool_balances`, [], [pool.address]
    );

    // Log raw format once to debug_balances.json
    if (!_debugLogged) {
      _debugLogged = true;
      require('fs').appendFileSync('debug_balances.json',
        JSON.stringify({ pool: pool.address, raw }, null, 2) + '\n---\n');
    }

    // Normalize response — Atmos returns various formats
    let r0, r1;
    if (Array.isArray(raw)) {
      if (Array.isArray(raw[0])) { [r0, r1] = raw[0]; }
      else { [r0, r1] = raw; }
    } else if (raw && typeof raw === 'object') {
      const vals = Object.values(raw);
      [r0, r1] = vals;
    } else {
      return null;
    }

    if (r0 == null || r1 == null) return null;

    const dec0 = getDecimals(pool.token0Type);
    const dec1 = getDecimals(pool.token1Type);
    const reserve0 = Number(r0) / (10 ** dec0);
    const reserve1 = Number(r1) / (10 ** dec1);

    if (!reserve0 || !reserve1) return null;
    return { pool, reserve0, reserve1, rawPrice: reserve1 / reserve0 };
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

function friendlyToken(addr) { return getSymbol(addr); }

module.exports = { fetchAllReserves, friendlyToken };
