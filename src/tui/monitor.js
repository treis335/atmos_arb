// src/tui/monitor.js — TUI principal, baseado no dexlyn_arb_original
require('dotenv').config();
const blessed  = require('blessed');
const fs       = require('fs');
const path     = require('path');
const config   = require('../config');
const { fetchAllPools }   = require('../dex/engine');
const { fetchWalletBalance } = require('../dex/executor');
const { buildGraph, findCycles } = require('../core/graph');
const { arbDetector }     = require('../core/detector');
const { logError, getErrorCount } = require('../utils/logger');
const renderPrices   = require('./renderPrices');
const renderArb      = require('./renderArb');
const renderLog      = require('./renderLog');
const { renderFooter, setRpcHealthy } = require('./renderFooter');

// ── Pools ──────────────────────────────────────────────────────────────────
const poolsPath = path.join(process.cwd(), config.poolsFile);
if (!fs.existsSync(poolsPath)) {
  console.error(`pools.json não encontrado em ${poolsPath}\nCorre: node scripts/discover.js`);
  process.exit(1);
}
const allPools = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));

// ── Screen ─────────────────────────────────────────────────────────────────
const screen = blessed.screen({ smartCSR: true, title: 'Atmos Arb Bot v2.0', fullUnicode: true, forceUnicode: true });
screen.program.hideCursor();

const headerBox = blessed.box({ top: 0, left: 0, width: '55%', height: 7, tags: true, wrap: false });

const pricesBox = blessed.box({
  top: 7, left: 0, width: '55%', bottom: 2, tags: true, wrap: false,
  scrollable: true, alwaysScroll: true, mouse: true, keys: true,
  scrollbar: { ch: '│', style: { fg: 'grey' } },
  border: { type: 'line' }, label: ' {bold}{grey-fg}MERCADO{/}{/} ',
  style: { border: { fg: 'grey' } },
});

const arbBox = blessed.box({
  top: 0, left: '55%', width: '45%', height: '60%', tags: true, wrap: false,
  scrollable: true, alwaysScroll: true, mouse: true, keys: true,
  scrollbar: { ch: '│', style: { fg: 'cyan' } },
  border: { type: 'line' }, label: ' {bold}{cyan-fg}ARB DETECTOR{/}{/} ',
  style: { border: { fg: 'cyan' } },
});

const logBox = blessed.box({
  top: '60%', left: '55%', width: '45%', bottom: 2, tags: true, wrap: false,
  scrollable: true, alwaysScroll: true, mouse: true, keys: true,
  scrollbar: { ch: '│', style: { fg: 'blue' } },
  border: { type: 'line' }, label: ' {bold}{blue-fg}LOG DE ARBS{/}{/} ',
  style: { border: { fg: 'blue' } },
});

const footerBox = blessed.box({ bottom: 0, left: 0, width: '100%', height: 2, tags: true, wrap: false });

screen.append(headerBox); screen.append(pricesBox);
screen.append(arbBox);    screen.append(logBox);
screen.append(footerBox);

const boxes = { screen, headerBox, pricesBox, arbBox, logBox, footerBox, scrollPaused: () => scrollPaused, setScrollPaused: v => { scrollPaused = v; }, autoEnabled: () => config.autoExecute.enabled };

// ── State ──────────────────────────────────────────────────────────────────
let scrollPaused  = false;
let currentOpps   = [];
let txInProgress  = false;
let lastAutoTx    = 0;

// ── Focus / Scroll ─────────────────────────────────────────────────────────
const scrollBoxes = [pricesBox, arbBox, logBox];
let focusIdx = 1;
function setFocus(i) {
  focusIdx = i;
  pricesBox.style.border.fg = i === 0 ? 'white' : 'grey';
  arbBox.style.border.fg    = i === 1 ? 'cyan'  : 'grey';
  logBox.style.border.fg    = i === 2 ? 'blue'  : 'grey';
  scrollBoxes[i].focus(); screen.render();
}
setFocus(1);

