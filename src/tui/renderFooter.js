// src/tui/renderFooter.js — footer compacto, baseado no dexlyn_arb_original
const config = require('../config');
const { getErrorCount } = require('../utils/logger');

let rpcHealthy = true;
function setRpcHealthy(v) { rpcHealthy = v; }

function renderFooter(opps, tickMs, boxes) {
  const best    = opps[0];
  const bestStr = best
    ? `{bright-green-fg}▲ +${best.result.profitPct.toFixed(2)}% sc:${best.score}{/}`
    : '{grey-fg}sem arb{/}';
  const rpcIcon = rpcHealthy ? '{green-fg}🟢{/}' : '{red-fg}🔴{/}';
  const auto    = config.autoExecute.enabled ? '{green-fg}AUTO{/}' : '{grey-fg}MAN{/}';
  const err     = getErrorCount() > 0 ? `{red-fg}⚠${getErrorCount()}{/}` : '';

  boxes.footerBox.setContent(
    `{grey-fg}─{/} ${auto} ${bestStr} ${rpcIcon} t:${tickMs}ms ${err}  {grey-fg}[a]auto [e]exec [c]snap [q]sair{/}`
  );
}

module.exports = { renderFooter, setRpcHealthy };
