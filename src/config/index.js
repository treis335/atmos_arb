// src/config/index.js
require('dotenv').config();

module.exports = {
  rpc:         process.env.RPC_URL || 'https://rpc-mainnet.supra.com',
  atmosModule: '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234',
  poolsFile:   'data/pools_relevant.json',

  // ── Loop ────────────────────────────────────────────────────────────────
  pollIntervalMs: 5000,
  maxConcurrent:  20,       // fallback individual (batch usa asyncLimit(4))

  // ── View calls ──────────────────────────────────────────────────────────
  viewTimeoutMs: 10000,
  viewRetries:   1,

  // ── Detecção ────────────────────────────────────────────────────────────
  minProfitPercent: 0.05,
  maxHops:          4,
  minLiquidity:     100,    // token units após decimais (cada lado da pool)

  // ── Execução ────────────────────────────────────────────────────────────
  execution: {
    autoExecute:       false,
    minProfitPercent:  0.3,
    minAmountIn:       5,
    maxAmountIn:       2000,
    gasReserveSUPRA:   0.5,
    cooldownMs:        8000,
    slippageTolerance: 0.005,
    maxGasAmount:      20000,
    gasUnitPrice:      100,
  },

  // ── Ternary search ──────────────────────────────────────────────────────
  optimalSearch: { iterations: 12 },
};
