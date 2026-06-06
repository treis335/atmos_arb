// src/tui/renderLog.js — log das últimas oportunidades detectadas
const logLines = [];
const MAX_LINES = 200;

function renderLog(opps, boxes) {
  if (opps.length > 0) {
    const top = opps[0];
    const route = top.cycle.path.join(' → ');
    const line = `{grey-fg}${new Date().toLocaleTimeString('pt-PT')}{/}  {green-fg}+${top.result.profitPct.toFixed(3)}%{/}  ${route}  sc:${top.score}`;
    logLines.unshift(line);
    if (logLines.length > MAX_LINES) logLines.pop();
  }
  if (logLines.length > 0) {
    boxes.logBox.setContent(logLines.join('\n'));
  }
}

module.exports = renderLog;
