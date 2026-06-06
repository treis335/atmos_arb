// src/utils/supaClient.js — singleton do SupraClient partilhado por todo o bot
// Inicializado UMA vez no arranque, reutilizado por engine e executor.
// Evita múltiplos GET /chain_id que causam rate limit 429.

const { SupraClient, HexString, SupraAccount, BCS } = require('supra-l1-sdk');
const config = require('../config');

let _client   = null;
let _initPromise = null;

async function getSupraClient() {
  if (_client) return _client;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const orig = console.log; console.log = () => {};
    try {
      _client = await SupraClient.init(config.rpc);
    } finally {
      console.log = orig;
      _initPromise = null;
    }
    return _client;
  })();

  return _initPromise;
}

module.exports = { getSupraClient, HexString, SupraAccount, BCS };
