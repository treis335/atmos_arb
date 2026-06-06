const fs   = require('fs');
const path = require('path');
const LOG_FILE = path.join(process.cwd(), 'errors.log');
let _errCount = 0;

function timestamp() { return new Date().toLocaleTimeString('pt-PT'); }

function logError(ctx, err) {
  _errCount++;
  const msg = `[${new Date().toISOString()}] [${ctx}] ${err?.message || err}\n`;
  try { fs.appendFileSync(LOG_FILE, msg); } catch (_) {}
}

function getErrorCount() { return _errCount; }

module.exports = { timestamp, logError, getErrorCount };
