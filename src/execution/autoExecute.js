// src/execution/autoExecute.js — lógica de auto-execução isolada do TUI
// Decide se executa, calcula o tamanho óptimo e chama o executor.

const { findOptimalAmount } = require('../core/optimalSize');
const { executeRoute, fetchWalletBalance } = require('../dex/executor');
const { getSymbol } = require('../config/tokens');
const { logError } = require('../utils/logger');
const config = require('../config');

// Estado interno
let _inProgress    = false;
let _lastExecTime  = 0;
const stats = { sent: 0, success: 0, profitSUPRA: 0 };

function getStats() { return { ...stats }; }

// onLog: function(msg) — recebe mensagens coloridas para o TUI
async function maybeExecute(cycles, reservesData, onLog = () => {}) {
  const cfg = config.execution;
  if (!cfg?.autoExecute)  return;
  if (_inProgress)         return;
  if (!process.env.PRIVATE_KEY || !process.env.SENDER_ADDRESS) return;

  const now = Date.now();
  if (now - _lastExecTime < (cfg.cooldownMs ?? 8000)) return;

  // Filtrar ciclos com lucro suficiente
  const viable = cycles.filter(c => c.profitPct >= (cfg.minProfitPercent ?? 0.35));
  if (!viable.length) return;

  const best = viable[0];
  _inProgress   = true;
  _lastExecTime = now;

  const route = best.route.map(e => ({
    from: e.from, to: e.to, pool: e.pool, poolType: e.poolType,
    fromSymbol: getSymbol(e.from),
    toSymbol:   getSymbol(e.to),
  }));

  const path = route.map(e => e.fromSymbol).join('→');
  onLog(`{yellow-fg}🤖 Auto-exec: +${best.profitPct.toFixed(3)}%  [${path}]{/}`);

  try {
    // Construir poolsMap para o simulador
    const poolsMap = {};
    for (const r of reservesData) {
      poolsMap[r.pool.address] = { ...r.pool, reserve0: r.reserve0, reserve1: r.reserve1 };
    }

    // Saldo disponível
    const balance = await fetchWalletBalance();
    const available = Math.max(0, (balance.SUPRA ?? 0) - (cfg.gasReserveSUPRA ?? 0.5));
    const maxAmt = Math.min(cfg.maxAmountIn ?? 5000, available);

    // Tamanho óptimo via ternary search
    const optimal = await findOptimalAmount(route, poolsMap, cfg.minAmountIn ?? 5, maxAmt);

    if (!optimal || optimal.profitPct < (cfg.minProfitPercent ?? 0.35)) {
      onLog(`{grey-fg}Optimal: lucro insuficiente pós-simulate (${optimal?.profitPct?.toFixed(3) ?? '?'}%){/}`);
      _inProgress = false;
      return;
    }

    onLog(`{grey-fg}Optimal: ${optimal.optimalAmount.toFixed(2)} SUPRA → ~${optimal.profitPct.toFixed(3)}%{/}`);

    // Enriquecer route com outputs do simulate
    const enrichedRoute = route.map((hop, i) => ({
      ...hop,
      amountInRaw:    optimal.hopOutputs[i]?.amountInRaw    ?? 0,
      expectedOutRaw: optimal.hopOutputs[i]?.expectedOutRaw ?? 0,
    }));

    stats.sent++;
    const result = await executeRoute({
      route: enrichedRoute,
      optimalAmountRaw: optimal.optimalAmountRaw,
      poolsMap,
    }, onLog);

    if (result?.success) {
      stats.success++;
      stats.profitSUPRA += optimal.profit;
      onLog(`{green-fg}✅ TX ok! ${result.txHashes.length} hops. Hash: ${result.txHash?.slice(0, 18)}...{/}`);
    } else if (result?.partial) {
      onLog(`{yellow-fg}⚠ Parcial: ${result.txHashes?.length ?? 0} hops executados.{/}`);
    } else {
      onLog(`{red-fg}❌ Execução falhou.{/}`);
    }
  } catch (e) {
    logError('autoExecute', e);
    onLog(`{red-fg}❌ Erro: ${e.message.slice(0, 80)}{/}`);
  }

  _inProgress = false;
}

module.exports = { maybeExecute, getStats };
