// monitor.js — TUI com execução automática
// v2: stats de execução, breakdown de oportunidades, suporte a hops ≥3
require('dotenv').config();
const blessed = require('blessed');
const fs = require('fs');
const { fetchAllReserves, friendlyToken } = require('./engine');
const { buildGraph, findCycles } = require('./detector');
const { preload, getSymbol } = require('./tokenRegistry');
const { executeArbitrage, fetchWalletBalance } = require('./executor');
const { findOptimalAmount } = require('./optimalSize');
const config = require('./config');

if (!fs.existsSync('pools.json')) {
  console.error('pools.json não encontrado. Corre "node discover.js" primeiro.');
  process.exit(1);
}
const allPools = JSON.parse(fs.readFileSync('pools.json', 'utf8'));
preload();

// ──── TUI SETUP ────────────────────────────────────────────────────────────
const screen = blessed.screen({ smartCSR: true, title: 'ATMOS ARB BOT v2' });

const header = blessed.box({
  top: 0, left: 0, width: '100%', height: 3,
  content: ' ◈  ATMOS ARB BOT v2.0  ·  Detector + Executor  ·  Atmos DEX  ·  Supra Network',
  tags: true, style: { fg: 'cyan', bold: true, bg: 'black' },
});

const statsBar = blessed.box({
  top: 3, left: 0, width: '100%', height: 1,
  content: '', tags: true, style: { fg: 'white', bg: 'black' },
});

const oppBox = blessed.box({
  top: 4, left: 0, width: '65%', height: '60%-4',
  label: ' 🎯 OPORTUNIDADES ',
  border: { type: 'line' }, tags: true, scrollable: true, alwaysScroll: true,
  style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
  content: 'A aguardar primeiro ciclo...',
});

const pairsBox = blessed.box({
  top: 4, right: 0, width: '35%', height: '60%-4',
  label: ' 📊 PARES ',
  border: { type: 'line' }, tags: true, scrollable: true,
  style: { border: { fg: 'blue' }, label: { fg: 'blue' } },
  content: '...',
});

const logBox = blessed.box({
  bottom: 1, left: 0, width: '65%', height: '40%',
  label: ' 📋 LOG ',
  border: { type: 'line' }, tags: true, scrollable: true, alwaysScroll: true,
  style: { border: { fg: 'green' }, label: { fg: 'green' } },
  content: '',
});

const statsBox = blessed.box({
  bottom: 1, right: 0, width: '35%', height: '40%',
  label: ' 📈 STATS ',
  border: { type: 'line' }, tags: true,
  style: { border: { fg: 'magenta' }, label: { fg: 'magenta' } },
  content: '',
});

const footer = blessed.box({
  bottom: 0, left: 0, width: '100%', height: 1,
  content: ' [Q] Sair  [A] Toggle AUTO  [R] Refresh  [↑↓] Scroll',
  tags: true, style: { fg: 'black', bg: 'cyan' },
});

screen.append(header); screen.append(statsBar); screen.append(oppBox);
screen.append(pairsBox); screen.append(logBox); screen.append(statsBox);
screen.append(footer);

// ──── STATE ────────────────────────────────────────────────────────────────
const logLines = [];
let iteration = 0;
let totalCyclesFound = 0;
let bestEver = 0;
let autoExecute = config.execution?.autoExecute ?? false;
let autoTxInProgress = false;
let lastAutoTxTime = 0;
let totalTxSent = 0;
let totalTxSuccess = 0;
let totalProfitSupra = 0;
let walletBalance = {};

function log(msg) {
  const time = new Date().toLocaleTimeString('pt-PT');
  logLines.push(`{grey-fg}${time}{/} ${msg}`);
  if (logLines.length > 300) logLines.shift();
  logBox.setContent(logLines.join('\n'));
  logBox.setScrollPerc(100);
  screen.render();
}

function renderOpps(cycles) {
  if (!cycles.length) {
    oppBox.setContent(`{grey-fg}Nenhuma oportunidade acima de {/}{yellow-fg}${config.minProfitPercent}%{/}`);
    return;
  }
  const lines = [];
  for (let i = 0; i < Math.min(cycles.length, 40); i++) {
    const c = cycles[i];
    const pct = c.profitPct.toFixed(3);
    const color = c.profitPct > 2 ? 'green' : c.profitPct > 0.5 ? 'yellow' : 'grey';
    const route = c.route.map(e => getSymbol(e.from)).join(' → ') + ' → ' + getSymbol(c.route[c.route.length-1].to);
    const liq = c.liquidityScore > 0 ? ` {grey-fg}liq:${c.liquidityScore.toFixed(0)}{/}` : '';
    lines.push(`{${color}-fg}${String(i+1).padStart(2)}. +${pct.padStart(7)}%{/}  {white-fg}${c.route.length}h{/}  ${route}${liq}`);
  }
  oppBox.setContent(lines.join('\n'));
  oppBox.setScrollPerc(0);
}

