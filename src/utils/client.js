// src/utils/client.js — singleton do SupraClient com callView resiliente
const { SupraClient } = require('supra-l1-sdk');
const config = require('../config');

let _client = null;

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// callView com retry automático e timeout configurável
async function callView(fn, typeArgs = [], args = [], retries = config.viewRetries) {
  const client = await getClient();
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await Promise.race([
        client.invokeViewMethod(fn, typeArgs, args),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`callView timeout: ${fn}`)), config.viewTimeoutMs)
        ),
      ]);
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = { getClient, callView };
