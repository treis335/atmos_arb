// src/tui/renderPrices.js — painel de pools com info REAL e completa
const fmtReserve = require('../utils/fmtReserve');

function renderPrices(pairStates, boxes, walletBalances) {
  const box = boxes.pricesBox || boxes;

  if (!pairStates || !pairStates.length) {
    box.setContent('{grey-fg}A aguardar dados das pools...\nVerifica o RPC e a ligação à internet.{/}');
    return;
  }

  // Linha de resumo no topo
  const totalLiq = pairStates.reduce((s, ps) => s + (ps.reserveA || 0) + (ps.reserveB || 0), 0);
  const supraPrice = pairStates.find(ps => ps.tokenA === 'SUPRA' && ps.tokenB === 'dexUSDC')?.priceAinB
                  || pairStates.find(ps => ps.tokenA === 'dexUSDC' && ps.tokenB === 'SUPRA')
                     ?.priceAinB && 1 / pairStates.find(ps => ps.tokenA === 'dexUSDC' && ps.tokenB === 'SUPRA').priceAinB
                  || 0;

  const walletLine = walletBalances?.SUPRA != null
    ? `{yellow-fg}Wallet: ${walletBalances.SUPRA.toFixed(2)} SUPRA{/}  `
    : '';

  const header = `${walletLine}{grey-fg}${pairStates.length} pools activas  Liq total: ${fmtReserve(totalLiq)}{/}`;

  // Ordenar por liquidez total
  const sorted = [...pairStates].sort((a, b) => {
    const liqA = (a.reserveA || 0) + (a.reserveB || 0);
    const liqB = (b.reserveA || 0) + (b.reserveB || 0);
    return liqB - liqA;
  });

  const lines = sorted.slice(0, 80).map(ps => {
    const symA = (ps.tokenA || '???').padEnd(9);
    const symB = (ps.tokenB || '???').padEnd(9);

    // Preço formatado
    const p = ps.priceAinB;
    let price;
    if (!p || !isFinite(p) || p <= 0) {
      price = '       ???';
    } else if (p < 0.000001) { price = p.toExponential(2).padStart(10); }
    else if (p < 0.001)      { price = p.toExponential(3).padStart(10); }
    else if (p < 1000)       { price = p.toFixed(4).padStart(10); }
    else if (p < 1e7)        { price = p.toFixed(1).padStart(10); }
    else                     { price = p.toExponential(2).padStart(10); }

    // Liquidez
    const liqA = fmtReserve(ps.reserveA).padStart(7);
    const liqB = fmtReserve(ps.reserveB).padStart(7);

    // Fee
    const fee = (ps.fee / 100).toFixed(2).padStart(4) + '%';

    // Tipo pool
    const typeTag = ps.curve === 'stable' ? '{magenta-fg}S{/}' : '{blue-fg}W{/}';

    // Indicador liquidez
    const totalLiq = (ps.reserveA || 0) + (ps.reserveB || 0);
    const liqTag = totalLiq > 50000 ? '{green-fg}◆◆{/}'
                 : totalLiq > 5000  ? '{green-fg}◆{/} '
                 : totalLiq > 500   ? '{yellow-fg}◇{/} '
                 : '{grey-fg}· {/}';

    return `${liqTag}${typeTag} {cyan-fg}${symA}{/}/{cyan-fg}${symB}{/}{white-fg}${price}{/} {grey-fg}${fee} ${liqA}/${liqB}{/}`;
  });

  box.setContent(header + '\n' + lines.join('\n'));
}

module.exports = renderPrices;
