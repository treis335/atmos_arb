// src/tui/monitor.js — TUI principal
require('dotenv').config();
const blessed  = require('blessed');
const fs       = require('fs');
const path     = require('path');
const config   = require('../config');
const { fetchAllPools }            = require('../dex/engine');
const { executeArbitrage, fetchWalletBalance } = require('../dex/executor');
const { buildGraph, findCycles }   = require('../core/graph');
const { arbDetector }              = require('../core/detector');
const { logError }                 = require('../utils/logger');
const renderPrices                 = require('./renderPrices');
const renderArb                    = require('./renderArb');
const renderLog                    = require('./renderLog');
const { renderFooter, setRpcHealthy } = require('./renderFooter');

// ── Pools ──────────────────────────────────────────────────────────────────
const poolsPath = path.join(process.cwd(), config.poolsFile);
if (!fs.existsSync(poolsPath)) {
  console.error(`pools.json não encontrado em ${poolsPath}\nCorre: node scripts/discover.js`);
  process.exit(1);
}
const allPools = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));

// ── Screen ─────────────────────────────────────────────────────────────────
const screen = blessed.screen({ smartCSR: true, title: 'Atmos Arb Bot v2.0', fullUnicode: true });
screen.program.hideCursor();

const headerBox = blessed.box({ top: 0, left: 0, width: '55%', height: 5, tags: true, wrap: false });

const pricesBox = blessed.box({
  top: 5, left: 0, width: '55%', bottom: 2, tags: true, wrap: false,
  scrollable: true, alwaysScroll: true, mouse: true, keys: true,
  scrollbar: { ch: '│', style: { fg: 'grey' } },
  border: { type: 'line' }, label: ' {bold}{grey-fg}MERCADO{/}{/} ',
  style: { border: { fg: 'grey' } },
});

const arbBox = blessed.box({
  top: 0, left: '55%', width: '45%', height: '62%', tags: true, wrap: false,
  scrollable: true, alwaysScroll: true, mouse: true, keys: true,
  scrollbar: { ch: '│', style: { fg: 'cyan' } },
  border: { type: 'line' }, label: ' {bold}{cyan-fg}ARB DETECTOR{/}{/} ',
  style: { border: { fg: 'cyan' } },
});

const logBox = blessed.box({
  top: '62%', left: '55%', width: '45%', bottom: 2, tags: true, wrap: false,
  scrollable: true, alwaysScroll: true, mouse: true, keys: true,
  scrollbar: { ch: '│', style: { fg: 'blue' } },
  border: { type: 'line' }, label: ' {bold}{blue-fg}LOG DE ARBS{/}{/} ',
  style: { border: { fg: 'blue' } },
});

const footerBox = blessed.box({ bottom: 0, left: 0, width: '100%', height: 2, tags: true, wrap: false });

screen.append(headerBox); screen.append(pricesBox);
screen.append(arbBox);    screen.append(logBox);
screen.append(footerBox);

let scrollPaused = false;
const boxes = {
  screen, headerBox, pricesBox, arbBox, logBox, footerBox,
  scrollPaused: () => scrollPaused,
};

// ── State ──────────────────────────────────────────────────────────────────
let currentOpps  = [];
let txInProgress = false;
let lastAutoTx   = 0;
let _tick = 0, _bestEver = 0;

// ── Focus / Scroll ─────────────────────────────────────────────────────────
const focusBoxes = [pricesBox, arbBox, logBox];
let focusIdx = 1;
function setFocus(i) {
  focusIdx = i;
  pricesBox.style.border.fg = i === 0 ? 'white' : 'grey';
  arbBox.style.border.fg    = i === 1 ? 'cyan'  : 'grey';
  logBox.style.border.fg    = i === 2 ? 'blue'  : 'grey';
  focusBoxes[i].focus(); screen.render();
}
setFocus(1);

