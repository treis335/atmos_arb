// src/dex/executor.js — executa swaps na Atmos DEX
//
// Entry function confirmada via atmos_entry-ABI.json:
//   swap_exact_in_weighted_entry(&signer, pool, token_in, amount_in, token_out, min_amount_out)
//   swap_exact_in_stable_entry  (&signer, pool, token_in, amount_in, token_out, min_amount_out)
//
// Todos os Object<X> são serialized como AccountAddress (32 bytes big-endian)
// amount_in e min_amount_out são u64

require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS } = require('supra-l1-sdk');
const { logError } = require('../utils/logger');
const config = require('../config');

const ATMOS = config.atmosModule;

// ── Singleton client + account ─────────────────────────────────────────────
let _client  = null;
let _account = null;
let _sender  = null;

async function getClient() {
  if (!_client) {
    const origLog = console.log; console.log = () => {};
    _client = await SupraClient.init(config.rpc);
    console.log = origLog;
  }
  return _client;
}

function getWallet() {
  if (!process.env.PRIVATE_KEY)    throw new Error('PRIVATE_KEY não definido no .env');
  if (!process.env.SENDER_ADDRESS) throw new Error('SENDER_ADDRESS não definido no .env');
  if (_account) return { account: _account, sender: _sender };
  const pk = process.env.PRIVATE_KEY.startsWith('0x')
    ? process.env.PRIVATE_KEY : '0x' + process.env.PRIVATE_KEY;
  _account = new SupraAccount(HexString.ensure(pk).toUint8Array());
  _sender  = process.env.SENDER_ADDRESS;
  return { account: _account, sender: _sender };
}

// ── BCS helpers ────────────────────────────────────────────────────────────
function serAddr(addr) {
  // Object<X> no Move = AccountAddress = 32 bytes big-endian
  const hex = (addr.startsWith('0x') ? addr.slice(2) : addr).padStart(64, '0');
  const s = new BCS.Serializer();
  s.serializeFixedBytes(Buffer.from(hex, 'hex'));
  return s.getBytes();
}

function serU64(v) {
  const s = new BCS.Serializer();
  s.serializeU64(BigInt(Math.floor(Number(v))));
  return s.getBytes();
}

// ── Executa um único swap ──────────────────────────────────────────────────
// poolAddr  : endereço da pool (Object<Pool>)
// tokenIn   : endereço FA do token de entrada (Object<Metadata>)
// amountIn  : BigInt raw units
// tokenOut  : endereço FA do token de saída (Object<Metadata>)
// minAmountOut: BigInt raw units (slippage protection)
// poolType  : 'weighted' | 'stable'
// seqNum    : sequence number da conta

async function executeOneSwap({ poolAddr, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum }) {
  const client = await getClient();
  const { account, sender } = getWallet();

  const fn = (poolType === 'stable')
    ? 'swap_exact_in_stable_entry'
    : 'swap_exact_in_weighted_entry';

  const origLog = console.log; console.log = () => {};
  try {
    const rawTx = await client.createRawTxObject(
      new HexString(sender),
      BigInt(seqNum),
      ATMOS,           // module address
      'atmos_entry',   // module name
      fn,              // function name
      [],              // type args (FA tokens não precisam)
      [
        serAddr(poolAddr),      // pool: Object<Pool>
        serAddr(tokenIn),       // token_in: Object<Metadata>
        serU64(amountIn),       // amount_in: u64
        serAddr(tokenOut),      // token_out: Object<Metadata>
        serU64(minAmountOut),   // min_amount_out: u64
      ],
      {
        maxGasAmount:   BigInt(config.autoExecute?.maxGasAmount  ?? 15000),
        gasUnitPrice:   BigInt(config.autoExecute?.gasUnitPrice  ?? 100),
        expirationTime: Math.floor(Date.now() / 1000) + 300,
      }
    );

    const ser = new BCS.Serializer();
    rawTx.serialize(ser);

    return await client.sendTxUsingSerializedRawTransaction(
      account,
      ser.getBytes(),
      { enableWaitForTransaction: true, enableTransactionSimulation: true }
    );
  } finally {
    console.log = origLog;
  }
}

