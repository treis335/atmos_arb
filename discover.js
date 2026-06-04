// discover.js
const { SupraClient } = require('supra-l1-sdk');
const fs = require('fs');
const config = require('./config');

async function getTokenInfo(client, tokenObject) {
  const address = tokenObject.inner;
  if (address === '0xa') {
    return { type: '0x1::supra_coin::SupraCoin', decimals: 8 };
  }
  try {
    const detail = await client.invokeViewMethod(`${config.atmosModule}::coin_utils::get_coin_detail`, [address, '0']);
    return { type: detail.coin_type_info, decimals: detail.decimals };
  } catch (err) {
    console.warn(`Não foi possível obter decimals para ${address}, assumindo 8.`);
    return { type: address, decimals: 8 };
  }
}

async function main() {
  const client = await SupraClient.init(config.rpc);
  console.log('A obter lista de pools...');
  const result = await client.invokeViewMethod(`${config.atmosModule}::liquidity_pool::get_pools`, [], []);
  const poolsArray = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  if (!poolsArray || !poolsArray.length) {
    console.error('Nenhuma pool encontrada.');
    process.exit(1);
  }
  console.log(`Encontradas ${poolsArray.length} pools.`);

  const pools = [];
  for (let i = 0; i < poolsArray.length; i++) {
    const poolAddr = poolsArray[i];
    process.stdout.write(`\rProcessando ${i+1}/${poolsArray.length}...`);
    try {
      const detailsArr = await client.invokeViewMethod(`${config.atmosModule}::liquidity_pool::get_pool_details`, [], [poolAddr]);
      if (!detailsArr || !detailsArr[0]) continue;
      const details = detailsArr[0];
      const assets = details.assets_metadata;
      if (assets.length < 2) continue;
      const token0 = await getTokenInfo(client, assets[0]);
      const token1 = await getTokenInfo(client, assets[1]);
      pools.push({
        address: poolAddr,
        token0Type: token0.type,
        token1Type: token1.type,
        decimals0: token0.decimals,
        decimals1: token1.decimals,
        poolType: details.pool_type === 100 ? 'stable' : 'weighted',
        swapFeeBps: details.swap_fee_bps
      });
    } catch (err) {}
    // pequena pausa para não sobrecarregar
    await new Promise(r => setTimeout(r, 10));
  }
  console.log(`\nGuardadas ${pools.length} pools.`);
  fs.writeFileSync('pools.json', JSON.stringify(pools, null, 2));
  console.log('pools.json criado.');
}

main().catch(console.error);