// src/loop/tick.js
const { fetchWalletBalance } = require('../dex/executor');
const { detectArbitrage } = require('../core/detector'); // ajusta conforme teu detector
const { executeRoute } = require('../dex/executor');

let lastBalance = {};

module.exports = async function tick(boxes) {
  try {
    const balances = await fetchWalletBalance();
    if (balances.SUPRA !== undefined) {
      lastBalance = balances;
      boxes.balanceBox.setContent(`SUPRA: ${balances.SUPRA.toFixed(4)}\n` +
        Object.entries(balances).map(([s,b]) => `${s}: ${b.toFixed(4)}`).join('\n'));
    }

    const opportunities = await detectArbitrage();
    
    if (opportunities.length > 0) {
      const best = opportunities[0];
      boxes.oppBox.setContent(`💰 Oportunidade encontrada!\nProfit: ${best.profitPercent.toFixed(2)}%`);
      
      if (best.profitPercent > 1.5) { // threshold
        boxes.logBox.insertLine(0, `🚀 Executando arbitragem...`);
        const result = await executeRoute(best);
        if (result.success) boxes.logBox.insertLine(0, `✅ Trade executado!`);
      }
    }

    boxes.screen.render();
  } catch (e) {
    console.error(e);
  }
};