function renderPairs(reserves) {
  const lines = [];
  const sorted = [...reserves]
    .sort((a, b) => (b.reserve0 + b.reserve1) - (a.reserve0 + a.reserve1))
    .slice(0, 35);
  for (const r of sorted) {
    const t0 = getSymbol(r.pool.token0Type);
    const t1 = getSymbol(r.pool.token1Type);
    const price = r.rawPrice < 0.001 ? r.rawPrice.toExponential(2) : r.rawPrice.toFixed(4);
    const fee = (Number(r.pool.swapFeeBps) / 100).toFixed(2);
    const pt = r.pool.poolType === 'stable' ? '{magenta-fg}S{/}' : '{cyan-fg}W{/}';
    lines.push(`${pt} {cyan-fg}${t0}{/}/{cyan-fg}${t1}{/}  {white-fg}${price}{/}  {grey-fg}${fee}%{/}`);
  }
  pairsBox.setContent(lines.join('\n'));
}

function renderStats(cycles, reserves, elapsed) {
  const autoColor = autoExecute ? 'green' : 'grey';
  const supraBal = walletBalance.SUPRA != null ? walletBalance.SUPRA.toFixed(4) + ' SUPRA' : 'N/A';
  const hop3 = cycles.filter(c => c.route.length === 3).length;
  const hop4 = cycles.filter(c => c.route.length === 4).length;
  const lines = [
    `{yellow-fg}Ciclo:{/}       #${iteration}`,
    `{yellow-fg}Pools:{/}       ${reserves.length}/${allPools.length}`,
    `{yellow-fg}Opps:{/}        ${cycles.length}  (3h:${hop3} 4h:${hop4})`,
    `{yellow-fg}Total opps:{/}  ${totalCyclesFound}`,
    `{yellow-fg}Best ever:{/}   +${bestEver.toFixed(3)}%`,
    `{yellow-fg}Ciclo ms:{/}    ${elapsed}ms`,
    ``,
    `{yellow-fg}Wallet:{/}      ${supraBal}`,
    `{yellow-fg}Txs:{/}         ${totalTxSent} sent / ${totalTxSuccess} ok`,
    `{yellow-fg}Lucro:{/}       ${totalProfitSupra.toFixed(4)} SUPRA`,
    ``,
    `{${autoColor}-fg}${autoExecute ? '🟢 AUTO ON' : '⚪ AUTO OFF'}{/}  {grey-fg}[A]{/}`,
    `{grey-fg}Min detect: ${config.minProfitPercent}%{/}`,
    `{grey-fg}Min exec:   ${config.execution?.minProfitPercent ?? 0.35}%{/}`,
  ];
  statsBox.setContent(lines.join('\n'));
}

// ──── AUTO EXECUTE ─────────────────────────────────────────────────────────
async function maybeAutoExecute(cycles, reservesData) {
  if (!autoExecute || autoTxInProgress) return;
  if (!process.env.PRIVATE_KEY || !process.env.SENDER_ADDRESS) return;
  const now = Date.now();
  if (now - lastAutoTxTime < (config.execution?.cooldownMs ?? 8000)) return;

  const minExecProfit = config.execution?.minProfitPercent ?? 0.35;
  const gasRes = config.execution?.gasReserveSUPRA ?? 0.5;
  const available = Math.max(0, (walletBalance.SUPRA ?? 0) - gasRes);

  const viable = cycles.filter(c => c.profitPct >= minExecProfit);
  if (!viable.length) return;

  const best = viable[0];
  autoTxInProgress = true;
  lastAutoTxTime = now;

  log(`{yellow-fg}🤖 Auto-exec: +${best.profitPct.toFixed(3)}% [${best.route.map(e => getSymbol(e.from)).join('→')}]{/}`);

  try {
    const poolsMap = {};
    for (const r of reservesData) poolsMap[r.pool.address] = { ...r.pool, reserve0: r.reserve0, reserve1: r.reserve1 };

    const maxAmt = Math.min(config.execution?.maxAmountIn ?? 5000, available);
    const optimal = await findOptimalAmount(
      best.route, poolsMap,
      config.execution?.minAmountIn ?? 5,
      maxAmt
    );

    if (!optimal || optimal.profitPct < minExecProfit) {
      log(`{grey-fg}Optimal insuficiente após simulate (${optimal?.profitPct?.toFixed(3) ?? '?'}%){/}`);
      autoTxInProgress = false;
      return;
    }

    log(`{grey-fg}Optimal: ${optimal.optimalAmount.toFixed(2)} SUPRA → ~${optimal.profitPct.toFixed(3)}%{/}`);

    const routeWithOutputs = best.route.map((hop, i) => ({
      ...hop,
      fromSymbol: getSymbol(hop.from),
      toSymbol:   getSymbol(hop.to),
      amountInRaw:   optimal.hopOutputs[i]?.amountInRaw ?? 0,
      expectedOutRaw: optimal.hopOutputs[i]?.expectedOutRaw ?? 0,
    }));

    totalTxSent++;
    const result = await executeArbitrage({
      route: routeWithOutputs,
      optimalAmountRaw: optimal.optimalAmountRaw,
      poolsMap,
    }, log);

    if (result?.success) {
      totalTxSuccess++;
      totalProfitSupra += optimal.profit;
      log(`{green-fg}✅ TX ok! Hash: ${result.txHash?.slice(0, 18)}...{/}`);
    } else if (result?.partial) {
      log(`{yellow-fg}⚠ Parcial: ${result.txHashes?.length} hops OK{/}`);
    } else {
      log(`{red-fg}❌ Execução falhou.{/}`);
    }
  } catch (e) {
    log(`{red-fg}❌ Erro exec: ${e.message.slice(0, 80)}{/}`);
  }

  autoTxInProgress = false;
}

