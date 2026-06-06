// src/tui/renderPrices.js — painel MERCADO, baseado no dexlyn_arb_original
const fmtReserve = require('../utils/fmtReserve');
const { trackPrice, sparkline } = require('../tracker/priceTracker');

function renderPrices(pairStates, boxes, walletBalances = {}) {
  const { headerBox, pricesBox } = boxes;
  const active = pairStates.filter(Boolean);
  const sorted = [...active].sort((a, b) => (a.tokenB + a.tokenA).localeCompare(b.tokenB + b.tokenA));

  let balanceLine = '';
  if (Object.keys(walletBalances).length > 0) {
    const parts = Object.entries(walletBalances).map(([sym, amt]) =>
      `{yellow-fg}${amt >= 1000 ? amt.toFixed(0) : amt.toFixed(4)} ${sym}{/}`
    );
    balanceLine = `{grey-fg}  Carteira: {/}${parts.join('  ')}\n`;
  }

  const DEX_COL = 6;
  headerBox.setContent([
    '{bright-cyan-fg}{bold}  ◈  ATMOS ARB BOT v2.0  ·  Atmos DEX  ·  Supra{/}',
    `{grey-fg}  EMA Trend · Opt Size · Score · ${new Date().toLocaleDateString('pt-PT')}{/}`,
    balanceLine,
    `{yellow-fg}{bold}  MERCADO — ${sorted.length} pools activas{/}`,
    '{grey-fg}  ' + 'DEX'.padEnd(DEX_COL) + 'PAR'.padEnd(14) + 'PREÇO'.padEnd(12) + 'TREND'.padEnd(5) + 'Δ%'.padEnd(9) + 'SPARK'.padEnd(14) + 'RES.A'.padEnd(8) + 'RES.B'.padEnd(8) + 'FEE{/}',
    '{grey-fg}  ' + '─'.repeat(80) + '{/}',
  ].join('\n'));

  const L = [];
  for (const ps of sorted) {
    try {
      const key   = `ATMOS_${ps.tokenA}_${ps.tokenB}_${ps.curve || 'w'}`;
      const price = typeof ps.priceAinB === 'number' ? ps.priceAinB : 0;
      const t     = trackPrice(key, price);

      const dexCol   = `{magenta-fg}Atmos {/}`;
      const pairRaw  = `${ps.tokenA}/${ps.tokenB}`;
      const pairStr  = `{bold}${ps.tokenA}{/}/{grey-fg}${ps.tokenB}{/}`;
      const pairPad  = ' '.repeat(Math.max(0, 14 - pairRaw.length));
      const priceRaw = price.toFixed(6);
      const priceStr = `{${t.priceTag}-fg}${priceRaw}{/}`;
      const pricePad = ' '.repeat(Math.max(0, 12 - priceRaw.length));
      const trendStr = t.isNew ? '{grey-fg}─    {/}' : `${t.trendStr}   `;
      const tickStr  = t.isNew ? '{grey-fg}─        {/}' : `{${t.dirTag}-fg}${t.pctStr.padEnd(8)}{/}`;
      const sp       = sparkline(t.ticks);
      const rA       = fmtReserve(ps.reserveA || 0).padEnd(8);
      const rB       = fmtReserve(ps.reserveB || 0).padEnd(8);
      const feePct   = ((ps.fee / ps.feeScale) * 100).toFixed(2) + '%';
      const curveTag = ps.curve === 'stable' ? '{magenta-fg}S{/}' : '{grey-fg}W{/}';

      L.push(`  ${dexCol}${curveTag} ${pairStr}${pairPad}${priceStr}${pricePad}${trendStr}${tickStr}${sp}  {grey-fg}${rA}${rB}${feePct}{/}`);
    } catch (_) {}
  }
  pricesBox.setContent(L.join('\n'));
}

module.exports = renderPrices;
