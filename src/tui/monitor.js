// src/tui/monitor.js — loop principal do TUI: orquestra tudo
// Lê dados → detecta ciclos → renderiza → executa se AUTO ON

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const config         = require('../config');
const { fetchAllPools }  = require('../dex/engine');
const { fetchWalletBalance } = require('../dex/executor');
const { buildGraph }     = require('../core/graph');
const { findCycles }     = require('../core/detector');
const { maybeExecute, getStats } = require('../execution/autoExecute');
const { createScreen }   = require('./boxes');
const { renderOpps, renderPools, renderStats, renderStatsBar } = require('./render');
const { logError, timestamp } = require('../utils/logger');

// ── Carregar pools ─────────────────────────────────────────────────────────
const poolsPath = path.join(process.cwd(), config.poolsFile);
if (!fs.existsSync(poolsPath)) {
  console.error(`pools.json não encontrado em ${poolsPath}\nCorre: node scripts/discover.js`);
  process.exit(1);
}
const allPools = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));

// ── TUI ────────────────────────────────────────────────────────────────────
const boxes = createScreen();
const { screen } = boxes;

// ── State ──────────────────────────────────────────────────────────────────
let iteration    = 0;
let bestEver     = 0;
let autoExecute  = config.execution?.autoExecute ?? false;
let walletBalance = {};
const logLines   = [];

// ── Log helper ─────────────────────────────────────────────────────────────
function log(msg) {
  logLines.push(`{grey-fg}${timestamp()}{/} ${msg}`);
  if (logLines.length > 300) logLines.shift();
  boxes.logBox.setContent(logLines.join('\n'));
  boxes.logBox.setScrollPerc(100);
  screen.render();
}

// ── Keys ───────────────────────────────────────────────────────────────────
screen.key(['q', 'Q', 'C-c'], () => { screen.destroy(); process.exit(0); });

screen.key(['a', 'A'], () => {
  if (!process.env.PRIVATE_KEY || !process.env.SENDER_ADDRESS) {
    log('{red-fg}⚠ PRIVATE_KEY / SENDER_ADDRESS não configurados no .env{/}');
    return;
  }
  autoExecute = !autoExecute;
  // Propaga para o módulo de execução via config (simples e directo)
  config.execution.autoExecute = autoExecute;
  log(`{yellow-fg}Auto-execução: ${autoExecute ? '🟢 ACTIVADA' : '⚪ DESACTIVADA'}{/}`);
  screen.render();
});

screen.key(['r', 'R'], () => { log('{yellow-fg}▶ Refresh manual{/}'); tick(); });
screen.key(['up'],   () => boxes.oppBox.scroll(-1));
screen.key(['down'], () => boxes.oppBox.scroll(1));

// ── Tick ───────────────────────────────────────────────────────────────────
async function tick() {
  const t0 = Date.now();
  iteration++;
  boxes.statsBar.setContent(` Ciclo {yellow-fg}#${iteration}{/}  |  🔄 A carregar ${allPools.length} pools...`);
  screen.render();

  // 1. Fetch reserves
  const reserves = await fetchAllPools(allPools, (done, total) => {
    if (done % 30 === 0) {
      boxes.statsBar.setContent(` Ciclo {yellow-fg}#${iteration}{/}  |  🔄 ${done}/${total} pools`);
      screen.render();
    }
  });

  const elapsed = Date.now() - t0;

  if (!reserves.length) {
    log('{red-fg}⚠ Nenhuma pool com liquidez respondeu{/}');
    return;
  }

  // 2. Grafo + ciclos
  const graph  = buildGraph(reserves);
  const cycles = findCycles(graph);
  if (cycles.length && cycles[0].profitPct > bestEver) bestEver = cycles[0].profitPct;

  // 3. Fetch saldo (não bloqueia)
  if (process.env.SENDER_ADDRESS) {
    fetchWalletBalance().then(b => { walletBalance = b; }).catch(() => {});
  }

  // 4. Render
  renderOpps(cycles, boxes);
  renderPools(reserves, boxes);
  renderStats({
    cycles, reserves, poolsTotal: allPools.length, elapsed,
    iteration, bestEver, walletBalance, autoExecute,
    execStats: getStats(),
  }, boxes);
  renderStatsBar({
    iteration, reserves, poolsTotal: allPools.length,
    cycles, bestEver, elapsed, autoExecute,
  }, boxes);

  // Log resumo
  if (cycles.length) {
    const top  = cycles[0];
    const path = top.route.map(e => e.from).join('→');
    log(`{green-fg}🎯 ${cycles.length} opps  top: +${top.profitPct.toFixed(3)}%  [${path}]{/}`);
  } else {
    log(`{grey-fg}✗ Sem opps  (${reserves.length} pools, ${elapsed}ms){/}`);
  }

  screen.render();

  // 5. Auto-execução
  if (autoExecute && cycles.length) {
    maybeExecute(cycles, reserves, log).catch(e => {
      logError('maybeExecute', e);
      log(`{red-fg}AutoExec err: ${e.message}{/}`);
    });
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  log('{cyan-fg}▶ Atmos Arb Bot v2.0 iniciado{/}');
  log(`{grey-fg}Pools: ${allPools.length}  |  Min detect: ${config.minProfitPercent}%  |  Min exec: ${config.execution?.minProfitPercent}%  |  Poll: ${config.pollIntervalMs}ms{/}`);

  if (process.env.PRIVATE_KEY && process.env.SENDER_ADDRESS) {
    const addr = process.env.SENDER_ADDRESS;
    log(`{grey-fg}Wallet: ${addr.slice(0,12)}...${addr.slice(-6)}{/}`);
    log(`{grey-fg}AUTO: ${autoExecute ? '🟢 ON' : '⚪ OFF — pressiona [A] para activar'}{/}`);
  } else {
    log('{yellow-fg}⚠ Modo leitura — configura PRIVATE_KEY e SENDER_ADDRESS no .env{/}');
  }

  while (true) {
    try { await tick(); } catch (e) { logError('tick', e); log(`{red-fg}Erro ciclo: ${e.message}{/}`); }
    await new Promise(r => setTimeout(r, config.pollIntervalMs));
  }
}

start().catch(e => { screen.destroy(); console.error(e); process.exit(1); });
