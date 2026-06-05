// src/utils/logger.js — logger simples com timestamp e ficheiro de erros
const fs   = require('fs');
const path = require('path');

const LOG_FILE = path.join(process.cwd(), 'errors.log');

function timestamp() {
  return new Date().toLocaleTimeString('pt-PT');
}

function logError(context, err) {
  const msg = `[${new Date().toISOString()}] [${context}] ${err?.message || err}\n`;
  try { fs.appendFileSync(LOG_FILE, msg); } catch (_) {}
}

module.exports = { timestamp, logError };
