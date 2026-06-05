// src/config/index.js — configuração central do bot
require('dotenv').config();

const config = {
  // ── RPC ──────────────────────────────────────────────────────────────────
  rpc: process.env.RPC_URL || 'https://rpc-mainnet.supra.com',

  // ── Atmos DEX ────────────────────────────────────────────────────────────
  atmosModule: '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234',
  poolsFile:   'data/pools_relevant.json',   // usar pools_relevant (281) em vez de todas (585)

  // ── Loop principal ───────────────────────────────────────────────────────
  pollIntervalMs: 4000,       // 4s entre ciclos (era 6s)
  maxConcurrent:  25,         // 25 calls paralelos (era 6) — mais rápido sem rate limit

  // ── View calls ───────────────────────────────────────────────────────────
  viewTimeoutMs: 8000,
  viewRetries:   1,           // 1 retry (era 2) — falha rápido, pool é ignorada

  // ── Detecção de arbitragem ───────────────────────────────────────────────
  minProfitPercent: 0.05,     // % mínimo para MOSTRAR (inclui fee)
  maxHops:          4,        // máximo de hops por ciclo
  minLiquidity:     100,      // reserva mínima por lado (token units, decimals já aplicados)

  // ── Execução ─────────────────────────────────────────────────────────────
  execution: {
    autoExecute:       false,   // OFF por defeito — ligar com [A] no TUI
    minProfitPercent:  0.3,     // % mínimo para EXECUTAR (após simulate real)
    minAmountIn:       5,       // SUPRA mínimo por trade
    maxAmountIn:       2000,    // SUPRA máximo por trade
    gasReserveSUPRA:   0.5,     // nunca usar abaixo deste saldo
    cooldownMs:        6000,    // 6s entre execuções
    slippageTolerance: 0.005,   // 0.5% por hop
    maxGasAmount:      15000,
    gasUnitPrice:      100,
  },

  // ── Optimal size (ternary search) ────────────────────────────────────────
  optimalSearch: {
    iterations: 14,             // 14 iterações ≈ 0.006% de precisão
  },
};

module.exports = config;
