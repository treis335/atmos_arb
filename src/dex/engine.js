// src/dex/engine.js — fetch com batch + fallback individual robusto
//
// Estratégia:
// 1. Tenta get_pools_map_paged (batch) — pode reduzir de 281 calls → ~6
//    Se funcionar: preços Balancer correctos com pesos
// 2. Fallback: pool_balances individual com get_pool_details para pesos
//    (pool_details = 1 call extra mas dá pesos reais)
// 3. Fallback rápido: pool_balances só (sem pesos, usa 50/50)

const { callView, callViewBatch } = require('../utils/client');
const { getSymbol, getDecimals }  = require('../config/tokens');
const asyncLimit = require('../utils/asyncLimit');
const config     = require('../config');
const fs         = require('fs');

const ATMOS = config.atmosModule;

// ── Balancer weighted spot price ───────────────────────────────────────────
// spot = (r1/w1) / (r0/w0)  →  com fee: × (1 - fee/10000)
function weightedPrice(r0, r1, w0, w1) {
  const wt0 = w0 || 500000;
  const wt1 = w1 || 500000;
  return (r1 / wt1) / (r0 / wt0);
}

// ── Parser genérico para PoolResponse ─────────────────────────────────────
function parsePoolResponse(addr, pr, poolMeta) {
  if (!pr || pr.locked) return null;

  const rawBals = pr.pool_balances ?? pr.balances ?? [];
  const weights = (pr.weights ?? []).map(Number);
  const feeBps  = Number(pr.swap_fee_bps ?? pr.swap_fee ?? 30);
  // pool_type: 0=weighted, 1=stable
  const poolType = (pr.pool_type === 1 || pr.pool_type === '1') ? 'stable' : 'weighted';

  if (!rawBals.length || rawBals.length < 2) return null;

  const meta = poolMeta ?? {};
  const t0   = meta.token0Type ?? meta.token0 ?? (pr.coins?.[0]);
  const t1   = meta.token1Type ?? meta.token1 ?? (pr.coins?.[1]);
  if (!t0 || !t1) return null;

  const dec0 = meta.decimals0 ?? getDecimals(t0) ?? 8;
  const dec1 = meta.decimals1 ?? getDecimals(t1) ?? 8;
  const r0   = Number(rawBals[0]) / (10 ** dec0);
  const r1   = Number(rawBals[1]) / (10 ** dec1);

  if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return null;

  const w0 = weights[0] || 500000;
  const w1 = weights[1] || 500000;
  const rawPrice = poolType === 'stable' ? r1 / r0 : weightedPrice(r0, r1, w0, w1);

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

// ── Lookup de meta das pools locais ───────────────────────────────────────
function buildPoolMeta(allPools) {
  const map = {};
  for (const p of allPools) {
    const addr = p.address ?? p.poolAddress;
    if (addr) map[addr] = p;
  }
  return map;
}

// ── Modo 1: get_pools_map_paged batch ─────────────────────────────────────
async function fetchBatch(allPools, onProgress) {
  const poolMeta  = buildPoolMeta(allPools);
  const total     = allPools.length;
  const PAGE_SIZE = 50;
  const pages     = Math.ceil(total / PAGE_SIZE);
  const results   = [];
  let   done      = 0;

  const limit = asyncLimit(4);
  const tasks = Array.from({ length: pages }, (_, i) =>
    limit(async () => {
      const start = i * PAGE_SIZE;
      let entries = [];
      try {
        const res = await callView(
          `${ATMOS}::liquidity_pool::get_pools_map_paged`, [],
          [String(start), String(PAGE_SIZE), '0']
        );

        // SimpleMap vem como { data: [[key, value], ...] }
        // ou como array de pares, ou como objecto com keys
        if (!res) return;

        if (res.data && Array.isArray(res.data))   entries = res.data;
        else if (Array.isArray(res))               entries = res;
        else if (res[0] && Array.isArray(res[0]))  entries = res[0];
        else {
          // Pode ser objecto { key: addr, value: PoolResponse }
          // ou { "0xa4...": PoolResponse, ... }
          for (const [k, v] of Object.entries(res)) {
            if (k === 'data' || k === 'next_cursor') continue;
            entries.push([k, v]);
          }
        }

        // Log format na primeira página (debug único)
        if (i === 0 && entries.length > 0) {
          const sample = entries[0];
          fs.appendFileSync('debug_batch.json',
            JSON.stringify({ page: 0, count: entries.length, sample }, null, 2) + '\n---\n'
          );
        }
      } catch (e) {
        if (i === 0) fs.appendFileSync('debug_batch.json',
          JSON.stringify({ error: e.message, page: 0 }, null, 2) + '\n---\n'
        );
        return;
      }

      for (const entry of entries) {
        let addr, pr;
        if (Array.isArray(entry) && entry.length >= 2) { [addr, pr] = entry; }
        else if (entry?.key)         { addr = entry.key;         pr = entry.value; }
        else if (entry?.pool_address){ addr = entry.pool_address; pr = entry; }
        else continue;

        if (!addr || typeof addr !== 'string') continue;
        const data = parsePoolResponse(addr, pr, poolMeta[addr]);
        if (data) results.push(data);
        done++;
        onProgress?.(done, total);
      }
    })
  );

  await Promise.all(tasks);
  return results;
}

// ── Modo 2: individual pool_balances + pool_weights em paralelo ───────────
// Dois calls por pool (balances + details) mas com concorrência alta
async function fetchIndividual(allPools, onProgress) {
  const results   = [];
  let   done      = 0;
  const CONC      = Math.min(config.maxConcurrent, 30);
  const limit     = asyncLimit(CONC);

  const tasks = allPools.map(pool =>
    limit(async () => {
      const addr = pool.address ?? pool.poolAddress;
      if (!addr) { done++; onProgress?.(++done, allPools.length); return; }

      try {
        // Busca balances E detalhes em paralelo (2 calls por pool mas simultâneos)
        const [rawBal, rawDet] = await Promise.all([
          callView(`${ATMOS}::liquidity_pool::pool_balances`, [], [addr]).catch(() => null),
          callView(`${ATMOS}::liquidity_pool::get_pool_details`, [], [addr]).catch(() => null),
        ]);

        // Parse balances
        let r0raw, r1raw;
        if (Array.isArray(rawBal) && Array.isArray(rawBal[0])) [r0raw, r1raw] = rawBal[0];
        else if (Array.isArray(rawBal) && rawBal.length >= 2)   [r0raw, r1raw] = rawBal;
        else return;

        // Parse detalhes (pesos, tipo)
        // PoolDetailsRes: { pool_type, assets_metadata, weights, amp_factor, swap_fee_bps, locked }
        const weights  = rawDet?.weights  ? rawDet.weights.map(Number)  : [500000, 500000];
        const feeBps   = rawDet?.swap_fee_bps ? Number(rawDet.swap_fee_bps) : Number(pool.swapFeeBps ?? 30);
        const poolType = rawDet?.pool_type === 1 ? 'stable' : (pool.poolType ?? pool.curveType ?? 'weighted');

        const dec0 = pool.decimals0 ?? getDecimals(pool.token0Type) ?? 8;
        const dec1 = pool.decimals1 ?? getDecimals(pool.token1Type) ?? 8;
        const r0   = Number(r0raw) / (10 ** dec0);
        const r1   = Number(r1raw) / (10 ** dec1);

        if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return;

        const w0 = weights[0] || 500000;
        const w1 = weights[1] || 500000;
        const rawPrice = poolType === 'stable' ? r1 / r0 : weightedPrice(r0, r1, w0, w1);
        if (!isFinite(rawPrice) || rawPrice <= 0) return;

        results.push({
          pool: {
            address: addr,
            token0Type: pool.token0Type, token1Type: pool.token1Type,
            decimals0: dec0, decimals1: dec1,
            swapFeeBps: feeBps, poolType, weights: [w0, w1],
          },
          reserve0: r0, reserve1: r1, rawPrice,
        });
      } catch (_) {}

      done++;
      onProgress?.(done, allPools.length);
    })
  );

  await Promise.all(tasks);
  return results;
}

// ── Entry point principal ──────────────────────────────────────────────────
async function fetchAllPools(allPools, onProgress) {
  // Tenta batch primeiro
  const batchResults = await fetchBatch(allPools, onProgress);

  // Se batch devolveu pelo menos 50% das pools, usa esses resultados
  if (batchResults.length >= allPools.length * 0.5) {
    return batchResults;
  }

  // Fallback: individual com pesos reais
  return fetchIndividual(allPools, onProgress);
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
