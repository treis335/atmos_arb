// src/config/index.js — configuração central do bot
require('dotenv').config();

const config = {
  // ── RPC ──────────────────────────────────────────────────────────────────
  rpc:           process.env.RPC_URL || 'https://rpc-mainnet.supra.com',
  atmosModule:   '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234',
  poolsFile:     'data/pools.json',   // 585 pools (todas)

  // ── Performance ──────────────────────────────────────────────────────────
  pollingMs:     4000,
  maxConcurrent: 15,       // 15 calls paralelos — evita 429 no RPC
  viewTimeoutMs: 10000,
  viewRetries:   2,

  // ── EMA / histórico ──────────────────────────────────────────────────────
  emaAlpha:    0.30,
  tickHistory: 12,

  // ── Detecção ─────────────────────────────────────────────────────────────
  minProfitPct: 0.10,  // % mínimo para MOSTRAR
  minLiquidity: 50,    // reserva mínima em token units (50 tokens cada lado)
  maxHops:      4,

  // ── Optimal size ─────────────────────────────────────────────────────────
  // max é limitado dinamicamente a 5% da liquidez da pool (ver optimalSize.js)
  // para evitar lucros fictícios de xy=k com input > reserva
  optimalSearch: {
    min:        1,       // SUPRA mínimo por trade
    max:        500,     // SUPRA máximo (limitado pela liquidez real da pool)
    iterations: 20,
  },

  // ── Score ─────────────────────────────────────────────────────────────────
  scoreWeights: { profit: 0.60, liquidity: 0.25, trend: 0.15 },

  // ── Auto-execução ─────────────────────────────────────────────────────────
  autoExecute: {
    enabled:           false,
    minProfitPct:      0.35,
    minScore:          25,
    gasReserveSUPRA:   0.5,
    cooldownMs:        6000,
    slippageTolerance: 0.005,
    maxGasAmount:      15000,
    gasUnitPrice:      100,
  },
};

module.exports = config;
