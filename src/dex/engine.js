// src/dex/engine.js — fetch via get_pools_map (1 call) ou get_pool_by_address (batch)
//
// ESTRATÉGIA (por ordem de preferência):
// 1. get_pools_map() — 0 args, devolve TODAS as pools com PoolResponse num único call
//    Inclui: pool_balances, weights, swap_fee_bps, pool_type, coins
//    Preço Balancer correcto: (r1/w1)/(r0/w0)
//
// 2. get_pool_by_address(addr) × N — 1 call por pool, paralelo com concorrência
//    Mesmo PoolResponse mas individual. Melhor que pool_balances (tem pesos).
//
// 3. Fallback pool_balances individual (sem pesos — usa 50/50)

const { callView }  = require('../utils/client');
const { getDecimals } = require('../config/tokens');
const asyncLimit    = require('../utils/asyncLimit');
const config        = require('../config');
const fs            = require('fs');

const ATMOS = config.atmosModule;
let _batchDebugDone = false;

// ── Balancer weighted spot price ──────────────────────────────────────────
// spot = (r1/w1) / (r0/w0)
function weightedSpot(r0, r1, w0, w1) {
  const a = w0 || 500000;
  const b = w1 || 500000;
  return (r1 / b) / (r0 / a);
}

// ── Parser de PoolResponse ────────────────────────────────────────────────
// PoolResponse: { pool_address, coins, pool_balances, weights, swap_fee_bps, pool_type, locked }
function parsePoolResponse(addr, pr, poolMeta) {
  if (!pr || pr.locked === true) return null;

  const rawBals  = pr.pool_balances ?? [];
  const weights  = (pr.weights ?? []).map(Number);
  const feeBps   = Number(pr.swap_fee_bps ?? 30);
  const poolType = (Number(pr.pool_type) === 1) ? 'stable' : 'weighted';

  if (rawBals.length < 2) return null;

  // Token types: do poolMeta (pools.json) ou dos coins do PoolResponse
  const meta = poolMeta ?? {};
  const coins = pr.coins ?? [];
  const t0 = meta.token0Type ?? meta.token0 ?? String(coins[0] ?? '');
  const t1 = meta.token1Type ?? meta.token1 ?? String(coins[1] ?? '');
  if (!t0 || !t1 || t0 === 'undefined') return null;

  const dec0 = meta.decimals0 ?? getDecimals(t0) ?? 8;
  const dec1 = meta.decimals1 ?? getDecimals(t1) ?? 8;
  const r0   = Number(rawBals[0]) / (10 ** dec0);
  const r1   = Number(rawBals[1]) / (10 ** dec1);

  if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return null;

  const w0 = weights[0] || 500000;
  const w1 = weights[1] || 500000;
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
    const addr = p.address ?? p.poolAddress;
    if (addr) map[addr] = p;
  }
  return map;
}

// ── Modo 1: get_pools_map — 1 única chamada ────────────────────────────────
async function fetchViaPoolsMap(allPools) {
  const poolMeta = buildPoolMeta(allPools);
  try {
    const res = await callView(`${ATMOS}::liquidity_pool::get_pools_map`, [], []);
    if (!res) return null;

    // Debug na primeira vez
    if (!_batchDebugDone) {
      _batchDebugDone = true;
      const sample = Array.isArray(res) ? res.slice(0,1) : Object.entries(res).slice(0,1);
      fs.appendFileSync('debug_batch.json',
        JSON.stringify({ mode: 'get_pools_map', type: typeof res, isArray: Array.isArray(res), sample }, null, 2) + '\n---\n'
      );
    }

    // SimpleMap retorna como { data: [[key, val], ...] } ou array de pares
    let entries = [];
    if (res.data && Array.isArray(res.data))      entries = res.data;
    else if (Array.isArray(res))                   entries = res;
    else {
      // Objecto chave→valor directamente
      for (const [k, v] of Object.entries(res)) {
        if (k === 'data') continue;
        entries.push([k, v]);
      }
    }

    if (entries.length === 0) return null;

    const results = [];
    for (const entry of entries) {
      let addr, pr;
      if (Array.isArray(entry))   { [addr, pr] = entry; }
      else if (entry?.key)        { addr = entry.key;  pr = entry.value; }
      else if (entry?.pool_address){ addr = entry.pool_address; pr = entry; }
      else continue;

      if (!addr || typeof addr !== 'string') continue;
      const data = parsePoolResponse(addr, pr, poolMeta[addr]);
      if (data) results.push(data);
    }

    return results.length >= allPools.length * 0.3 ? results : null;
  } catch (e) {
    if (!_batchDebugDone) {
      _batchDebugDone = true;
      fs.appendFileSync('debug_batch.json',
        JSON.stringify({ mode: 'get_pools_map', error: e.message }) + '\n---\n'
      );
    }
    return null;
  }
}

