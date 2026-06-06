// src/config/index.js
require('dotenv').config();

module.exports = {
  rpc:           process.env.RPC_URL || 'https://rpc-mainnet.supra.com',
  atmosModule:   '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234',
  poolsFile:     'data/pools_relevant.json', // 281 pools com liquidez (não 585)

  pollingMs:     12000, // 12s entre ciclos — dar folga ao RPC
  maxConcurrent: 5,   // Cloudflare rate limit: max ~5 paralelos
  viewTimeoutMs: 10000,
  viewRetries:   2,

  emaAlpha:    0.30,
  tickHistory: 12,

  minProfitPct: 0.05,
  minLiquidity: 50,
  maxHops:      4,

  optimalSearch: { min: 1, max: 500, iterations: 20 },
  scoreWeights:  { profit: 0.60, liquidity: 0.25, trend: 0.15 },

  autoExecute: {
    enabled:           false,
    minProfitPct:      0.30,
    minScore:          20,
    gasReserveSUPRA:   0.5,
    cooldownMs:        8000,
    slippageTolerance: 0.005,
    maxGasAmount:      15000,
    gasUnitPrice:      100,
  },
};
