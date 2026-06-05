// src/utils/client.js — HTTP directo ao RPC Supra (sem overhead do SDK para view calls)
// O SDK tem ~50-100ms de overhead por call. HTTP directo cai para ~50-80ms.
// Para execução de txs ainda usamos o SDK (necessário para signing).

const axios   = require('axios');
const { SupraClient } = require('supra-l1-sdk');
const config  = require('../config');

// ── SDK singleton (só para execução de txs) ───────────────────────────────
let _client = null;
async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// ── HTTP directo para view calls (mais rápido) ────────────────────────────
const http = axios.create({
  baseURL: config.rpc,
  timeout: config.viewTimeoutMs ?? 8000,
  headers: { 'Content-Type': 'application/json' },
});

// Rate limiter global: se o RPC devolver 429, abranda automaticamente
let _backoffMs    = 0;
let _lastThrottle = 0;

async function callView(fn, typeArgs = [], args = [], retries = config.viewRetries ?? 2) {
  // Serializar args para o formato REST da Supra
  const serialized = args.map(a => {
    if (a === null || a === undefined) return null;
    if (typeof a === 'object' && !Array.isArray(a)) return JSON.stringify(a);
    return String(a);
  });

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Backoff global se RPC estiver a throttle
    if (_backoffMs > 0) {
      const remaining = _backoffMs - (Date.now() - _lastThrottle);
      if (remaining > 0) await sleep(remaining);
    }

    try {
      const r = await http.post('/rpc/v1/view', {
        function:       fn,
        type_arguments: typeArgs,
        arguments:      serialized,
      });
      // Sucesso — reduz backoff gradualmente
      if (_backoffMs > 0) _backoffMs = Math.max(0, _backoffMs - 100);
      const result = r.data?.result ?? r.data;
      return result;

    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;

      if (status === 429) {
        // Rate limit — aumenta backoff exponencialmente
        _backoffMs    = Math.min(3000, (_backoffMs || 300) * 2);
        _lastThrottle = Date.now();
        attempt--; // não conta como tentativa falhada
        if (attempt < -10) throw e; // evita loop infinito
        await sleep(_backoffMs + Math.random() * 100);
        continue;
      }

      if (attempt < retries) await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Batch de múltiplos view calls em paralelo com limite de concorrência
// Mais eficiente que chamar individualmente com Promise.all
async function callViewBatch(calls) {
  return Promise.all(calls.map(({ fn, typeArgs, args }) =>
    callView(fn, typeArgs ?? [], args ?? []).catch(() => null)
  ));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { getClient, callView, callViewBatch };