screen.key(['tab'],      () => setFocus((focusIdx + 1) % 3));
screen.key(['space'],    () => { scrollPaused = !scrollPaused; arbBox.setLabel(scrollPaused ? ' {bold}{cyan-fg}ARB DETECTOR{/}{/} {yellow-fg}[PAUSADO]{/} ' : ' {bold}{cyan-fg}ARB DETECTOR{/}{/} '); screen.render(); });
screen.key(['up'],       () => { if (focusIdx > 0) scrollPaused = true; scrollBoxes[focusIdx].scroll(-1);  screen.render(); });
screen.key(['down'],     () => { if (focusIdx > 0) scrollPaused = true; scrollBoxes[focusIdx].scroll(1);   screen.render(); });
screen.key(['pageup'],   () => { if (focusIdx > 0) scrollPaused = true; scrollBoxes[focusIdx].scroll(-10); screen.render(); });
screen.key(['pagedown'], () => { if (focusIdx > 0) scrollPaused = true; scrollBoxes[focusIdx].scroll(10);  screen.render(); });
screen.key(['home'],     () => { scrollBoxes[focusIdx].scrollTo(0); screen.render(); });
screen.key(['end'],      () => { scrollBoxes[focusIdx].scrollTo(scrollBoxes[focusIdx].getScrollHeight()); screen.render(); });

pricesBox.on('wheeldown', () => { pricesBox.scroll(3);  screen.render(); });
pricesBox.on('wheelup',   () => { pricesBox.scroll(-3); screen.render(); });
arbBox.on('wheeldown',    () => { scrollPaused = true; arbBox.scroll(3);  screen.render(); });
arbBox.on('wheelup',      () => { scrollPaused = true; arbBox.scroll(-3); screen.render(); });
logBox.on('wheeldown',    () => { logBox.scroll(3);  screen.render(); });
logBox.on('wheelup',      () => { logBox.scroll(-3); screen.render(); });
pricesBox.on('click', () => setFocus(0));
arbBox.on('click',    () => setFocus(1));
logBox.on('click',    () => setFocus(2));

// ── Snapshot [c] ──────────────────────────────────────────────────────────
screen.key(['c'], () => {
  try {
    const clean  = blessed.stripTags(arbBox.getContent());
    const fname  = `arb_snapshot_${new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)}.txt`;
    fs.writeFileSync(path.join(process.cwd(), fname), clean, 'utf8');
    footerBox.setContent(`{green-fg}✅ Snapshot: ${fname}{/}`);
    screen.render();
  } catch (e) {
    footerBox.setContent('{red-fg}❌ Erro ao guardar snapshot{/}');
    screen.render();
  }
});

// ── Toggle AUTO [a] ────────────────────────────────────────────────────────
screen.key(['a'], () => {
  config.autoExecute.enabled = !config.autoExecute.enabled;
  const status = config.autoExecute.enabled ? '{green-fg}LIGADO{/}' : '{red-fg}DESLIGADO{/}';
  footerBox.setContent(`{grey-fg}─ Modo automático: ${status}{/}`);
  screen.render();
});

// ── Exec manual [e] ───────────────────────────────────────────────────────
screen.key(['e'], async () => {
  if (txInProgress || !currentOpps.length) return;
  txInProgress = true;
  const { executeRoute } = require('../dex/executor');
  footerBox.setContent('{yellow-fg}⏳ A executar...{/}'); screen.render();

  const opp = currentOpps[0];
  const log = msg => { footerBox.setContent(msg); screen.render(); };
  try {
    const res = await executeRoute({
      route: opp.result.steps.map(s => ({
        from: s.from, to: s.to, pool: s.pair.poolAddr, poolType: s.pair.curve,
        fromSymbol: s.from, toSymbol: s.to, amountInRaw: 0, expectedOutRaw: 0,
      })),
      optimalAmountRaw: Math.round(opp.optimalAmount * 1e8),
      poolsMap: Object.fromEntries(opp.result.steps.map(s => [s.pair.poolAddr, { ...s.pair._pool, poolType: s.pair.curve }])),
    }, log);
    log(res?.success ? `{green-fg}✅ ${res.txHash?.slice(0,16)}...{/}` : `{red-fg}❌ Falhou.{/}`);
  } catch (e) { log(`{red-fg}❌ ${e.message}{/}`); }
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
    o.cycle.path[0] === 'SUPRA' &&
    o.result.profitPct >= cfg.minProfitPct &&
    o.score >= cfg.minScore &&
    o.optimalAmount <= available
  );
  if (!viable.length) return;

  txInProgress = true;
  lastAutoTx   = now;
  const { executeRoute } = require('../dex/executor');
  const opp = viable[0];
  const log = msg => { footerBox.setContent(msg); screen.render(); };
  log(`{yellow-fg}🤖 Auto: ${opp.cycle.path.join('→')} (+${opp.result.profitPct.toFixed(3)}%){/}`);

  try {
    const res = await executeRoute({
      route: opp.result.steps.map((s, i) => ({
        from: s.from, to: s.to, pool: s.pair.poolAddr, poolType: s.pair.curve,
        fromSymbol: s.from, toSymbol: s.to,
        amountInRaw: Math.round(s.amtIn * (i === 0 ? 1e8 : 1e8)),
        expectedOutRaw: Math.round(s.amtOut * 1e8),
      })),
      optimalAmountRaw: Math.round(opp.optimalAmount * 1e8),
      poolsMap: Object.fromEntries(opp.result.steps.map(s => [s.pair.poolAddr, { poolType: s.pair.curve, token0Type: s.pair.addrA, token1Type: s.pair.addrB }])),
    }, log);
    log(res?.success ? `{green-fg}✅ ${res.txHash?.slice(0,16)}...{/}` : `{red-fg}❌ Falhou.{/}`);
  } catch (e) { log(`{red-fg}❌ ${e.message}{/}`); }
  txInProgress = false;
}

