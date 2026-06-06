// src/dex/engine.js
// ESTRATÉGIA CONFIRMADA PELAS ABIs:
//
// FETCH: get_pools_map() — 0 args, retorna SimpleMap<address, PoolResponse>
//   PoolResponse: { pool_address, coins, pool_balances, weights, swap_fee_bps, pool_type, locked }
//   UMA única chamada RPC para todas as 281 pools.
//   Fallback: get_pool_by_address(addr) em batch paralelo.
//
// PREÇO (Balancer weighted math):
//   spot_price(A→B) = (balance_B / weight_B) / (balance_A / weight_A)
//   weights somam 1_000_000 (ex: 50/50 = [500000, 500000])
//
// TOKENS: coins[] no PoolResponse são Object<Metadata> addresses
//   FA token address = o próprio endereço do Metadata object
//   Coin token: precisa de conversão via get_coin_fa_address (feita no discover)

const { callView } = require('../utils/client');
const { getDecimals } = require('../config/tokens');
const asyncLimit    = require('../utils/asyncLimit');
const config        = require('../config');
const fs            = require('fs');

const ATMOS = config.atmosModule;
let _debugDone = false;

// ── Balancer weighted spot price ──────────────────────────────────────────
function weightedSpot(r0, r1, w0, w1) {
  // weights em unidades absolutas (ex: 500000), não percentagem
  return (r1 / (w1 || 500000)) / (r0 / (w0 || 500000));
}

// ── Parser de PoolResponse (confirmado pelas ABIs) ────────────────────────
// Struct: pool_address, coins[], pool_balances[], lp_token_supply,
//         amp_factor, precision_multipliers[], weights[], swap_fee_bps, pool_type, locked
function parsePoolResponse(addr, pr, poolMeta) {
  if (!pr) return null;
  if (pr.locked === true || pr.locked === 'true') return null;

  const rawBals  = pr.pool_balances ?? [];
  const weights  = (pr.weights ?? []).map(Number);
  const feeBps   = Number(pr.swap_fee_bps ?? 30);
  // pool_type: u8 — 0=weighted, 1=stable (confirmado na struct Pool)
  const poolType = Number(pr.pool_type) === 1 ? 'stable' : 'weighted';

  if (rawBals.length < 2) return null;

  // coins[] = vector<Object<Metadata>> — são os FA addresses dos tokens
  const coins = pr.coins ?? [];
  const meta  = poolMeta ?? {};

  // token0/token1 do pools.json têm prioridade (já validados no discover)
  const t0 = meta.token0Type ?? String(coins[0] ?? '');
  const t1 = meta.token1Type ?? String(coins[1] ?? '');
  if (!t0 || !t1 || t0 === 'undefined') return null;

  const dec0 = meta.decimals0 ?? getDecimals(t0) ?? 8;
  const dec1 = meta.decimals1 ?? getDecimals(t1) ?? 8;
  const r0   = Number(rawBals[0]) / (10 ** dec0);
  const r1   = Number(rawBals[1]) / (10 ** dec1);

  if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return null;

  const w0 = weights[0] || 500000;
  const w1 = weights[1] || 500000;
  // Stable pools: StableSwap ≈ r1/r0 (válido quando amp factor é alto)
  const rawPrice = poolType === 'stable' ? (r1 / r0) : weightedSpot(r0, r1, w0, w1);
  if (!isFinite(rawPrice) || rawPrice <= 0) return null;

  return {
    pool: {
      address: addr, token0Type: t0, token1Type: t1,
      decimals0: dec0, decimals1: dec1,
      swapFeeBps: feeBps, poolType, weights: [w0, w1],
    },
    reserve0: r0, reserve1: r1, rawPrice,
  };
}

function buildPoolMeta(allPools) {
  const map = {};
  for (const p of allPools) {
    const a = p.address ?? p.poolAddress;
    if (a) map[a] = p;
  }
  return map;
}

// Parseia SimpleMap<address, PoolResponse> nos vários formatos do SDK Supra
function parseSimpleMap(res) {
  if (!res) return [];
  // Formato 1: { data: [[key, value], ...] }  ← mais comum
  if (res.data && Array.isArray(res.data)) return res.data;
  // Formato 2: [[key, value], ...]
  if (Array.isArray(res) && Array.isArray(res[0])) return res;
  // Formato 3: [{ key, value }, ...]
  if (Array.isArray(res) && res[0]?.key !== undefined) return res.map(e => [e.key, e.value]);
  // Formato 4: objecto chave→valor
  if (typeof res === 'object') {
    return Object.entries(res).filter(([k]) => k !== 'data' && k.startsWith('0x'));
  }
  return [];
}

