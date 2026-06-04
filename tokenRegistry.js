// tokenRegistry.js
// Resolve símbolos de tokens: usa knownTokens do config primeiro,
// depois tenta chain via coin_utils::get_coin_detail, depois usa endereço curto.

const { SupraClient } = require('supra-l1-sdk');
const config = require('./config');

const cache = new Map(
  Object.entries(config.knownTokens).map(([addr, info]) => [addr, info])
);
let _client = null;
const pending = new Set();

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

function shortAddr(addr) {
  return addr.includes('::')
    ? addr.split('::').pop()
    : addr.slice(0, 6) + '..' + addr.slice(-4);
}

async function resolveToken(addr) {
  if (cache.has(addr)) return cache.get(addr);
  if (pending.has(addr)) return { symbol: shortAddr(addr), decimals: 6 };

  pending.add(addr);
  try {
    const client = await getClient();
    // FA token: endereço nu sem '::'
    if (!addr.includes('::')) {
      const r = await client.invokeViewMethod(
        `${config.atmosModule}::coin_utils::get_coin_detail`,
        [addr, '0']
      );
      if (r && r.symbol) {
        const info = { symbol: r.symbol, decimals: Number(r.decimals ?? 6) };
        cache.set(addr, info);
        return info;
      }
    }
  } catch (_) {}

  // Fallback: extrair nome do tipo ou endereço curto
  const info = { symbol: shortAddr(addr), decimals: 6 };
  cache.set(addr, info);
  return info;
}

function getSymbol(addr) {
  return cache.get(addr)?.symbol ?? shortAddr(addr);
}

function getDecimals(addr) {
  return cache.get(addr)?.decimals ?? 6;
}

// Pré-popular cache com knownTokens
function preload() {
  for (const [addr, info] of Object.entries(config.knownTokens)) {
    cache.set(addr, info);
  }
}

module.exports = { resolveToken, getSymbol, getDecimals, preload };
