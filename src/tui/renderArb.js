// src/tui/renderArb.js — painel de oportunidades de arbitragem reais
const fmtReserve = require('../utils/fmtReserve');

function renderArb(opps, boxes) {
  const box = boxes.arbBox || boxes;

  if (!opps || !opps.length) {
    box.setContent(
      '{grey-fg}Nenhuma oportunidade detectada acima do threshold.\n\n' +
      'Possíveis razões:\n' +
      '  · Mercado eficiente (spread < 0.10%)\n' +
      '  · Pools com liquidez baixa filtradas\n' +
      '  · RPC lento / timeout em muitas pools{/}'
    );
    return;
  }

  const minExec = 0.35;
  const lines   = [];

  opps.slice(0, 30).forEach((opp, i) => {
    const { result, optimalAmount, score } = opp;
    const pct   = result.profitPct.toFixed(3);
    const pabs  = result.profitAbs >= 0.0001 ? '+' + result.profitAbs.toFixed(4) + ' SUPRA' : '+' + (result.profitAbs * 1e8).toFixed(0) + ' raw';
    const color = result.profitPct >= minExec ? 'green'
                : result.profitPct > 0.10     ? 'yellow'
                : 'grey';
    const isAuto = boxes.autoEnabled?.();
    const badge = result.profitPct >= minExec
      ? (isAuto ? '{green-fg}▶EXEC{/} ' : '{yellow-fg}▶PRNT{/} ')
      : '      ';

    // Caminho completo
    const path = result.steps.map((s, j) => {
      const sym = j === 0 ? s.from : s.to;
      return `{white-fg}${sym}{/}`;
    }).join('{grey-fg}→{/}');

    // Fees e pools do caminho
    const feeStr = result.steps.map(s => {
      const fee = s.pair?.fee ?? 30;
      return (fee / 100).toFixed(2) + '%';
    }).join('+');

    // Liquidez mínima ao longo da rota
    const minLiq = Math.min(...result.steps.map(s => {
      const ps = s.pair;
      if (!ps) return 0;
      return s.from === ps.tokenA ? (ps.reserveA || 0) : (ps.reserveB || 0);
    }));

    const nHops = result.steps.length;
    const amt   = optimalAmount.toFixed(2);

    lines.push(
      `${badge}{${color}-fg}${String(i+1).padStart(2)}. +${pct.padStart(7)}%{/}  ` +
      `{white-fg}${nHops}h  in:${amt}S  ${pabs}{/}\n` +
      `     ${path}\n` +
      `     {grey-fg}fee:[${feeStr}]  liq:${fmtReserve(minLiq)}  score:${score}{/}`
    );
  });

  box.setContent(lines.join('\n'));
  if (!boxes.scrollPaused?.()) box.setScrollPerc(0);
}

module.exports = renderArb;