// ── Executa uma oportunidade completa (N hops sequenciais) ─────────────────
// opportunity.steps: array de { from, to, amtIn, amtOut, pair }
//   pair.poolAddr  : endereço da pool
//   pair.curve     : 'weighted' | 'stable'
//   pair.addrA     : endereço FA do tokenA
//   pair.addrB     : endereço FA do tokenB
// optimalAmountIn : SUPRA (float, ex: 10.5)
// slippage        : fracção (ex: 0.005 = 0.5%)

async function executeArbitrage(opportunity, onLog = () => {}) {
  const { steps } = opportunity.result;
  const optimalAmountIn = opportunity.optimalAmount;
  const slippage = config.autoExecute?.slippageTolerance ?? 0.005;
  const { getDecimals } = require('../config/tokens');

  const txHashes = [];

  try {
    onLog('{grey-fg}A obter sequence number...{/}');
    const client = await getClient();
    const { sender } = getWallet();
    const accInfo = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(accInfo.sequence_number);

    for (let i = 0; i < steps.length; i++) {
      const step    = steps[i];
      const ps      = step.pair;
      const poolType = ps.curve || ps.poolType || 'weighted';

      // Endereços FA dos tokens deste hop
      const addrIn  = step.from; // já é o endereço FA (graph usa addrA/addrB)
      const addrOut = step.to;

      const decIn  = getDecimals(addrIn);
      const decOut = getDecimals(addrOut);

      // Amount in: primeiro hop usa optimalAmountIn, seguintes usam amtOut do passo anterior
      const amtInFloat  = i === 0 ? optimalAmountIn : steps[i - 1].amtOut;
      const amtInRaw    = BigInt(Math.floor(amtInFloat * (10 ** decIn)));

      // min_amount_out com slippage
      const amtOutFloat = step.amtOut;
      const minOutRaw   = BigInt(Math.floor(amtOutFloat * (10 ** decOut) * (1 - slippage)));

      if (amtInRaw <= 0n) {
        onLog(`{red-fg}❌ Hop ${i+1}: amountIn = 0 — a abortar.{/}`);
        return { success: false, txHashes, partial: txHashes.length > 0 };
      }

      const fromSym = step.from.includes('::') ? step.from.split('::').pop() : step.from.slice(0,8);
      const toSym   = step.to.includes('::')   ? step.to.split('::').pop()   : step.to.slice(0,8);
      onLog(`{grey-fg}Hop ${i+1}/${steps.length}: {cyan-fg}${fromSym}{/}→{cyan-fg}${toSym}{/} [${poolType}] ${amtInFloat.toFixed(4)} → ~${amtOutFloat.toFixed(4)}{/}`);

      let txResult;
      try {
        txResult = await executeOneSwap({
          poolAddr:     ps.poolAddr,
          tokenIn:      addrIn,
          amountIn:     amtInRaw,
          tokenOut:     addrOut,
          minAmountOut: minOutRaw,
          poolType,
          seqNum,
        });
      } catch (e) {
        logError(`executeOneSwap hop ${i+1}`, e);
        onLog(`{red-fg}❌ Hop ${i+1} falhou: ${e.message.slice(0, 80)}{/}`);
        return { success: false, txHashes, partial: txHashes.length > 0 };
      }

      if (!txResult?.txHash) {
        onLog(`{red-fg}❌ Hop ${i+1}: sem txHash — a abortar.{/}`);
        return { success: false, txHashes, partial: txHashes.length > 0 };
      }

      txHashes.push(txResult.txHash);
      onLog(`{green-fg}✅ Hop ${i+1}: ${txResult.txHash.slice(0, 20)}...{/}`);
      seqNum++;
    }

    onLog(`{green-fg}✅ Arbitragem completa! ${txHashes.length} hops executados.{/}`);
    return { success: true, txHashes, txHash: txHashes[0] };

  } catch (e) {
    logError('executeArbitrage', e);
    onLog(`{red-fg}❌ Erro fatal: ${e.message}{/}`);
    return { success: false, txHashes, partial: txHashes.length > 0 };
  }
}

// ── Saldo SUPRA ────────────────────────────────────────────────────────────
async function fetchWalletBalance() {
  try {
    const { sender } = getWallet();
    const client = await getClient();
    const raw = await client.getAccountSupraCoinBalance(new HexString(sender));
    return { SUPRA: Number(raw) / 1e8 };
  } catch (_) { return { SUPRA: 0 }; }
}

module.exports = { executeArbitrage, executeOneSwap, fetchWalletBalance };
