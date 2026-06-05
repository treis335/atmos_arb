// src/utils/client.js — HTTP directo ao RPC Supra (sem overhead SDK para view calls)
const axios  = require('axios');
const { SupraClient, HexString } = require('supra-l1-sdk');
const config = require('../config');

// ── SDK singleton (apenas para assinar txs) ───────────────────────────────
let _client = null;
async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// ── HTTP directo ──────────────────────────────────────────────────────────
const http = axios.create({
  baseURL: config.rpc,
  timeout: config.viewTimeoutMs ?? 8000,
  headers: { 'Content-Type': 'application/json' },
});

// Rate limiter adaptativo
let _backoffMs    = 0;
let _lastThrottle = 0;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Serializa um argumento para o formato REST do Supra view endpoint
// Supra aceita: string, number, boolean, null, array, { vec: [...] }
function serializeArg(a) {
  if (a === null || a === undefined) return null;
  if (typeof a === 'bigint')  return a.toString();
  if (typeof a === 'number')  return a.toString();
  if (typeof a === 'boolean') return a;
  if (typeof a === 'string')  return a;
  // Objects (e.g. Option::None = { vec: [] }) — manter como JSON string
  if (typeof a === 'object')  return JSON.stringify(a);
  return String(a);
}

async function callView(fn, typeArgs = [], args = [], retries = (config.viewRetries ?? 1)) {
  const body = {
    function:       fn,
    type_arguments: typeArgs,
    arguments:      args.map(serializeArg),
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (_backoffMs > 0) {
      const wait = _backoffMs - (Date.now() - _lastThrottle);
      if (wait > 0) await sleep(wait);
    }
    try {
      const r = await http.post('/rpc/v1/view', body);
      if (_backoffMs > 0) _backoffMs = Math.max(0, _backoffMs - 200);
      return r.data?.result ?? r.data;
    } catch (e) {
      lastErr = e;
      if (e?.response?.status === 429) {
        _backoffMs    = Math.min(5000, (_backoffMs || 200) * 2);
        _lastThrottle = Date.now();
        attempt--;
        if (attempt < -20) throw e;
        await sleep(_backoffMs + Math.random() * 100);
        continue;
      }
      if (attempt < retries) await sleep(200 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Batch paralelo com limite — mais eficiente que chamadas individuais
async function callViewBatch(calls) {
  return Promise.all(
    calls.map(({ fn, typeArgs, args }) =>
      callView(fn, typeArgs ?? [], args ?? []).catch(() => null)
    )
  );
}

module.exports = { getClient, callView, callViewBatch };
