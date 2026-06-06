// src/config/tokens.js — mapa FA address → ticker para a DEX Atmos
// Os tokens são Fungible Assets identificados por endereço puro (não ::module::Type)
// O mapa foi construído a partir dos endereços mais frequentes nas 585 pools.
// Para adicionar tokens: adiciona uma entrada em FA_MAP com o endereço completo.

// ─── Mapa estático (endereços conhecidos) ────────────────────────────────────
const FA_MAP = {
  // ── Tokens base ────────────────────────────────────────────────────────────
  '0x1::supra_coin::SupraCoin':                                                    { symbol: 'SUPRA',    decimals: 8 },

  // ── Top FA tokens por frequência nas pools ─────────────────────────────────
  '0x4b28b64c9fa2e5a10f8fb57f1df741f40f58d1eafcfb6ae7c6cfbc68c83d32f7':          { symbol: 'LUCKY',    decimals: 6 },
  '0xbb3c1ca1ef67b1a994f2463978695c7bf890710182f75edef05ad08490be3658':           { symbol: 'JOSH',     decimals: 6 },
  '0x80f0251b74c76f1c477b9209ade65ffb5cfecd9b259875c3865ad645f6c33a3d':           { symbol: 'DAWGZ',    decimals: 6 },
  '0xf90b4b9d4a9d87c39fb3140513e52edc3ead5eaddcb9881b02becdeb63c5793d':           { symbol: 'dexUSDC',  decimals: 6 },
  '0x90a8e901e02ac1539af4a865bbe4a6b96edc27375488803cfbbd6875ec57b281':           { symbol: 'MUMMY',    decimals: 6 },
  '0x7b66011900be87269647b5cce4902a04d3189982ae677a393b2046e55c92042':            { symbol: 'SPIKE',    decimals: 3 },
  '0x98e458ccc04ee5a5de8d82857476f820a033bede08f7fbf033390cea937c6ec6':           { symbol: 'LEO',      decimals: 6 },
  '0xe583ee359a571682c463c33635044712ad720b0fc59be327235abde4eacf98f7':           { symbol: 'MCB',      decimals: 6 },
  '0x7b6463ca7a54ee37e113c8333db9c0af49de39555ee1cb44837db4c085f8964':            { symbol: 'PECKY',    decimals: 6 },
  '0xe1afaaed7625f0a500fc42adb440bd999b7249a0c96e48c4a3f11bc30c211d8':            { symbol: 'CASH',     decimals: 8 },
  '0xa387de3ef742f9bbf00e8d9d3fe6ef2f4fa549036a8d29db8432d50edb463f41':          { symbol: 'REPANDA',  decimals: 6 },
  '0x1a290d95d7d2f934bd76f58fa5c3d29612fab9aa9bba00283e67abc26543b00a':           { symbol: 'LOWCAPS',  decimals: 6 },
  '0x459b5670239b5ddf864138012df750d0e5210628e299a48e4d94f75711e82fc3':           { symbol: 'WABBIT',   decimals: 6 },
  '0x9d998eff3c742a24139590c57d02ff43a4e536a66bb415edabca6979f081bf1':            { symbol: 'TSUPRA',   decimals: 6 },
  '0xf0ab0c3c9ab3abf0596dee7713d453096b538a76bdf3b69b0bb271558b40ae52':           { symbol: 'BABYJOSH', decimals: 6 },
  '0x99f84c4fda663bf3baf3a1b0980386ca084c3e9340a4d3f8713cd54ec85f4cea':           { symbol: 'NANA',     decimals: 6 },
  '0xe4af154ade9551e7f58a23b8f727ae2dca050f1b74582bb518ba361c889d246d':           { symbol: 'OG',       decimals: 6 },
  '0xaa925a2232144c11dfe855178e1d252a8d0d4f51f5572fc0ec34efa6333952ae':           { symbol: 'SBC',      decimals: 6 },
  '0x870900b6557795114cb154a747400eb5a683d1cc6c9a1f5a0af318f7cf57bf67':           { symbol: 'SUPDOG',   decimals: 6 },
  '0xf199782bff16646c43de02fe1ca4244def5ea7abe0796a4f45002795e6f6ca35':           { symbol: 'ROBBIE',   decimals: 6 },
  '0xcc0891286f5df62496390cda6cd0d769cd480667eed04d918be4f9bf3ae96b1d':           { symbol: 'PUMP',     decimals: 6 },
  '0xb9a4b9082fd9d6bd04987bc0b4676a1c192b3d06daef7b4387ce4e28f12960eb':           { symbol: 'SHILLBIL', decimals: 6 },
  '0x1cc2bc27c5134ffcdd80fddcfaa1b9a05f6c03649c9927429f95fc723174c0ae':           { symbol: 'FLP',      decimals: 6 },
  '0xceff14089bde0d4f512dcd3b6f3df6794346c58115b8d97e043f92ff08cd1fca':           { symbol: 'SUPD',     decimals: 6 },
  '0x9ffbff160e048e16ed4b9fed27c0b004bfc6b163373793b7f1c4d63b237fe85f':           { symbol: 'STC',      decimals: 6 },
  '0xd7908e3916c2787239114d6eb634380ff60458f9ee7212e46ac0d37e673be851':           { symbol: 'SOUP',     decimals: 6 },
  '0x77076e706585f7645c722bc5d7362c0d67100431f585a9973c7a1d26e35e0a64':           { symbol: 'DXLYN',    decimals: 6 },
  '0xcc084e2c06f8680aecc8a94a4e4e81c027fb9df93c3eaee6d96c8d1ef73d3254':           { symbol: 'JONES',    decimals: 6 },
  '0x7707d85fc99e1dadb570e9fbd3a6a9e71d5ba0ba258a31fd3fc69b1bf498d644':           { symbol: 'DRAGON',   decimals: 6 },
};

// Índice inverso para lookup rápido por símbolo
const SYMBOL_TO_ADDR = {};
for (const [addr, info] of Object.entries(FA_MAP)) {
  SYMBOL_TO_ADDR[info.symbol] = addr;
}

// Runtime registry para tokens descobertos via on-chain
const _runtime = {};

function getSymbol(addr) {
  return FA_MAP[addr]?.symbol || _runtime[addr]?.symbol || _shortAddr(addr);
}

function getDecimals(addr) {
  return FA_MAP[addr]?.decimals ?? _runtime[addr]?.decimals ?? 8;
}

// Regista token descoberto em runtime (via get_fa_details_multi)
function registerFA(addr, symbol, decimals) {
  if (FA_MAP[addr]) return; // não sobrescreve o mapa estático
  _runtime[addr] = { symbol: symbol || _shortAddr(addr), decimals: decimals ?? 8 };
}

function isKnown(addr) {
  return !!(FA_MAP[addr] || _runtime[addr]);
}

function _shortAddr(addr) {
  if (!addr) return '???';
  const s = addr.startsWith('0x') ? addr.slice(2) : addr;
  return s.slice(0, 4) + '..' + s.slice(-4);
}

module.exports = { FA_MAP, SYMBOL_TO_ADDR, getSymbol, getDecimals, registerFA, isKnown };
