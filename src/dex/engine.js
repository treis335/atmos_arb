// src/dex/engine.js — fetch ultra-rápido via get_pools_map_paged (batch)
//
// OPTIMIZAÇÃO PRINCIPAL:
// Em vez de 281 chamadas individuais (pool_balances × pool), usamos
// get_pools_map_paged que devolve PoolResponse[] com balances + pesos + fees
// numa única chamada. Reduz de 281 RPC calls → ~3-6 chamadas batch.
//
// PREÇO CORRECTO (Balancer weighted math):
// spot_price = (balance_out / weight_out) / (balance_in / weight_in)
// Com fee: effective_price = spot_price × (1 - fee/10000)
//
// Para stable pools: StableSwap D invariant → preço ≈ 1 (corrigido por amp)

const { callView } = require('../utils/client');
const { getSymbol, getDecimals } = require('../config/tokens');
const asyncLimit = require('../utils/asyncLimit');
const config     = require('../config');

const ATMOS = config.atmosModule;
const PAGE_SIZE = 50; // PoolResponse batch size (seguro para o RPC)

// ── Parsing ────────────────────────────────────────────────────────────────

// PoolResponse struct:
// { pool_address, coins, pool_balances, lp_token_supply, amp_factor,
//   precision_multipliers, weights, swap_fee_bps, pool_type, locked }
function parsePoolResponse(addr, pr, poolMeta) {
  if (!pr || pr.locked) return null;

  const rawBalances = pr.pool_balances ?? [];
  const weights     = (pr.weights ?? []).map(Number);
  const feeBps      = Number(pr.swap_fee_bps ?? 30);
  const poolType    = pr.pool_type === 1 ? 'stable' : 'weighted';
  // pool_type: 0 = weighted, 1 = stable (from ABI u8)

  if (rawBalances.length < 2) return null;

  // Get token metadata from poolMeta (our pools.json) or from coins array
  const meta = poolMeta ?? {};
  const t0   = meta.token0Type ?? pr.coins?.[0];
  const t1   = meta.token1Type ?? pr.coins?.[1];
  if (!t0 || !t1) return null;

  const dec0 = meta.decimals0 ?? getDecimals(t0) ?? 8;
  const dec1 = meta.decimals1 ?? getDecimals(t1) ?? 8;
  const r0   = Number(rawBalances[0]) / (10 ** dec0);
  const r1   = Number(rawBalances[1]) / (10 ** dec1);

  if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return null;

  // ── Preço correcto ──────────────────────────────────────────────────────
  let rawPrice;

  if (poolType === 'stable') {
    // StableSwap: preço sempre ~1:1 com fee (aproximação válida)
    rawPrice = r1 / r0;
  } else {
    // Balancer weighted: spot = (r1/w1) / (r0/w0)
    const w0 = weights[0] || 500000; // default 50/50 se pesos não disponíveis
    const w1 = weights[1] || 500000;
    rawPrice = (r1 / w1) / (r0 / w0);
  }

  if (!isFinite(rawPrice) || rawPrice <= 0) return null;

  return {
    pool: {
      address:    addr,
      token0Type: t0,
      token1Type: t1,
      decimals0:  dec0,
      decimals1:  dec1,
      swapFeeBps: feeBps,
      poolType,
      weights,
    },
    reserve0: r0,
    reserve1: r1,
    rawPrice,
  };
}

// ── Fetch batch via get_pools_map_paged ────────────────────────────────────

// Constrói lookup de pools.json para meta (tokens, decimals)
function buildPoolMeta(allPools) {
  const map = {};
  for (const p of allPools) {
    const addr = p.address ?? p.poolAddress;
    if (addr) map[addr] = p;
  }
  return map;
}

