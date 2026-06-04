// monitor.js — TUI para o Atmos Arb Bot (só detecção, sem execução)
const blessed = require('blessed');
const fs = require('fs');
const { fetchAllReserves, friendlyToken } = require('./engine');
const { buildGraph, findCycles } = require('./detector');
const { preload, getSymbol } = require('./tokenRegistry');
const config = require('./config');

// ──── POOLS ────────────────────────────────────────────────────────────────
if (!fs.existsSync('pools.json')) {
  console.error('pools.json não encontrado. Corre "node discover.js" primeiro.');
  process.exit(1);
}
const allPools = JSON.parse(fs.readFileSync('pools.json', 'utf8'));
preload();

// ──── TUI SETUP ────────────────────────────────────────────────────────────
const screen = blessed.screen({ smartCSR: true, title: 'ATMOS ARB BOT' });

// Header
const header = blessed.box({
  top: 0, left: 0, width: '100%', height: 3,
  content: ' ◈  ATMOS ARB BOT v1.0  ·  Detector de Arbitragem  ·  Só leitura',
  tags: true, style: { fg: 'cyan', bold: true, bg: 'black' },
});

// Stats bar
const statsBar = blessed.box({
  top: 3, left: 0, width: '100%', height: 1,
  content: '',
  tags: true, style: { fg: 'white', bg: 'black' },
});

// Opportunities table (left, 65%)
const oppBox = blessed.box({
  top: 4, left: 0, width: '65%', height: '60%-4',
  label: ' 🎯 OPORTUNIDADES ',
  border: { type: 'line' },
  tags: true, scrollable: true, alwaysScroll: true,
  style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
  content: 'A aguardar primeiro ciclo...',
});

// Pairs table (right, 35%)
const pairsBox = blessed.box({
  top: 4, right: 0, width: '35%', height: '60%-4',
  label: ' 📊 PARES ',
  border: { type: 'line' },
  tags: true, scrollable: true,
  style: { border: { fg: 'blue' }, label: { fg: 'blue' } },
  content: '...',
});

// Log box (bottom left, 65%)
const logBox = blessed.box({
  bottom: 1, left: 0, width: '65%', height: '40%',
  label: ' 📋 LOG ',
  border: { type: 'line' },
  tags: true, scrollable: true, alwaysScroll: true,
  style: { border: { fg: 'green' }, label: { fg: 'green' } },
  content: '',
});

// Stats box (bottom right, 35%)
const statsBox = blessed.box({
  bottom: 1, right: 0, width: '35%', height: '40%',
  label: ' 📈 STATS ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'magenta' }, label: { fg: 'magenta' } },
  content: '',
});

// Footer
const footer = blessed.box({
  bottom: 0, left: 0, width: '100%', height: 1,
  content: ' [Q] Sair  [R] Refresh manual  [↑↓] Scroll oportunidades',
  tags: true, style: { fg: 'black', bg: 'cyan' },
});

screen.append(header);
screen.append(statsBar);
screen.append(oppBox);
screen.append(pairsBox);
screen.append(logBox);
screen.append(statsBox);
screen.append(footer);

// ──── STATE ────────────────────────────────────────────────────────────────
const logLines = [];
let iteration = 0;
let totalCyclesFound = 0;
let bestEver = 0;
let lastCycleMs = 0;

function log(msg) {
  const time = new Date().toLocaleTimeString('pt-PT');
  logLines.push(`{grey-fg}${time}{/} ${msg}`);
  if (logLines.length > 200) logLines.shift();
  logBox.setContent(logLines.join('\n'));
  logBox.setScrollPerc(100);
  screen.render();
}

function renderOpps(cycles, reserves) {
  if (!cycles.length) {
    oppBox.setContent('{grey-fg}Nenhuma oportunidade acima do mínimo ({/}{yellow-fg}' + config.minProfitPercent + '%{/}{grey-fg}){/}');
    return;
  }

  const lines = [];
  const top = cycles.slice(0, 40);
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    const pct = c.profitPct.toFixed(3);
    const color = c.profitPct > 5 ? 'red' : c.profitPct > 1 ? 'yellow' : 'green';
    const route = c.route.map(e => getSymbol(e.from)).join(' → ') + ' → ' + getSymbol(c.route[c.route.length - 1].to);
    const hops = c.route.length;
    lines.push(
      `{${color}-fg}${String(i+1).padStart(2)}. +${pct.padStart(8)}%{/}  {white-fg}${hops}h{/}  ${route}`
    );
  }
  oppBox.setContent(lines.join('\n'));
  oppBox.setScrollPerc(0);
}

