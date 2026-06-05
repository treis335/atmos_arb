// src/tui/render.js — render dos painéis do TUI

const { getSymbol } = require('../config/tokens');
const config = require('../config');

function renderOpps(cycles, boxes) {
  if (!cycles.length) {
    boxes.oppBox.setContent(
      `{grey-fg}Nenhuma oportunidade acima de {/}{yellow-fg}${config.minProfitPercent}%{/}\n` +
      `{grey-fg}(ciclo a correr...){/}`
    );
    return;
  }

  const minExec = config.execution?.minProfitPercent ?? 0.35;
  const lines = cycles.slice(0, 50).map((c, i) => {
    const pct     = c.profitPct.toFixed(3);
    const color   = c.profitPct >= minExec ? 'green' : c.profitPct > 0.1 ? 'yellow' : 'grey';
    const execTag = c.profitPct >= minExec ? '{green-fg}▶{/} ' : '  ';
    const symbols = c.route.map(e => getSymbol(e.from));
    symbols.push(getSymbol(c.route[c.route.length - 1].to));
    const path = symbols.join('{grey-fg}→{/}');
    const hops = c.route.length;
    const fee  = c.route.map(e => (e.feeBps ?? 30) / 100 + '%').join('+');
    return `${execTag}{${color}-fg}${String(i+1).padStart(2)}. +${pct.padStart(7)}%{/}  {white-fg}${hops}h{/}  ${path}  {grey-fg}[${fee}]{/}`;
  });

  boxes.oppBox.setContent(lines.join('\n'));
  boxes.oppBox.setScrollPerc(0);
}

function renderPools(reserves, boxes) {
  const sorted = [...reserves]
    .sort((a, b) => (b.reserve0 + b.reserve1) - (a.reserve0 + a.reserve1))
    .slice(0, 40);

  const lines = sorted.map(r => {
    const t0  = getSymbol(r.pool.token0Type);
    const t1  = getSymbol(r.pool.token1Type);
    const px  = r.rawPrice < 0.001 ? r.rawPrice.toExponential(2)
              : r.rawPrice > 9999   ? r.rawPrice.toExponential(2)
              : r.rawPrice.toFixed(4);
    const fee = (Number(r.pool.swapFeeBps) / 100).toFixed(2);
    const tag = r.pool.poolType === 'stable' ? '{magenta-fg}S{/}' : '{blue-fg}W{/}';
    const liq = r.reserve0 > 100000 ? '{green-fg}◆{/}' : r.reserve0 > 1000 ? '{yellow-fg}◇{/}' : '{grey-fg}·{/}';
    return `${liq}${tag} {cyan-fg}${t0.padEnd(8)}{/}/{cyan-fg}${t1.padEnd(8)}{/}  {white-fg}${px.padStart(10)}{/}  {grey-fg}${fee}%{/}`;
  });

  boxes.pairsBox.setContent(lines.join('\n'));
}

function renderStats({ cycles, reserves, poolsTotal, elapsed, iteration, bestEver, walletBalance, autoExecute, execStats }, boxes) {
  const autoColor = autoExecute ? 'green' : 'grey';
  const supraBal  = walletBalance?.SUPRA != null ? walletBalance.SUPRA.toFixed(4) + ' SUPRA' : 'N/A';
  const minExec   = config.execution?.minProfitPercent ?? 0.35;
  const execReady = cycles.filter(c => c.profitPct >= minExec).length;
  const hop2 = cycles.filter(c => c.route.length === 2).length;
  const hop3 = cycles.filter(c => c.route.length === 3).length;
  const hop4 = cycles.filter(c => c.route.length >= 4).length;

  boxes.statsBox.setContent([
    `{yellow-fg}Ciclo:{/}       #${iteration}`,
    `{yellow-fg}Pools:{/}       ${reserves.length}/${poolsTotal}`,
    `{yellow-fg}Opps:{/}        ${cycles.length}  {grey-fg}2h:${hop2} 3h:${hop3} 4h:${hop4}{/}`,
    `{yellow-fg}Exec ready:{/}  {${execReady > 0 ? 'green' : 'grey'}-fg}${execReady}{/}`,
    `{yellow-fg}Best ever:{/}   +${bestEver.toFixed(3)}%`,
    `{yellow-fg}Tick:{/}        ${elapsed}ms`,
    ``,
    `{yellow-fg}Wallet:{/}      ${supraBal}`,
    `{yellow-fg}Txs sent:{/}    ${execStats.sent}`,
    `{yellow-fg}Txs ok:{/}      ${execStats.success}`,
    `{yellow-fg}Lucro:{/}       +${execStats.profitSUPRA.toFixed(4)} SUPRA`,
    ``,
    `{${autoColor}-fg}${autoExecute ? '🟢 AUTO ON ' : '⚪ AUTO OFF'}{/}  {grey-fg}[A] toggle{/}`,
    `{grey-fg}Detect ≥ ${config.minProfitPercent}%  |  Exec ≥ ${minExec}%{/}`,
    `{grey-fg}Concurrent: ${config.maxConcurrent}  |  Poll: ${config.pollIntervalMs}ms{/}`,
  ].join('\n'));
}

function renderStatsBar({ iteration, reserves, poolsTotal, cycles, bestEver, elapsed, autoExecute }, boxes) {
  const autoColor = autoExecute ? 'green' : 'grey';
  boxes.statsBar.setContent(
    ` Ciclo {yellow-fg}#${iteration}{/}  |` +
    `  Pools: {cyan-fg}${reserves.length}/${poolsTotal}{/}  |` +
    `  Opps: {${cycles.length > 0 ? 'green' : 'grey'}-fg}${cycles.length}{/}  |` +
    `  Best: {yellow-fg}+${bestEver.toFixed(3)}%{/}  |` +
    `  {${autoColor}-fg}${autoExecute ? 'AUTO' : 'MANUAL'}{/}  |` +
    `  {grey-fg}${elapsed}ms{/}`
  );
}

module.exports = { renderOpps, renderPools, renderStats, renderStatsBar };
