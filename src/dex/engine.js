// src/dex/engine.js — fetch de reserves da Atmos DEX via HTTP directo
//
// IMPORTANTE: todos os tokens têm decimals=8 (confirmado empiricamente)
// Fee: swapFeeBps no pools.json (1, 5, 10, 30 ou 100 bps)
// pool_balances retorna [raw0, raw1] (já dividir por 10^8 para obter token units)
//
// NÃO usa simulate no ciclo de detecção — xy=k local é suficiente para detectar arb
// Simulate on-chain só chamado na execução real (optimalSize.js pré-trade)

const { callView }  = require('../utils/callView');
const { getSymbol } = require('../config/tokens');
const asyncLimit    = require('../utils/asyncLimit');
const config        = require('../config');

const ATMOS = config.atmosModule;
const DEC   = 8; // todos os tokens Atmos têm 8 decimais

// AMM xy=k: calcula amount_out com fee
// reserveIn, reserveOut e amountIn devem estar em unidades reais (já divididos por 10^DEC)
function getAmountOut(reserveIn, reserveOut, amountIn, feeBps) {
  if (reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0) return 0;
  const feeMult = 1 - feeBps / 10000;
  const aIn     = amountIn * feeMult;
  return (aIn * reserveOut) / (reserveIn + aIn);
}

// Fetch de reserves de UMA pool via HTTP directo
async function fetchPool(pool) {
  let raw;
  try {
    raw = await callView(`${ATMOS}::liquidity_pool::pool_balances`, [], [pool.address]);
  } catch (_) { return null; }

  // pool_balances retorna vector<u64> — SDK pode envolver como [[r0,r1]], [r0,r1], ou objecto
  let arr;
  if (Array.isArray(raw) && Array.isArray(raw[0]))    arr = raw[0];
  else if (Array.isArray(raw) && raw.length >= 2)     arr = raw;
  else if (raw && typeof raw === 'object')             arr = Object.values(raw);
  else return null;

  if (!arr || arr.length < 2) return null;

  const reserve0 = Number(arr[0]) / (10 ** DEC);
  const reserve1 = Number(arr[1]) / (10 ** DEC);

  // Filtrar pools vazias ou com liquidez insuficiente
  if (!Number.isFinite(reserve0) || !Number.isFinite(reserve1)) return null;
  if (reserve0 < config.minLiquidity || reserve1 < config.minLiquidity)  return null;

  const feeBps = Number(pool.swapFeeBps ?? 30);
  const symA   = getSymbol(pool.token0Type);
  const symB   = getSymbol(pool.token1Type);

  // priceAinB = quanto de token1 se recebe por 1 token0 (com fee)
  const priceAinB = getAmountOut(reserve0, reserve1, 1, feeBps);

  return {
    dex:      'ATMOS',
    tokenA:   symA,
    tokenB:   symB,
    addrA:    pool.token0Type,
    addrB:    pool.token1Type,
    decimalsA: DEC,
    decimalsB: DEC,
    curve:    pool.poolType,
    poolAddr: pool.address,
    poolType: pool.poolType,
    reserveA: reserve0,
    reserveB: reserve1,
    fee:      feeBps,
    feeScale: 10000,
    priceAinB,

    // Interface _simulate unificada (idêntica ao dexlyn_arb_original)
    // direction 'AB' = token0→token1, 'BA' = token1→token0
    _simulate(direction, amountIn) {
      if (amountIn <= 0) return 0;
      const rIn  = direction === 'AB' ? reserve0 : reserve1;
      const rOut = direction === 'AB' ? reserve1 : reserve0;
      return getAmountOut(rIn, rOut, amountIn, feeBps);
    },
  };
}

// Fetch de todas as pools em paralelo
async function fetchAllPools(pools, onProgress) {
  const results = [];
  let done = 0;
  const limit = asyncLimit(config.maxConcurrent);
  const tasks  = pools.map(pool => limit(async () => {
    const data = await fetchPool(pool).catch(() => null);
    if (data) results.push(data);
    done++;
    onProgress?.(done, pools.length);
  }));
  await Promise.all(tasks);
  return results;
}

// simulate on-chain para pre-execução (optimalSize real)
async function simulateSwapOnChain(poolAddress, tokenInAddr, tokenOutAddr, amountInRaw, poolType) {
  const fn = poolType === 'stable'
    ? `${ATMOS}::liquidity_pool::simulate_swap_exact_in_stable`
    : `${ATMOS}::liquidity_pool::simulate_swap_exact_in_weighted`;
  try {
    const res = await callView(fn, [], [
      poolAddress, tokenInAddr, tokenOutAddr, String(amountInRaw), { vec: [] }
    ]);
    if (!res) return null;
    if (typeof res === 'object' && !Array.isArray(res)) {
      const v = Number(res.amount_out ?? 0);
      return v > 0 ? v : null;
    }
    const arr = Array.isArray(res[0]) ? res[0] : res;
    const v   = Number(arr[2] ?? 0); // [0]=amount_in, [1]=amount_in_post_fee, [2]=amount_out
    return v > 0 ? v : null;
  } catch (_) { return null; }
}

module.exports = { fetchAllPools, fetchPool, simulateSwapOnChain, getAmountOut };
