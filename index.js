// index.js — ponto de entrada do Atmos Arb Bot
// Inicia o TUI completo
console.log('🚀 A iniciar Atmos Arb Bot v2.0...\n');
require('./src/tui/monitor');
// index.js — Atmos Arb Bot (estilo Dexlyn)
require('dotenv').config();
const { initScreen } = require('./src/tui/monitor');
const { tick } = require('./src/loop/tick');   // cria este ficheiro se não existir
const { logError } = require('./src/utils/logger');

(async () => {
  process.on('uncaughtException', (err) => logError('uncaught', err));
  process.on('unhandledRejection', (reason) => logError('rejection', reason));

  console.log('🚀 Atmos Arb Bot v2.0 (estilo Dexlyn) a iniciar...');

  const boxes = initScreen();

  let running = false;
  async function scheduleTick() {
    if (running) return;
    running = true;
    try {
      await tick(boxes);
    } catch (e) {
      logError('tick', e);
    }
    running = false;
    setTimeout(scheduleTick, 1500); // polling suave
  }

  scheduleTick();
})();