// src/tui/renderArb.js — painel ARB DETECTOR
function scoreBar(score) {
  const filled = Math.round(score / 10);
  const color  = score >= 70 ? 'bright-green' : score >= 40 ? 'yellow' : 'red';
  return `{${color}-fg}${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}{/}`;
}

function renderArb(opps, boxes) {
  const { arbBox } = boxes;
  const L = [];

  if (!opps.length) {
    L.push('{grey-fg}  Sem oportunidades com tokens conhecidos{/}');
    L.push('{grey-fg}  (lucros >5% filtrados como falsos positivos){/}');
  } else {
    let totalProfit = 0;
    for (const { cycle, result, optimalAmount, score, profitScore, liquidityScore, trendScore } of opps) {
      const { profitPct, profitAbs, steps } = result;
      totalProfit += profitAbs;

      const isHot  = score >= 70, isWarm = score >= 40;
      const badge  = isHot ? '{green-bg}{black-fg} 🔥 EXEC {/}' : isWarm ? '{yellow-fg} ◈ AVAL  {/}' : '{grey-fg} ○ FRACO {/}';
      const pc     = isHot ? 'bright-green' : isWarm ? 'yellow' : 'grey';
      const hops   = steps.length;
      const inAmt  = optimalAmount.toFixed(2);
      const first  = steps[0]?.fromSym || cycle.path[0];

      L.push(` ${badge} {${pc}-fg}+${profitPct.toFixed(3)}%  ${hops}h  in:${inAmt}${first}  +${profitAbs.toFixed(4)} ${first}{/}`);
      L.push(`  ${scoreBar(score)} {grey-fg}P:${(profitScore*100).toFixed(0)}% L:${(liquidityScore*100).toFixed(0)}% T:${(trendScore*100).toFixed(0)}%{/}`);
      L.push(`  {grey-fg}Rota: {/}${cycle.path.join(' → ')}`);
      L.push(`  {grey-fg}fee:[${steps.map(s=>((s.pair.fee/s.pair.feeScale)*100).toFixed(2)+'%').join('+')}]  liq:${Math.round(Math.min(...steps.map(s=>Math.min(s.pair.reserveA,s.pair.reserveB)))).toLocaleString()}{/}`);

      for (let i = 0; i < steps.length; i++) {
        const s  = steps[i];
        const co = i === steps.length - 1 ? '└' : '├';
        const cv = s.pair?.curve === 'stable' ? '{magenta-fg}S{/}' : '{grey-fg}W{/}';
        L.push(
          `  {grey-fg}${co} ${s.fromSym||s.from.slice(0,6)} → ${s.toSym||s.to.slice(0,6)} {/}[${cv}]` +
          `  {grey-fg}in:{/}{${pc}-fg}${s.amtIn.toFixed(4)}{/}` +
          `  {grey-fg}out:{/}{${pc}-fg}${s.amtOut.toFixed(4)}{/}`
        );
      }
      L.push('{grey-fg}  ' + '─'.repeat(44) + '{/}');
    }
    if (totalProfit > 0) L.unshift(`{yellow-fg}{bold}  💰 Total estimado: ${totalProfit.toFixed(4)} SUPRA{/}`, '');
  }

  arbBox.setContent(L.join('\n'));
  if (!boxes.scrollPaused()) arbBox.scrollTo(0);
}

module.exports = renderArb;
