// src/tui/renderArb.js — painel ARB DETECTOR, baseado no dexlyn_arb_original

function scoreBar(score) {
  const filled = Math.round(score / 10);
  const color  = score >= 70 ? 'bright-green' : score >= 40 ? 'yellow' : 'red';
  return `{${color}-fg}${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}{/}`;
}

function renderArb(opps, boxes) {
  const { arbBox } = boxes;
  const L = [];

  if (!opps.length) {
    L.push('{grey-fg}  Sem oportunidades acima do mínimo{/}');
  } else {
    let totalProfit = 0;
    for (const { cycle, result, optimalAmount, score, profitScore, liquidityScore, trendScore } of opps) {
      const { profitPct, profitAbs, steps } = result;
      const symIn = cycle.path[0];
      if (symIn === 'SUPRA') totalProfit += profitAbs;

      const isHot = score >= 70, isWarm = score >= 40;
      const badge = isHot ? '{green-bg}{black-fg} 🔥 EXEC {/}' : isWarm ? '{yellow-fg} ◈ AVAL  {/}' : '{grey-fg} ○ FRACO {/}';
      const pc    = isHot ? 'bright-green' : isWarm ? 'yellow' : 'grey';

      L.push(` ${badge} {${pc}-fg}+${profitPct.toFixed(3)}%  +${profitAbs.toFixed(3)} ${symIn}{/}  {grey-fg}opt:${optimalAmount.toFixed(0)} ${symIn}{/}`);
      L.push(`  ${scoreBar(score)} {grey-fg}P:${(profitScore*100).toFixed(0)}% L:${(liquidityScore*100).toFixed(0)}% T:${(trendScore*100).toFixed(0)}%{/}`);

      // Rota
      const pathParts = cycle.path.map((token, idx) => {
        if (idx === 0) return token;
        const prevEdge = cycle.edges[idx - 1];
        const curve = prevEdge?.pair?.curve === 'stable' ? 'S' : 'W';
        return `{grey-fg}[${curve}]{/} → ${token}`;
      });
      L.push(`  {grey-fg}Rota: {/}${pathParts.join(' ')}`);

      // Passos
      for (let i = 0; i < steps.length; i++) {
        const s  = steps[i];
        const co = i === steps.length - 1 ? '└' : '├';
        const curve = s.pair?.curve === 'stable' ? '{magenta-fg}S{/}' : '{grey-fg}W{/}';
        L.push(
          `  {grey-fg}${co} ${s.from} → ${s.to} {/}[${curve}]` +
          `  {grey-fg}in:{/}{${pc}-fg}${s.amtIn.toFixed(4)}{/}` +
          `  {grey-fg}out:{/}{${pc}-fg}${s.amtOut.toFixed(4)}{/}`
        );
      }
      L.push('{grey-fg}  ' + '─'.repeat(40) + '{/}');
    }
    if (totalProfit > 0) L.unshift(`{yellow-fg}{bold}  💰 Total estimado: ${totalProfit.toFixed(3)} SUPRA{/}`, '');
  }

  arbBox.setContent(L.join('\n'));
  if (!boxes.scrollPaused()) arbBox.scrollTo(0);
}

module.exports = renderArb;