// ── Modo 1: get_pools_map() — 1 única chamada RPC ─────────────────────────
async function fetchViaPoolsMap(allPools) {
  const poolMeta = buildPoolMeta(allPools);
  try {
    const res = await callView(`${ATMOS}::liquidity_pool::get_pools_map`, [], []);

    if (!_debugDone) {
      _debugDone = true;
      const entries = parseSimpleMap(res);
      fs.appendFileSync('debug_batch.json', JSON.stringify({
        mode:    'get_pools_map',
        resType: typeof res,
        isArray: Array.isArray(res),
        keys:    res ? Object.keys(res).slice(0,5) : [],
        count:   entries.length,
        sample:  entries.slice(0,1),
      }, null, 2) + '\n---\n');
    }

    const entries = parseSimpleMap(res);
    if (!entries.length) return null;

    const results = [];
    for (const entry of entries) {
      let addr, pr;
      if (Array.isArray(entry)) { [addr, pr] = entry; }
      else { addr = entry[0]; pr = entry[1]; }
      if (!addr || typeof addr !== 'string') continue;
      const data = parsePoolResponse(addr, pr, poolMeta[addr]);
      if (data) results.push(data);
    }

    // Aceita se >= 20% das pools responderam
    return results.length >= allPools.length * 0.2 ? results : null;
  } catch (e) {
    if (!_debugDone) {
      _debugDone = true;
      fs.appendFileSync('debug_batch.json',
        JSON.stringify({ mode: 'get_pools_map', error: e.message, status: e.response?.status }) + '\n---\n'
      );
    }
    return null;
  }
}

// ── Modo 2: get_pool_by_address batch ─────────────────────────────────────
// get_pool_by_address(address) → Option<PoolResponse>
// Option = { vec: [PoolResponse] } quando presente, { vec: [] } quando None
async function fetchViaPoolByAddress(allPools, onProgress) {
  const poolMeta = buildPoolMeta(allPools);
  const results  = [];
  let done = 0;
  const limit = asyncLimit(Math.min(config.maxConcurrent, 25));

  await Promise.all(allPools.map(pool => limit(async () => {
    const addr = pool.address ?? pool.poolAddress;
    if (!addr) { onProgress?.(++done, allPools.length); return; }
    try {
      const res = await callView(`${ATMOS}::liquidity_pool::get_pool_by_address`, [], [addr]);
      // Option<PoolResponse>: { vec: [pr] } ou null
      let pr = null;
      if (res?.vec?.length > 0)                                      pr = res.vec[0];
      else if (Array.isArray(res) && res.length > 0)                 pr = res[0];
      else if (res?.pool_balances || res?.pool_type !== undefined)    pr = res;

      if (pr) {
        const data = parsePoolResponse(addr, pr, poolMeta[addr]);
        if (data) results.push(data);
      }
    } catch (_) {}
    onProgress?.(++done, allPools.length);
  })));

  return results;
}

// ── Entry point ────────────────────────────────────────────────────────────
async function fetchAllPools(allPools, onProgress) {
  // 1. get_pools_map — 1 call, mais rápido
  const mapResult = await fetchViaPoolsMap(allPools);
  if (mapResult?.length) {
    onProgress?.(allPools.length, allPools.length);
    return mapResult;
  }
  // 2. get_pool_by_address — 1 call/pool com pesos reais
  return fetchViaPoolByAddress(allPools, onProgress);
}

// ── Simulate swap (pré-execução) ──────────────────────────────────────────
// simulate_swap_exact_in_weighted(pool, token_in, token_out, amount_in, referrer)
// todos os Object<X> = endereço (address) serializado
// referrer = Option<address> = { vec: [] } = None
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const fn = poolType === 'stable'
    ? `${ATMOS}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${ATMOS}::liquidity_pool::simulate_swap_exact_in_weighted`;
  try {
    const res = await callView(fn, [], [
      poolAddress, tokenInAddr, tokenOutAddr,
      String(amountInRaw), JSON.stringify({ vec: [] }),
    ]);
    if (!res) return null;
    // SwapSimulate: { amount_in, amount_in_post_fee, amount_out, ... }
    if (res.amount_out !== undefined) return Number(res.amount_out) || null;
    if (Array.isArray(res)) {
      const arr = Array.isArray(res[0]) ? res[0] : res;
      return Number(arr[2]) || null; // índice 2 = amount_out
    }
  } catch (_) {}
  return null;
}

module.exports = { fetchAllPools, simulateSwap };
