// src/dex/engine.js
//
// PREÇO CORRECTO — Balancer Weighted Math:
//   spot_price(A→B) = (reserveB / weightB) / (reserveA / weightA)
//   effective = spot × (1 - feeBps/10000)
//
// Os pesos vêm de PoolResponse.weights[] via get_pool_by_address()
// Sem pesos reais, xy=k (50/50) dá preços completamente errados.
//
// Para stable pools (StableSwap): xy=k é uma aproximação razoável.
//
// AMM output com pesos Balancer (fórmula exacta para swap):
//   amountOut = reserveOut × (1 - (reserveIn/(reserveIn + amountIn×(1-fee)))^(wIn/wOut))

const { callView }  = require('../utils/callView');
const { getSymbol, getDecimals } = require('../config/tokens');
const asyncLimit    = require('../utils/asyncLimit');
const config        = require('../config');

const ATMOS = config.atmosModule;

// ── Balancer weighted AMM output ──────────────────────────────────────────
// Fórmula exacta: amtOut = Bout × (1 - (Bin/(Bin + Ain*(1-fee)))^(Win/Wout))
function weightedAmountOut(reserveIn, reserveOut, amountIn, feeBps, weightIn, weightOut) {
  if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0;
  const fee       = feeBps / 10000;
  const amtInFee  = amountIn * (1 - fee);
  const ratio     = reserveIn / (reserveIn + amtInFee);
  const exponent  = weightIn / weightOut;
  const out       = reserveOut * (1 - Math.pow(ratio, exponent));
  return out > 0 ? out : 0;
}

// xy=k para stable pools (aproximação razoável)
function stableAmountOut(reserveIn, reserveOut, amountIn, feeBps) {
  if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0;
  const amtInFee = amountIn * (1 - feeBps / 10000);
  return (amtInFee * reserveOut) / (reserveIn + amtInFee);
}

// ── Fetch de UMA pool com pesos reais ─────────────────────────────────────
// get_pool_by_address(address) → Option<PoolResponse>
// PoolResponse: { pool_balances, weights, swap_fee_bps, pool_type, locked, coins }
async function fetchPool(pool) {
  const addr = pool.address ?? pool.poolAddress;
  if (!addr) return null;

  let pr = null;
  try {
    const res = await callView(`${ATMOS}::liquidity_pool::get_pool_by_address`, [], [addr]);
    // Option<PoolResponse>: { vec: [pr] } ou null
    if (res?.vec?.length > 0)                                       pr = res.vec[0];
    else if (Array.isArray(res) && res.length > 0)                  pr = res[0];
    else if (res?.pool_balances !== undefined)                       pr = res;
    else if (res && typeof res === 'object' && !Array.isArray(res)) pr = res;
  } catch (_) { return null; }

  if (!pr || pr.locked === true) return null;

  const rawBals = pr.pool_balances ?? [];
  if (rawBals.length < 2) return null;

  // Pesos: confirmados em PoolResponse.weights[] — somam 1_000_000
  const rawWeights = (pr.weights ?? []).map(Number);
  const w0 = rawWeights[0] || 500000;
  const w1 = rawWeights[1] || 500000;

  // pool_type: 0=weighted, 1=stable
  const poolType = Number(pr.pool_type) === 1 ? 'stable' : 'weighted';

  // Decimais do pools.json (já confirmados)
  const dec0 = pool.decimals0 ?? 8;
  const dec1 = pool.decimals1 ?? 8;
  const r0   = Number(rawBals[0]) / (10 ** dec0);
  const r1   = Number(rawBals[1]) / (10 ** dec1);

  if (!r0 || !r1 || r0 < config.minLiquidity || r1 < config.minLiquidity) return null;

  const feeBps = Number(pr.swap_fee_bps ?? pool.swapFeeBps ?? 30);

  // Preço spot A→B correcto
  let priceAinB;
  if (poolType === 'stable') {
    priceAinB = stableAmountOut(r0, r1, 1, feeBps);
  } else {
    // Balancer: spot = (r1/w1) / (r0/w0)
    priceAinB = ((r1 / w1) / (r0 / w0)) * (1 - feeBps / 10000);
  }

  if (!isFinite(priceAinB) || priceAinB <= 0) return null;

  const t0 = pool.token0Type;
  const t1 = pool.token1Type;

  return {
    dex:      'ATMOS',
    tokenA:   getSymbol(t0),
    tokenB:   getSymbol(t1),
    addrA:    t0,
    addrB:    t1,
    decimalsA: dec0,
    decimalsB: dec1,
    curve:    poolType,
    poolAddr: addr,
    poolType,
    reserveA: r0,
    reserveB: r1,
    weightA:  w0,
    weightB:  w1,
    fee:      feeBps,
    feeScale: 10000,
    priceAinB,

    // _simulate com Balancer math correcta
    _simulate(direction, amountIn) {
      if (amountIn <= 0) return 0;
      if (direction === 'AB') {
        return poolType === 'stable'
          ? stableAmountOut(r0, r1, amountIn, feeBps)
          : weightedAmountOut(r0, r1, amountIn, feeBps, w0, w1);
      } else {
        return poolType === 'stable'
          ? stableAmountOut(r1, r0, amountIn, feeBps)
          : weightedAmountOut(r1, r0, amountIn, feeBps, w1, w0);
      }
    },
  };
}

// ── Fetch de todas as pools ───────────────────────────────────────────────
async function fetchAllPools(pools, onProgress) {
  const results = [];
  let done = 0;
  const limit = asyncLimit(config.maxConcurrent);

  await Promise.all(pools.map(pool => limit(async () => {
    const data = await fetchPool(pool).catch(() => null);
    if (data) results.push(data);
    done++;
    onProgress?.(done, pools.length);
  })));

  return results;
}

module.exports = { fetchAllPools, fetchPool, weightedAmountOut, stableAmountOut };
