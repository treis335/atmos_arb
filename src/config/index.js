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
    enabled:           false,   // [a] no TUI para ligar/desligar
    minProfitPct:      0.30,    // % mínimo REAL (após simulate) para executar
    minScore:          20,      // score mínimo
    gasReserveSUPRA:   0.5,     // SUPRA reservado para gas (nunca gastar abaixo)
    cooldownMs:        8000,    // 8s entre execuções automáticas
    slippageTolerance: 0.005,   // 0.5% slippage por hop
    maxGasAmount:      15000,   // gas máximo por tx
    gasUnitPrice:      100,     // gas price em octas
  },
};

module.exports = config;