// ──── KEYS ─────────────────────────────────────────────────────────────────
screen.key(['q', 'Q', 'C-c'], () => { screen.destroy(); process.exit(0); });
screen.key(['a', 'A'], () => {
  if (!process.env.PRIVATE_KEY || !process.env.SENDER_ADDRESS) {
    log('{red-fg}⚠ PRIVATE_KEY / SENDER_ADDRESS não configurados no .env{/}');
    return;
  }
  autoExecute = !autoExecute;
  log(`{yellow-fg}Auto-execução: ${autoExecute ? '🟢 ACTIVADA' : '⚪ DESACTIVADA'}{/}`);
  screen.render();
});
screen.key(['r', 'R'], () => { log('{yellow-fg}Refresh manual...{/}'); tick(); });
screen.key(['up'],   () => oppBox.scroll(-1));
screen.key(['down'], () => oppBox.scroll(1));

// ──── TICK ─────────────────────────────────────────────────────────────────
async function tick() {
  const start = Date.now();
  iteration++;
  const autoCol = autoExecute ? 'green' : 'grey';
  statsBar.setContent(` Ciclo {yellow-fg}#${iteration}{/}  |  A carregar ${allPools.length} pools...`);
  screen.render();

  const reserves = await fetchAllReserves(allPools, (done, total) => {
    if (done % 25 === 0) {
      statsBar.setContent(` Ciclo {yellow-fg}#${iteration}{/}  |  🔄 ${done}/${total} pools`);
      screen.render();
    }
  });

  const elapsed = Date.now() - start;

  if (!reserves.length) { log('{red-fg}⚠ Nenhuma pool com liquidez{/}'); return; }

  const graph  = buildGraph(reserves);
  const cycles = findCycles(graph, config.minProfitPercent, config.maxCycles);
  totalCyclesFound += cycles.length;
  if (cycles.length && cycles[0].profitPct > bestEver) bestEver = cycles[0].profitPct;

  if (process.env.SENDER_ADDRESS) {
    fetchWalletBalance().then(b => { walletBalance = b; }).catch(() => {});
  }

  renderOpps(cycles);
  renderPairs(reserves);
  renderStats(cycles, reserves, elapsed);

  statsBar.setContent(
    ` Ciclo {yellow-fg}#${iteration}{/}  |` +
    `  Pools: {cyan-fg}${reserves.length}/${allPools.length}{/}  |` +
    `  Opps: {${cycles.length > 0 ? 'green' : 'grey'}-fg}${cycles.length}{/}  |` +
    `  Best: {yellow-fg}+${bestEver.toFixed(3)}%{/}  |` +
    `  {${autoCol}-fg}${autoExecute ? 'AUTO' : 'MANUAL'}{/}  |` +
    `  {grey-fg}${elapsed}ms{/}`
  );

  if (cycles.length > 0) {
    const top = cycles[0];
    const route = top.route.map(e => getSymbol(e.from)).join('→');
    log(`{green-fg}🎯 ${cycles.length} opps  top: +${top.profitPct.toFixed(3)}%  [${route}]{/}`);
  } else {
    log(`{grey-fg}✗ Sem opps  (${reserves.length} pools, ${elapsed}ms){/}`);
  }

  screen.render();

  if (autoExecute && cycles.length > 0) {
    maybeAutoExecute(cycles, reserves).catch(e => log(`{red-fg}AutoExec err: ${e.message}{/}`));
  }
}

async function start() {
  log('{cyan-fg}▶ Atmos Arb Bot v2.0 iniciado{/}');
  log(`{grey-fg}Pools: ${allPools.length} | Min detect: ${config.minProfitPercent}% | Min exec: ${config.execution?.minProfitPercent ?? 0.35}%{/}`);

  if (process.env.PRIVATE_KEY && process.env.SENDER_ADDRESS) {
    log(`{grey-fg}Wallet: ${process.env.SENDER_ADDRESS.slice(0, 12)}...${process.env.SENDER_ADDRESS.slice(-6)}{/}`);
    log(`{grey-fg}Auto: ${autoExecute ? '🟢 ON' : '⚪ OFF (pressiona [A])'}{/}`);
  } else {
    log('{yellow-fg}⚠ Modo só leitura — configura PRIVATE_KEY e SENDER_ADDRESS no .env{/}');
  }

  while (true) {
    try { await tick(); } catch (e) { log(`{red-fg}Erro ciclo: ${e.message}{/}`); }
    await new Promise(r => setTimeout(r, config.pollIntervalMs));
  }
}

start();
