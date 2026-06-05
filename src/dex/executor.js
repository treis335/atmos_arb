// src/dex/executor.js — executa swaps na Atmos DEX (atmos_entry_coin)
//
// Usa atmos_entry_coin (coin-based) em vez de atmos_entry (FA-based)
// porque a maioria dos tokens ainda são Coin<T> no Supra.
// O modulo atmos_entry_coin expõe:
//   swap_exact_in_weighted(&signer, pool, token_in_meta, amount_in, token_out_meta, min_out)
//   swap_exact_in_stable   (&signer, pool, token_in_meta, amount_in, token_out_meta, min_out)
//
// Object<Pool> e Object<Metadata> são serialized como AccountAddress (32 bytes)
// SUPRA nativa: usa SupraCoin wrapper

require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS, TxnBuilderTypes } = require('supra-l1-sdk');
const { getClient } = require('../utils/client');
const { logError }  = require('../utils/logger');
const config        = require('../config');

const ATMOS = config.atmosModule;
let _account = null;
let _sender  = null;

function getWallet() {
  if (!process.env.PRIVATE_KEY)    throw new Error('PRIVATE_KEY não definido no .env');
  if (!process.env.SENDER_ADDRESS) throw new Error('SENDER_ADDRESS não definido no .env');
  if (_account) return { account: _account, sender: _sender };
  const pk = process.env.PRIVATE_KEY.replace(/^0x/, '');
  _account = new SupraAccount(Buffer.from(pk, 'hex'));
  _sender  = process.env.SENDER_ADDRESS;
  return { account: _account, sender: _sender };
}

// BCS serializers
function addrBytes(hex) {
  const clean = hex.replace(/^0x/, '').padStart(64, '0');
  return Buffer.from(clean, 'hex');
}

function serializeCallArgs(poolAddr, tokenInAddr, amountIn, tokenOutAddr, minOut) {
  // Cada Object<X> é serializado como AccountAddress (32 bytes fixos)
  const args = [];

  const serAddr = (addr) => {
    const s = new BCS.Serializer();
    s.serializeFixedBytes(addrBytes(addr));
    return s.getBytes();
  };
  const serU64 = (v) => {
    const s = new BCS.Serializer();
    s.serializeU64(BigInt(v));
    return s.getBytes();
  };

  return [
    serAddr(poolAddr),     // Object<Pool>
    serAddr(tokenInAddr),  // Object<Metadata> token_in
    serU64(amountIn),      // u64 amount_in
    serAddr(tokenOutAddr), // Object<Metadata> token_out
    serU64(minOut),        // u64 min_amount_out
  ];
}

async function executeSwap({ poolAddress, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum }) {
  const client = await getClient();
  const { account, sender } = getWallet();
  const fn = poolType === 'stable' ? 'swap_exact_in_stable' : 'swap_exact_in_weighted';

  const origLog = console.log; console.log = () => {};
  try {
    const rawTx = await client.createRawTxObject(
      new HexString(sender),
      BigInt(seqNum),
      ATMOS,
      'atmos_entry_coin',
      fn,
      [], // typeArgs vazio — FA-based não usa generics
      serializeCallArgs(poolAddress, tokenIn, amountIn, tokenOut, minAmountOut),
      {
        maxGasAmount:   BigInt(config.execution?.maxGasAmount ?? 20000),
        gasUnitPrice:   BigInt(config.execution?.gasUnitPrice ?? 100),
        expirationTime: Math.floor(Date.now() / 1000) + 300,
      }
    );
    const s = new BCS.Serializer();
    rawTx.serialize(s);
    return await client.sendTxUsingSerializedRawTransaction(
      account, s.getBytes(),
      { enableWaitForTransaction: true, enableTransactionSimulation: true }
    );
  } finally {
    console.log = origLog;
  }
}

async function executeRoute(opportunity, onLog = () => {}) {
  const client = await getClient();
  const { sender } = getWallet();
  const { route, optimalAmountRaw, poolsMap } = opportunity;
  const slippage = config.execution?.slippageTolerance ?? 0.005;
  const txHashes = [];

  try {
    onLog('{grey-fg}A obter sequence number...{/}');
    const info = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(info.sequence_number);

    for (let i = 0; i < route.length; i++) {
      const hop      = route[i];
      const pool     = poolsMap[hop.pool];
      const poolType = pool?.poolType ?? 'weighted';
      const amtIn    = BigInt(i === 0 ? optimalAmountRaw : (hop.amountInRaw || 0));
      const minOut   = BigInt(Math.floor(Number(hop.expectedOutRaw ?? 0) * (1 - slippage)));

      if (amtIn <= 0n) {
        onLog(`{red-fg}❌ Hop ${i+1}: amountIn=0 — a abortar.{/}`);
        return txHashes.length ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      const from = hop.fromSymbol || hop.from.slice(0, 8);
      const to   = hop.toSymbol   || hop.to.slice(0, 8);
      onLog(`{grey-fg}Hop ${i+1}/${route.length}: {cyan-fg}${from}{/}→{cyan-fg}${to}{/} [${poolType}] ${amtIn}{/}`);

      let tx;
      try {
        tx = await executeSwap({
          poolAddress: hop.pool, tokenIn: hop.from,
          amountIn: amtIn, tokenOut: hop.to,
          minAmountOut: minOut, poolType, seqNum,
        });
      } catch (e) {
        logError(`hop ${i+1}`, e);
        onLog(`{red-fg}❌ Hop ${i+1}: ${e.message?.slice(0, 100)}{/}`);
        return txHashes.length ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      if (!tx?.txHash) {
        onLog(`{red-fg}❌ Hop ${i+1}: sem txHash.{/}`);
        return txHashes.length ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      txHashes.push(tx.txHash);
      onLog(`{green-fg}✅ Hop ${i+1}: ${tx.txHash.slice(0, 20)}...{/}`);
      seqNum++;
    }

    onLog(`{green-fg}✅ Rota completa (${txHashes.length} hops)!{/}`);
    return { txHash: txHashes[0], txHashes, success: true };

  } catch (e) {
    logError('executeRoute', e);
    onLog(`{red-fg}❌ Erro fatal: ${e.message}{/}`);
    return txHashes.length ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
  }
}

// Saldo SUPRA + tokens principais
async function fetchWalletBalance() {
  try {
    const { sender } = getWallet();
    const client = await getClient();
    const raw = await client.getAccountSupraCoinBalance(new HexString(sender));
    return { SUPRA: Number(raw) / 1e8 };
  } catch (_) { return { SUPRA: 0 }; }
}

module.exports = { executeRoute, executeSwap, fetchWalletBalance };