screen.key(['tab'],      () => setFocus((focusIdx + 1) % 3));
screen.key(['space'],    () => {
  scrollPaused = !scrollPaused;
  arbBox.setLabel(scrollPaused
    ? ' {bold}{cyan-fg}ARB DETECTOR{/}{/} {yellow-fg}[PAUSADO]{/} '
    : ' {bold}{cyan-fg}ARB DETECTOR{/}{/} ');
  screen.render();
});
screen.key(['up'],       () => { scrollPaused = true; focusBoxes[focusIdx].scroll(-1);  screen.render(); });
screen.key(['down'],     () => { scrollPaused = true; focusBoxes[focusIdx].scroll(1);   screen.render(); });
screen.key(['pageup'],   () => { scrollPaused = true; focusBoxes[focusIdx].scroll(-10); screen.render(); });
screen.key(['pagedown'], () => { scrollPaused = true; focusBoxes[focusIdx].scroll(10);  screen.render(); });
screen.key(['home'],     () => { focusBoxes[focusIdx].scrollTo(0); screen.render(); });
screen.key(['end'],      () => { focusBoxes[focusIdx].scrollTo(focusBoxes[focusIdx].getScrollHeight()); screen.render(); });

pricesBox.on('wheeldown', () => { pricesBox.scroll(3);           screen.render(); });
pricesBox.on('wheelup',   () => { pricesBox.scroll(-3);          screen.render(); });
arbBox.on('wheeldown',    () => { scrollPaused = true; arbBox.scroll(3);  screen.render(); });
arbBox.on('wheelup',      () => { scrollPaused = true; arbBox.scroll(-3); screen.render(); });
logBox.on('wheeldown',    () => { logBox.scroll(3);   screen.render(); });
logBox.on('wheelup',      () => { logBox.scroll(-3);  screen.render(); });
pricesBox.on('click', () => setFocus(0));
arbBox.on('click',    () => setFocus(1));
logBox.on('click',    () => setFocus(2));

// ── Teclas de acção ────────────────────────────────────────────────────────
// [c] snapshot
screen.key(['c'], () => {
  try {
    const clean = blessed.stripTags(arbBox.getContent());
    const fname = `arb_snapshot_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.txt`;
    fs.writeFileSync(path.join(process.cwd(), fname), clean, 'utf8');
    footerBox.setContent(`{green-fg}✅ Snapshot: ${fname}{/}`);
    screen.render();
  } catch (e) {
    footerBox.setContent('{red-fg}❌ Erro ao guardar snapshot{/}');
    screen.render();
  }
});

// [a] toggle auto
screen.key(['a'], () => {
  if (!process.env.PRIVATE_KEY || !process.env.SENDER_ADDRESS) {
    footerBox.setContent('{red-fg}⚠ Configura PRIVATE_KEY e SENDER_ADDRESS no .env{/}');
    screen.render(); return;
  }
  config.autoExecute.enabled = !config.autoExecute.enabled;
  footerBox.setContent(config.autoExecute.enabled
    ? '{green-fg}🟢 Auto-execução LIGADA — min +0.30%{/}'
    : '{grey-fg}⚪ Auto-execução DESLIGADA{/}');
  screen.render();
});

// [e] exec manual da melhor oportunidade
screen.key(['e'], async () => {
  if (txInProgress || !currentOpps.length) return;
  if (!process.env.PRIVATE_KEY || !process.env.SENDER_ADDRESS) {
    footerBox.setContent('{red-fg}⚠ PRIVATE_KEY / SENDER_ADDRESS não configurados{/}');
    screen.render(); return;
  }
  txInProgress = true;
  const opp = currentOpps[0];
  const onLog = msg => { footerBox.setContent(msg); screen.render(); };
  footerBox.setContent('{yellow-fg}⏳ A executar...{/}'); screen.render();
  try {
    const res = await executeArbitrage(opp, onLog);
    onLog(res?.success
      ? `{green-fg}✅ ${res.txHash?.slice(0,16)}...{/}`
      : `{red-fg}❌ Falhou.{/}`);
  } catch (e) { onLog(`{red-fg}❌ ${e.message}{/}`); }
  txInProgress = false;
});

screen.key(['C-c', 'q'], () => { screen.program.showCursor(); screen.destroy(); process.exit(0); });

