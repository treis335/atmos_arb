// test_pool.js
const { SupraClient } = require('supra-l1-sdk');
const fs = require('fs');

const RPC = 'https://rpc-mainnet.supra.com';
const ATMOS_MODULE = '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234';

async function test() {
  const client = await SupraClient.init(RPC);
  const pools = JSON.parse(fs.readFileSync('pools.json', 'utf8'));
  const pool = pools[0]; // primeira pool
  console.log('Testando pool:', pool.poolAddress);
  try {
    const balances = await client.invokeViewMethod(`${ATMOS_MODULE}::liquidity_pool::pool_balances`, [], [pool.poolAddress]);
    console.log('Resposta de pool_balances:', JSON.stringify(balances, null, 2));
  } catch (err) {
    console.error('Erro:', err.message);
    console.error('Resposta completa:', err.response?.data);
  }
}
test();