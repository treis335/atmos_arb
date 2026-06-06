// src/config/index.js — configuração central (alinhada com dexlyn_arb_original)
require('dotenv').config();

const config = {
  rpc:          process.env.RPC_URL || 'https://rpc-mainnet.supra.com',
  atmosModule:  '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234',
  poolsFile:    'data/pools.json',

  pollingMs:    3500,
  maxConcurrent: 12,         // mais parallelismo = mais rápido
  viewTimeoutMs: 12000,
  viewRetries:   3,
  emaAlpha:      0.35,
  tickHistory:   12,

  minProfitPct:  0.10,       // % mínimo para MOSTRAR
  minLiquidity:  100,        // reserva mínima por lado (token units)
  maxHops:       4,

  optimalSearch: { min: 10, max: 10000, iterations: 20 },
  scoreWeights:  { profit: 0.60, liquidity: 0.25, trend: 0.15 },

  autoExecute: {
    enabled:        false,
    minProfitPct:   0.35,
    minScore:       25,
    gasReserveSUPRA: 0.09,
    cooldownMs:     5000,
    slippageTolerance: 0.005,
    maxGasAmount:   15000,
    gasUnitPrice:   100,
  },
};
module.exports = config;