function renderPairs(reserves) {
  const lines = [];
  // Show top pairs by reserve depth
  const sorted = [...reserves]
    .sort((a, b) => (b.reserve0 * b.rawPrice + b.reserve1) - (a.reserve0 * a.rawPrice + a.reserve1))
    .slice(0, 30);

  for (const r of sorted) {
    const t0 = getSymbol(r.pool.token0Type);
    const t1 = getSymbol(r.pool.token1Type);
    const price = r.rawPrice < 0.001 ? r.rawPrice.toExponential(2) : r.rawPrice.toFixed(4);
    const fee = (Number(r.pool.swapFeeBps) / 100).toFixed(2);
    lines.push(`{cyan-fg}${t0}{/}/{cyan-fg}${t1}{/}  {white-fg}${price}{/}  {grey-fg}${fee}%{/}`);
  }
  pairsBox.setContent(lines.join('\n'));
}

function renderStats(cycles, reserves, elapsed) {
  const lines = [
    `{yellow-fg}Ciclo:{/}      #${iteration}`,
    `{yellow-fg}Pools:{/}      ${reserves.length}/${allPools.length}`,
    `{yellow-fg}Opps:{/}       ${cycles.length}`,
    `{yellow-fg}Total opps:{/} ${totalCyclesFound}`,
    `{yellow-fg}Best ever:{/}  +${bestEver.toFixed(3)}%`,
    `{yellow-fg}Ciclo ms:{/}   ${elapsed}ms`,
    ``,
    `{grey-fg}Próximo ciclo em ${config.pollIntervalMs/1000}s{/}`,
  ];
  statsBox.setContent(lines.join('\n'));
}

// ──── KEYS ────────────────────────────────────────────────────────────────
screen.key(['q', 'Q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});
screen.key(['r', 'R'], () => { log('{yellow-fg}Refresh manual...{/}'); tick(); });
oppBox.key(['up'], () => oppBox.scroll(-1));
oppBox.key(['down'], () => oppBox.scroll(1));
screen.key(['up'], () => oppBox.scroll(-1));
screen.key(['down'], () => oppBox.scroll(1));

// ──── TICK ────────────────────────────────────────────────────────────────
async function tick() {
  const start = Date.now();
  iteration++;
  statsBar.setContent(
    ` Ciclo {yellow-fg}#${iteration}{/}  |  Pools: {cyan-fg}${allPools.length}{/}  |  A carregar reservas...`
  );
  screen.render();

  let progressCount = 0;
  const reserves = await fetchAllReserves(allPools, (done, total) => {
    progressCount = done;
    if (done % 20 === 0) {
      statsBar.setContent(` Ciclo {yellow-fg}#${iteration}{/}  |  🔄 ${done}/${total} pools`);
      screen.render();
    }
  });

  const elapsed = Date.now() - start;
  lastCycleMs = elapsed;

  if (!reserves.length) {
    log('{red-fg}⚠ Nenhuma pool com liquidez obtida{/}');
    return;
  }

  const graph = buildGraph(reserves);
  const cycles = findCycles(graph, config.minProfitPercent, config.maxCycles);

  totalCyclesFound += cycles.length;
  if (cycles.length && cycles[0].profitPct > bestEver) {
    bestEver = cycles[0].profitPct;
  }

  renderOpps(cycles, reserves);
  renderPairs(reserves);
  renderStats(cycles, reserves, elapsed);

  statsBar.setContent(
    ` Ciclo {yellow-fg}#${iteration}{/}  |` +
    `  Pools: {cyan-fg}${reserves.length}/{allPools.length}{/}  |` +
    `  Opps: {${cycles.length > 0 ? 'green' : 'grey'}-fg}${cycles.length}{/}  |` +
    `  Best: {yellow-fg}+${bestEver.toFixed(3)}%{/}  |` +
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
}

async function start() {
  log('{cyan-fg}▶ Atmos Arb Bot iniciado{/}');
  log(`{grey-fg}Pools carregadas: ${allPools.length} | Min lucro: ${config.minProfitPercent}%{/}`);
  while (true) {
    try { await tick(); } catch (e) { log(`{red-fg}Erro: ${e.message}{/}`); }
    await new Promise(r => setTimeout(r, config.pollIntervalMs));
  }
}

start();
