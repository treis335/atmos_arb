// src/tui/boxes.js — criação de todos os painéis blessed do TUI
const blessed = require('blessed');

function createScreen() {
  const screen = blessed.screen({ smartCSR: true, title: 'ATMOS ARB BOT v2' });

  const header = blessed.box({
    top: 0, left: 0, width: '100%', height: 3,
    content: ' ◈  ATMOS ARB BOT v2.0  ·  Atmos DEX  ·  Supra Network',
    tags: true, style: { fg: 'cyan', bold: true, bg: 'black' },
  });

  const statsBar = blessed.box({
    top: 3, left: 0, width: '100%', height: 1,
    content: ' A iniciar...', tags: true,
    style: { fg: 'white', bg: 'black' },
  });

  const oppBox = blessed.box({
    top: 4, left: 0, width: '65%', height: '60%-4',
    label: ' 🎯 OPORTUNIDADES ',
    border: { type: 'line' }, tags: true, scrollable: true, alwaysScroll: true,
    style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
    content: 'A aguardar dados...',
  });

  const pairsBox = blessed.box({
    top: 4, right: 0, width: '35%', height: '60%-4',
    label: ' 📊 POOLS ',
    border: { type: 'line' }, tags: true, scrollable: true,
    style: { border: { fg: 'blue' }, label: { fg: 'blue' } },
    content: '...',
  });

  const logBox = blessed.box({
    bottom: 1, left: 0, width: '65%', height: '40%',
    label: ' 📋 LOG ',
    border: { type: 'line' }, tags: true, scrollable: true, alwaysScroll: true,
    style: { border: { fg: 'green' }, label: { fg: 'green' } },
    content: '',
  });

  const statsBox = blessed.box({
    bottom: 1, right: 0, width: '35%', height: '40%',
    label: ' 📈 STATS ',
    border: { type: 'line' }, tags: true,
    style: { border: { fg: 'magenta' }, label: { fg: 'magenta' } },
    content: '',
  });

  const footer = blessed.box({
    bottom: 0, left: 0, width: '100%', height: 1,
    content: ' [Q] Sair  [A] Toggle AUTO  [R] Refresh  [↑↓] Scroll Opps',
    tags: true, style: { fg: 'black', bg: 'cyan' },
  });

  for (const b of [header, statsBar, oppBox, pairsBox, logBox, statsBox, footer])
    screen.append(b);

  return { screen, header, statsBar, oppBox, pairsBox, logBox, statsBox, footer };
}

module.exports = { createScreen };