// ── Modo 2: get_pool_by_address batch paralelo ────────────────────────────
async function fetchViaPoolByAddress(allPools, onProgress) {
  const poolMeta = buildPoolMeta(allPools);
  const results  = [];
  let   done     = 0;
  const limit    = asyncLimit(Math.min(config.maxConcurrent, 25));

  const tasks = allPools.map(pool =>
    limit(async () => {
      const addr = pool.address ?? pool.poolAddress;
      if (!addr) { onProgress?.(++done, allPools.length); return; }
      try {
        const res = await callView(
          `${ATMOS}::liquidity_pool::get_pool_by_address`, [], [addr]
        );
        // get_pool_by_address retorna Option<PoolResponse>
        // Option vem como { vec: [PoolResponse] } ou null/[]
        let pr = null;
        if (res?.vec && Array.isArray(res.vec) && res.vec.length > 0) pr = res.vec[0];
        else if (Array.isArray(res) && res.length > 0) pr = res[0];
        else if (res && typeof res === 'object' && !Array.isArray(res) && res.pool_balances) pr = res;

        if (pr) {
          const data = parsePoolResponse(addr, pr, poolMeta[addr]);
          if (data) results.push(data);
        }
      } catch (_) {}
      onProgress?.(++done, allPools.length);
    })
  );

  await Promise.all(tasks);
  return results;
}

// ── Modo 3: fallback pool_balances (sem pesos) ────────────────────────────
async function fetchViaBalancesOnly(allPools, onProgress) {
  const results = [];
  let   done    = 0;
  const limit   = asyncLimit(Math.min(config.maxConcurrent, 25));

  const tasks = allPools.map(pool =>
    limit(async () => {
      const addr = pool.address ?? pool.poolAddress;
      if (!addr) { onProgress?.(++done, allPools.length); return; }
      try {
        const raw = await callView(`${ATMOS}::liquidity_pool::pool_balances`, [], [addr]);
        let r0raw, r1raw;
        if (Array.isArray(raw) && Array.isArray(raw[0])) [r0raw, r1raw] = raw[0];
        else if (Array.isArray(raw) && raw.length >= 2)   [r0raw, r1raw] = raw;
        else return;

        const dec0 = pool.decimals0 ?? 8;
        const dec1 = pool.decimals1 ?? 8;
        const r0 = Number(r0raw) / (10 ** dec0);
        const r1 = Number(r1raw) / (10 ** dec1);
        if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return;

        results.push({
          pool: {
            address: addr,
            token0Type: pool.token0Type, token1Type: pool.token1Type,
            decimals0: dec0, decimals1: dec1,
            swapFeeBps: Number(pool.swapFeeBps ?? 30),
            poolType: pool.poolType ?? pool.curveType ?? 'weighted',
            weights: [500000, 500000],
          },
          reserve0: r0, reserve1: r1, rawPrice: r1 / r0,
        });
      } catch (_) {}
      onProgress?.(++done, allPools.length);
    })
  );

  await Promise.all(tasks);
  return results;
}

// ── Entry point ────────────────────────────────────────────────────────────
async function fetchAllPools(allPools, onProgress) {
  // 1. Tenta get_pools_map (1 call, mais rápido)
  const mapResults = await fetchViaPoolsMap(allPools);
  if (mapResults && mapResults.length > 0) {
    onProgress?.(allPools.length, allPools.length);
    return mapResults;
  }

  // 2. Tenta get_pool_by_address batch (1 call/pool com pesos)
  const byAddrResults = await fetchViaPoolByAddress(allPools, onProgress);
  if (byAddrResults.length >= allPools.length * 0.3) return byAddrResults;

  // 3. Fallback pool_balances (sem pesos, mais rápido)
  return fetchViaBalancesOnly(allPools, onProgress);
}

// ── Simulate swap (pré-execução) ──────────────────────────────────────────
async function simulateSwap(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const fn = poolType === 'stable'
    ? `${ATMOS}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${ATMOS}::liquidity_pool::simulate_swap_exact_in_weighted`;
  try {
    const res = await callView(fn, [], [
      poolAddress, tokenInAddr, tokenOutAddr,
      String(amountInRaw), JSON.stringify({ vec: [] })
    ]);
    if (!res) return null;
    if (typeof res === 'object' && !Array.isArray(res)) {
      const v = Number(res.amount_out ?? 0);
      return v > 0 ? v : null;
    }
    if (Array.isArray(res)) {
      const arr = Array.isArray(res[0]) ? res[0] : res;
      const v = Number(arr[2] ?? 0);
      return v > 0 ? v : null;
    }
  } catch (_) { return null; }
}

module.exports = { fetchAllPools, simulateSwap };