// ── Tick ──────────────────────────────────────────────────────────────────
let _tickCount = 0;
let _bestEver  = 0;
let _totalOpps = 0;

async function tick() {
  const t0 = Date.now();
  _tickCount++;

  footerBox.setContent(`{grey-fg}─ A carregar ${allPools.length} pools...{/}`);
  screen.render();

  let pairStates;
  try {
    pairStates = await fetchAllPools(allPools, (done, total) => {
      if (done % 20 === 0 || done === total) {
        footerBox.setContent(`{grey-fg}─ 🔄 ${done}/${total} pools{/}`);
        screen.render();
      }
    });
    setRpcHealthy(pairStates.length > 0);
  } catch (e) {
    logError('fetchAllPools', e);
    pairStates = [];
    setRpcHealthy(false);
  }

  await new Promise(r => setImmediate(r));

  let cycles = [], opps = [];
  try {
    const graph = buildGraph(pairStates);
    cycles = findCycles(graph, config.maxHops);
  } catch (e) { logError('buildGraph', e); }

  try {
    opps = arbDetector.analyzeAll(cycles);
    currentOpps = opps;
  } catch (e) { logError('analyzeAll', e); }

  const walletBalances = process.env.SENDER_ADDRESS
    ? await fetchWalletBalance().catch(() => ({}))
    : {};

  if (config.autoExecute.enabled) {
    maybeAutoExecute(opps, walletBalances).catch(e => logError('autoExecute', e));
  }

  // Actualizar best ever e totais
  if (opps.length > 0) {
    _totalOpps += opps.length;
    if (opps[0].result.profitPct > _bestEver) _bestEver = opps[0].result.profitPct;
  }

  // Render header com stats reais
  try {
    const autoStatus = config.autoExecute.enabled ? '{green-fg}AUTO ON {/}' : '{grey-fg}AUTO OFF{/}';
    const walletStr = walletBalances?.SUPRA != null ? `{yellow-fg}${walletBalances.SUPRA.toFixed(2)} SUPRA{/}` : '{grey-fg}N/A{/}';
    const elapsed = Date.now() - t0;
    headerBox.setContent(
      `{cyan-fg}{bold}◈  ATMOS ARB BOT v2.0  ·  Atmos DEX  ·  Supra Network{/}{/}
` +
      `{grey-fg}─────────────────────────────────────────────────────{/}
` +
      ` Ciclo {yellow-fg}#${_tickCount}{/}  |  Pools: {cyan-fg}${pairStates.length}/${allPools.length}{/}  |  Opps: {${opps.length > 0 ? 'green' : 'grey'}-fg}${opps.length}{/}  |  Tick: {grey-fg}${elapsed}ms{/}
` +
      ` Best ever: {green-fg}+${_bestEver.toFixed(3)}%{/}  |  ${autoStatus}  |  Wallet: ${walletStr}`
    );
  } catch(e) { logError('renderHeader', e); }

  try { renderPrices(pairStates, boxes, walletBalances); } catch (e) { logError('renderPrices', e); }
  try { renderArb(opps, boxes); }                          catch (e) { logError('renderArb', e); }
  try { renderLog(opps, boxes); }                          catch (e) { logError('renderLog', e); }
  try { renderFooter(opps, Date.now() - t0, boxes); }      catch (e) { logError('renderFooter', e); }
  try { screen.render(); } catch (_) {}
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
