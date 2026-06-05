// src/config/index.js — configuração central do bot
require('dotenv').config();

const config = {
  // ── RPC ──────────────────────────────────────────────────────────────────
  rpc: process.env.RPC_URL || 'https://rpc-mainnet.supra.com',

  // ── Atmos DEX ────────────────────────────────────────────────────────────
  atmosModule: '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234',
  poolsFile:   'data/pools.json',

  // ── Loop principal ───────────────────────────────────────────────────────
  pollIntervalMs: 6000,
  maxConcurrent:  6,

  // ── View calls ───────────────────────────────────────────────────────────
  viewTimeoutMs: 10000,
  viewRetries:   2,

  // ── Detecção de arbitragem ───────────────────────────────────────────────
  minProfitPercent: 0.05,   // % mínimo para MOSTRAR no TUI
  maxHops:          4,      // máximo de hops por ciclo (3=tri, 4=quad)
  minLiquidity:     500,    // reserva mínima por lado da pool (token units)

  // ── Execução ─────────────────────────────────────────────────────────────
  execution: {
    autoExecute:       false,   // OFF por defeito — ligar com [A] no TUI
    minProfitPercent:  0.35,    // % mínimo para EXECUTAR
    minAmountIn:       5,       // SUPRA mínimo por trade
    maxAmountIn:       5000,    // SUPRA máximo por trade
    gasReserveSUPRA:   0.5,     // nunca usar abaixo deste saldo
    cooldownMs:        8000,
    slippageTolerance: 0.005,   // 0.5% por hop
    maxGasAmount:      15000,
    gasUnitPrice:      100,
  },

  // ── Optimal size (ternary search) ────────────────────────────────────────
  optimalSearch: {
    iterations: 18,
  },
};

module.exports = config;