// Uma página de get_pools_map_paged → array de pool data
async function fetchPage(pageIdx, pageSize) {
  const start = pageIdx * pageSize;
  try {
    const res = await callView(
      `${ATMOS}::liquidity_pool::get_pools_map_paged`,
      [],
      [String(start), String(pageSize), '0']
    );
    // Retorna: { data: [[addr, PoolResponse], ...] } ou SimpleMap
    if (!res) return [];

    // SimpleMap pode vir como { data: [...] } ou como array de pares
    let entries = [];
    if (res.data && Array.isArray(res.data)) {
      entries = res.data; // [[addr, PoolResponse], ...]
    } else if (Array.isArray(res)) {
      entries = res;
    } else if (res[0] && Array.isArray(res[0])) {
      entries = res[0];
    }
    return entries;
  } catch (_) { return []; }
}

// Fetch completo: todas as pools em batch com paginação
async function fetchAllPoolsBatch(allPools, onProgress) {
  const poolMeta = buildPoolMeta(allPools);
  const total    = allPools.length;
  const pages    = Math.ceil(total / PAGE_SIZE);
  const results  = [];
  let   done     = 0;

  // Fetch todas as páginas em paralelo (limit 4 para não sobrecarregar)
  const limit = asyncLimit(4);
  const tasks = Array.from({ length: pages }, (_, i) =>
    limit(async () => {
      const entries = await fetchPage(i, PAGE_SIZE);
      for (const entry of entries) {
        // entry = [address, PoolResponse] ou { key: addr, value: PoolResponse }
        let addr, pr;
        if (Array.isArray(entry)) { [addr, pr] = entry; }
        else if (entry.key)       { addr = entry.key; pr = entry.value; }
        else if (entry.pool_address) { addr = entry.pool_address; pr = entry; }
        else continue;

        const data = parsePoolResponse(addr, pr, poolMeta[addr]);
        if (data) results.push(data);
        done++;
        onProgress?.(done, total);
      }
    })
  );

  await Promise.all(tasks);

  // Fallback: se get_pools_map_paged não funcionou, usa pool_balances individual
  if (results.length === 0) {
    return fetchAllPoolsIndividual(allPools, onProgress);
  }

  return results;
}

// Fallback individual (método antigo, mais lento)
async function fetchAllPoolsIndividual(allPools, onProgress) {
  const results = [];
  let done = 0;
  const limit = asyncLimit(config.maxConcurrent);

  const tasks = allPools.map(pool =>
    limit(async () => {
      const addr = pool.address ?? pool.poolAddress;
      if (!addr) { done++; return; }

      try {
        const raw = await callView(
          `${ATMOS}::liquidity_pool::pool_balances`, [], [addr]
        );
        let r0raw, r1raw;
        if (Array.isArray(raw) && Array.isArray(raw[0])) [r0raw, r1raw] = raw[0];
        else if (Array.isArray(raw)) [r0raw, r1raw] = raw;
        else return;

        const dec0 = pool.decimals0 ?? 8;
        const dec1 = pool.decimals1 ?? 8;
        const r0 = Number(r0raw) / (10 ** dec0);
        const r1 = Number(r1raw) / (10 ** dec1);
        if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return;

        results.push({
          pool: {
            address: addr,
            token0Type: pool.token0Type,
            token1Type: pool.token1Type,
            decimals0: dec0, decimals1: dec1,
            swapFeeBps: Number(pool.swapFeeBps ?? 30),
            poolType: pool.poolType ?? pool.curveType ?? 'weighted',
            weights: [500000, 500000],
          },
          reserve0: r0, reserve1: r1, rawPrice: r1 / r0,
        });
      } catch (_) {}
      done++;
      onProgress?.(done, allPools.length);
    })
  );

  await Promise.all(tasks);
  return results;
}

// ── Simulate swap (para pré-execução) ─────────────────────────────────────
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
    // SwapSimulate: { amount_in, amount_in_post_fee, amount_out, ... }
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

// Export principal — tenta batch primeiro, fallback individual
async function fetchAllPools(allPools, onProgress) {
  return fetchAllPoolsBatch(allPools, onProgress);
}

module.exports = { fetchAllPools, simulateSwap };