// ── Auto-execute ──────────────────────────────────────────────────────────
async function maybeAutoExecute(opps, balances) {
  const cfg = config.autoExecute;
  if (!cfg.enabled || txInProgress) return;
  const now = Date.now();
  if (now - lastAutoTx < cfg.cooldownMs) return;

  const available = Math.max(0, (balances.SUPRA || 0) - cfg.gasReserveSUPRA);
  const viable = opps.filter(o =>
    o.result.profitPct >= cfg.minProfitPct &&
    o.score >= cfg.minScore &&
    o.optimalAmount <= available
  );
  if (!viable.length) return;

  txInProgress = true;
  lastAutoTx   = now;
  const opp = viable[0];
  const onLog = msg => { footerBox.setContent(msg); screen.render(); };
  onLog(`{yellow-fg}🤖 Auto: ${opp.cycle.path.join('→')} (+${opp.result.profitPct.toFixed(3)}%){/}`);
  try {
    const res = await executeArbitrage(opp, onLog);
    onLog(res?.success
      ? `{green-fg}✅ ${res.txHash?.slice(0,16)}...{/}`
      : `{red-fg}❌ Falhou.{/}`);
  } catch (e) { onLog(`{red-fg}❌ ${e.message}{/}`); }
  txInProgress = false;
}

// ── Tick ──────────────────────────────────────────────────────────────────
async function tick() {
  const t0 = Date.now();
  _tick++;
  footerBox.setContent(`{grey-fg}─ 🔄 A carregar ${allPools.length} pools...{/}`);
  screen.render();

  // 1. Fetch pools
  let pairStates = [];
  try {
    pairStates = await fetchAllPools(allPools, (done, total) => {
      if (done % 30 === 0 || done === total) {
        footerBox.setContent(`{grey-fg}─ 🔄 ${done}/${total} pools (${Date.now()-t0}ms){/}`);
        screen.render();
      }
    });
    setRpcHealthy(pairStates.length > 0);
  } catch (e) { logError('fetchAllPools', e); setRpcHealthy(false); }

  await new Promise(r => setImmediate(r));

  // 2. Grafo + ciclos + opps
  let opps = [];
  try {
    const graph  = buildGraph(pairStates);
    const cycles = findCycles(graph, config.maxHops);
    opps = arbDetector.analyzeAll(cycles);
    currentOpps = opps;
    if (opps.length > 0 && opps[0].result.profitPct > _bestEver) _bestEver = opps[0].result.profitPct;
  } catch (e) { logError('analyze', e); }

  // 3. Saldo
  const walletBalances = process.env.SENDER_ADDRESS
    ? await fetchWalletBalance().catch(() => ({}))
    : {};

  // 4. Auto-exec
  if (config.autoExecute.enabled) {
    maybeAutoExecute(opps, walletBalances).catch(e => logError('autoExecute', e));
  }

  const elapsed = Date.now() - t0;

  // 5. Header
  const autoCol = config.autoExecute.enabled ? 'green' : 'grey';
  const wStr    = walletBalances?.SUPRA != null
    ? `{yellow-fg}${walletBalances.SUPRA.toFixed(2)} SUPRA{/}` : '{grey-fg}N/A{/}';
  headerBox.setContent(
    `{cyan-fg}{bold}◈  ATMOS ARB BOT v2.0  ·  Atmos DEX  ·  Supra Network{/}{/}\n` +
    `{grey-fg}────────────────────────────────────────────────────{/}\n` +
    ` Ciclo {yellow-fg}#${_tick}{/}  Pools: {cyan-fg}${pairStates.length}/${allPools.length}{/}  Opps: {${opps.length>0?'green':'grey'}-fg}${opps.length}{/}  Tick: {grey-fg}${elapsed}ms{/}\n` +
    ` Best: {green-fg}+${_bestEver.toFixed(3)}%{/}  {${autoCol}-fg}${config.autoExecute.enabled?'AUTO ON':'AUTO OFF'}{/}  Wallet: ${wStr}`
  );

  // 6. Render painéis
  try { renderPrices(pairStates, boxes, walletBalances); } catch (e) { logError('renderPrices', e); }
  try { renderArb(opps, boxes); }                          catch (e) { logError('renderArb', e); }
  try { renderLog(opps, boxes); }                          catch (e) { logError('renderLog', e); }
  try { renderFooter(opps, elapsed, boxes); }              catch (e) { logError('renderFooter', e); }
  screen.render();
}

// ── Start ─────────────────────────────────────────────────────────────────
(async () => {
  footerBox.setContent(`{cyan-fg}▶ Atmos Arb Bot v2.0 — ${allPools.length} pools carregadas{/}`);
  screen.render();
  while (true) {
    try { await tick(); } catch (e) { logError('tick', e); }
    await new Promise(r => setTimeout(r, config.pollingMs));
  }
})().catch(e => { screen.destroy(); console.error(e); process.exit(1); });
