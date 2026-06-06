// src/utils/callView.js — axios directo com backoff adaptativo para 429
// Baseado no padrão do dexlyn_arb_original que funciona em produção

const axios = require('axios');
const config = require('../config');

// Backoff global partilhado — se o RPC throttle, todos os pedidos abrandam
let globalBackoffMs = 0;
let lastThrottleTime = 0;

const http = axios.create({
  baseURL: config.rpc,
  timeout: config.viewTimeoutMs,
});

async function callView(fn, typeArgs = [], args = [], retries) {
  retries = retries ?? config.viewRetries ?? 3;

  for (let attempt = 0; attempt < retries; attempt++) {
    // Respeita backoff global se o RPC estiver a throttle
    if (globalBackoffMs > 0) {
      const remaining = globalBackoffMs - (Date.now() - lastThrottleTime);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
    }

    try {
      const res = await http.post('/rpc/v1/view', {
        function:       fn,
        type_arguments: typeArgs,
        arguments:      args,
      });

      // Sucesso — reduz backoff gradualmente
      if (globalBackoffMs > 0) globalBackoffMs = Math.max(0, globalBackoffMs - 200);
      return res.data?.result ?? res.data;

    } catch (err) {
      const status = err?.response?.status;

      if (status === 429) {
        // Rate limit: aumenta backoff e retenta (não conta como tentativa)
        globalBackoffMs = Math.min(5000, (globalBackoffMs || 500) * 2);
        lastThrottleTime = Date.now();
        await new Promise(r => setTimeout(r, globalBackoffMs + Math.random() * 300));
        attempt--;
        if (attempt < -10) throw err;
        continue;
      }

      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 400 + Math.random() * 200));
    }
  }
}

module.exports = { callView };
