// scripts/discover.js — descobre todas as pools Atmos e guarda em data/pools.json
// Uso: node scripts/discover.js
require('dotenv').config();
const { SupraClient } = require('supra-l1-sdk');
const fs   = require('fs');
const path = require('path');
const config = require('../src/config');

const ATMOS = config.atmosModule;

async function getTokenInfo(client, tokenObject) {
  const address = tokenObject.inner || tokenObject;
  if (address === '0xa') return { type: '0x1::supra_coin::SupraCoin', decimals: 8 };
  try {
    const d = await client.invokeViewMethod(`${ATMOS}::coin_utils::get_coin_detail`, [address, '0']);
    return { type: d.coin_type_info || address, decimals: Number(d.decimals ?? 8) };
  } catch (_) {
    return { type: address, decimals: 8 };
  }
}

async function main() {
  console.log('🔍 A conectar ao RPC Supra...');
  const client = await SupraClient.init(config.rpc);

  console.log('📋 A obter lista de pools Atmos...');
  const result = await client.invokeViewMethod(`${ATMOS}::liquidity_pool::get_pools`, [], []);
  const poolsArray = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;

  if (!poolsArray?.length) { console.error('❌ Nenhuma pool encontrada.'); process.exit(1); }
  console.log(`✅ ${poolsArray.length} pools encontradas.`);

  const pools = [];
  for (let i = 0; i < poolsArray.length; i++) {
    const poolAddr = poolsArray[i];
    process.stdout.write(`\r  Processando ${i+1}/${poolsArray.length}...`);
    try {
      const raw = await client.invokeViewMethod(`${ATMOS}::liquidity_pool::get_pool_details`, [], [poolAddr]);
      if (!raw?.[0]) continue;
      const d = raw[0];
      const assets = d.assets_metadata;
      if (!assets || assets.length < 2) continue;
      const t0 = await getTokenInfo(client, assets[0]);
      const t1 = await getTokenInfo(client, assets[1]);
      pools.push({
        address: poolAddr,
        token0Type: t0.type, decimals0: t0.decimals,
        token1Type: t1.type, decimals1: t1.decimals,
        poolType: d.pool_type === 100 ? 'stable' : 'weighted',
        swapFeeBps: d.swap_fee_bps,
      });
    } catch (_) {}
    await new Promise(r => setTimeout(r, 8));
  }

  const outPath = path.join(process.cwd(), 'data', 'pools.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(pools, null, 2));
  console.log(`\n\n✅ ${pools.length} pools guardadas em data/pools.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
