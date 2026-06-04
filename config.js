// config.js
module.exports = {
  rpc: 'https://rpc-mainnet.supra.com',
  atmosModule: '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234',
  pollIntervalMs: 8000,          // intervalo entre ciclos (ms)
  maxConcurrent: 20,             // chamadas paralelas para pool_balances
  minProfitPercent: 0.05,        // lucro mínimo para mostrar oportunidade (%)
  relevantTokens: [              // tokens que queremos mostrar na tabela de preços
    '0x1::supra_coin::SupraCoin',
    '0x8f7d16ade319b0fce368ca6cdb98589c4527ce7f5b51e544a9e68e719934458b::hyper_coin::DexlynUSDC',
    '0x90a8e901e02ac1539af4a865bbe4a6b96edc27375488803cfbbd6875ec57b281'
  ]
};