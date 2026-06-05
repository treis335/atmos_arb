// src/tui/render.js — funções de render para cada painel do TUI
// Cada função recebe os dados e os boxes, sem estado interno.

const { getSymbol } = require('../config/tokens');
const config = require('../config');

function renderOpps(cycles, boxes) {
  if (!cycles.length) {
    boxes.oppBox.setContent(
      `{grey-fg}Nenhuma oportunidade acima de {/}{yellow-fg}${config.minProfitPercent}%{/}`
    );
    return;
  }

  const lines = cycles.slice(0, 40).map((c, i) => {
    const pct   = c.profitPct.toFixed(3);
    const color = c.profitPct > 2 ? 'green' : c.profitPct > 0.5 ? 'yellow' : 'grey';
    const path  = c.route.map(e => getSymbol(e.from)).join('→')
                + '→' + getSymbol(c.route[c.route.length - 1].to);
    const hops  = c.route.length;
    const liq   = c.liquidityMin > 0 ? ` {grey-fg}liq:${Math.round(c.liquidityMin)}{/}` : '';
    return `{${color}-fg}${String(i+1).padStart(2)}. +${pct.padStart(7)}%{/}  {white-fg}${hops}h{/}  ${path}${liq}`;
  });

  boxes.oppBox.setContent(lines.join('\n'));
  boxes.oppBox.setScrollPerc(0);
}

function renderPools(reserves, boxes) {
  const sorted = [...reserves]
    .sort((a, b) => (b.reserve0 + b.reserve1) - (a.reserve0 + a.reserve1))
    .slice(0, 35);

  const lines = sorted.map(r => {
    const t0  = getSymbol(r.pool.token0Type);
    const t1  = getSymbol(r.pool.token1Type);
    const px  = r.rawPrice < 0.001 ? r.rawPrice.toExponential(2) : r.rawPrice.toFixed(4);
    const fee = (Number(r.pool.swapFeeBps) / 100).toFixed(2);
    const tag = r.pool.poolType === 'stable' ? '{magenta-fg}S{/}' : '{cyan-fg}W{/}';
    return `${tag} {cyan-fg}${t0}{/}/{cyan-fg}${t1}{/}  {white-fg}${px}{/}  {grey-fg}${fee}%{/}`;
  });

  boxes.pairsBox.setContent(lines.join('\n'));
}

function renderStats({ cycles, reserves, poolsTotal, elapsed, iteration, bestEver, walletBalance, autoExecute, execStats }, boxes) {
  const autoColor = autoExecute ? 'green' : 'grey';
  const supraBal  = walletBalance?.SUPRA != null
    ? walletBalance.SUPRA.toFixed(4) + ' SUPRA' : 'N/A';
  const hop3 = cycles.filter(c => c.route.length === 3).length;
  const hop4 = cycles.filter(c => c.route.length === 4).length;

  boxes.statsBox.setContent([
    `{yellow-fg}Ciclo:{/}      #${iteration}`,
    `{yellow-fg}Pools:{/}      ${reserves.length}/${poolsTotal}`,
    `{yellow-fg}Opps:{/}       ${cycles.length}  {grey-fg}(3h:${hop3} 4h:${hop4}){/}`,
    `{yellow-fg}Best ever:{/}  +${bestEver.toFixed(3)}%`,
    `{yellow-fg}Tick:{/}       ${elapsed}ms`,
    ``,
    `{yellow-fg}Wallet:{/}     ${supraBal}`,
    `{yellow-fg}Txs:{/}        ${execStats.sent} sent / ${execStats.success} ok`,
    `{yellow-fg}Lucro:{/}      ${execStats.profitSUPRA.toFixed(4)} SUPRA`,
    ``,
    `{${autoColor}-fg}${autoExecute ? '🟢 AUTO ON' : '⚪ AUTO OFF'}{/}  {grey-fg}[A]{/}`,
    `{grey-fg}Min detect: ${config.minProfitPercent}%{/}`,
    `{grey-fg}Min exec:   ${config.execution?.minProfitPercent ?? 0.35}%{/}`,
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
