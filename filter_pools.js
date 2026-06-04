// filter_pools.js
const fs = require('fs');

const allPools = JSON.parse(fs.readFileSync('pools.json', 'utf8'));
const relevantTokens = [
  '0x1::supra_coin::SupraCoin',
  '0x8f7d16ade319b0fce368ca6cdb98589c4527ce7f5b51e544a9e68e719934458b::hyper_coin::DexlynUSDC',
  '0x90a8e901e02ac1539af4a865bbe4a6b96edc27375488803cfbbd6875ec57b281'
];

const relevant = allPools.filter(pool => 
  relevantTokens.includes(pool.token0Type) || relevantTokens.includes(pool.token1Type)
);

console.log(`✅ Total pools: ${allPools.length}`);
console.log(`✅ Pools relevantes: ${relevant.length}`);
fs.writeFileSync('pools_relevant.json', JSON.stringify(relevant, null, 2));
console.log('📁 Guardado em pools_relevant.json');