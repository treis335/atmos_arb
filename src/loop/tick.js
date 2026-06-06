// src/loop/tick.js — exporta tick() para uso externo se necessário
// O loop principal está em src/tui/monitor.js
// Este módulo existe para compatibilidade e testes

module.exports = async function tick(boxes) {
  // O monitor.js tem o seu próprio loop interno
  // Este stub existe para não quebrar imports
};
