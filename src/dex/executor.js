// src/dex/executor.js — executa swaps na Atmos DEX
//
// Entry function (do ABI atmos_entry-ABI.json):
//   swap_exact_in_weighted_entry(&signer, pool, token_in, amount_in, token_out, min_amount_out)
//   swap_exact_in_stable_entry  (&signer, pool, token_in, amount_in, token_out, min_amount_out)
//
// Todos os args são Object<X> = address serializado como AccountAddress (32 bytes)
// min_amount_out = amount_out_esperado × (1 - slippage)

require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS } = require('supra-l1-sdk');
const { getClient }  = require('../utils/client');
const { logError }   = require('../utils/logger');
const config         = require('../config');

let _account = null;
let _sender  = null;

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

// BCS: endereço hex → 32 bytes big-endian
function serAddr(addr) {
  const hex = (addr.startsWith('0x') ? addr.slice(2) : addr).padStart(64, '0');
  const s   = new BCS.Serializer();
  s.serializeFixedBytes(Buffer.from(hex, 'hex'));
  return s.getBytes();
}

// BCS: u64
function serU64(v) {
  const s = new BCS.Serializer();
  s.serializeU64(BigInt(v));
  return s.getBytes();
}

// Executa um único swap
async function executeSwap({ poolAddress, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum }) {
  const client = await getClient();
  const { account, sender } = getWallet();
  const fn = poolType === 'stable' ? 'swap_exact_in_stable_entry' : 'swap_exact_in_weighted_entry';

  // Suprimir logs internos do SDK
  const origLog = console.log; console.log = () => {};
  try {
    const rawTx = await client.createRawTxObject(
      new HexString(sender), BigInt(seqNum),
      config.atmosModule, 'atmos_entry', fn, [],
      [
        serAddr(poolAddress),   // pool: Object<Pool>
        serAddr(tokenIn),       // token_in: Object<Metadata>
        serU64(amountIn),       // amount_in: u64
        serAddr(tokenOut),      // token_out: Object<Metadata>
        serU64(minAmountOut),   // min_amount_out: u64
      ],
      {
        maxGasAmount:   BigInt(config.execution?.maxGasAmount ?? 15000),
        gasUnitPrice:   BigInt(config.execution?.gasUnitPrice ?? 100),
        expirationTime: Math.floor(Date.now() / 1000) + 300,
      }
    );
    const ser = new BCS.Serializer();
    rawTx.serialize(ser);
    return await client.sendTxUsingSerializedRawTransaction(
      account, ser.getBytes(),
      { enableWaitForTransaction: true, enableTransactionSimulation: true }
    );
  } finally {
    console.log = origLog;
  }
}

// Executa rota completa (N hops sequenciais)
async function executeRoute(opportunity, onLog = () => {}) {
  const client = await getClient();
  const { sender } = getWallet();
  const { route, optimalAmountRaw, poolsMap } = opportunity;
  const slippage = config.execution?.slippageTolerance ?? 0.005;
  const txHashes = [];

  try {
    onLog('{grey-fg}A obter sequence number...{/}');
    const accInfo = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(accInfo.sequence_number);

    for (let i = 0; i < route.length; i++) {
      const hop      = route[i];
      const pool     = poolsMap[hop.pool];
      const poolType = pool?.poolType ?? 'weighted';
      const amtIn    = BigInt(i === 0 ? optimalAmountRaw : (hop.amountInRaw || 0));
      const minOut   = BigInt(Math.floor(Number(hop.expectedOutRaw ?? 0) * (1 - slippage)));

      if (amtIn <= 0n) {
        onLog(`{red-fg}❌ Hop ${i+1} amountIn=0 — a abortar.{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      const from = hop.fromSymbol || hop.from.slice(0, 8);
      const to   = hop.toSymbol   || hop.to.slice(0, 8);
      onLog(`{grey-fg}Hop ${i+1}/${route.length}: {cyan-fg}${from}{/}→{cyan-fg}${to}{/} [${poolType}]{/}`);

      let tx;
      try {
        tx = await executeSwap({
          poolAddress: hop.pool, tokenIn: hop.from, amountIn: amtIn,
          tokenOut: hop.to, minAmountOut: minOut, poolType, seqNum,
        });
      } catch (e) {
        logError(`executeSwap hop ${i+1}`, e);
        onLog(`{red-fg}❌ Hop ${i+1}: ${e.message.slice(0, 80)}{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      if (!tx?.txHash) {
        onLog(`{red-fg}❌ Hop ${i+1} sem txHash — a abortar.{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      txHashes.push(tx.txHash);
      onLog(`{green-fg}✅ Hop ${i+1}: {white-fg}${tx.txHash.slice(0, 18)}...{/}`);
      seqNum++;
    }

    onLog(`{green-fg}✅ Rota completa — ${txHashes.length} hops executados!{/}`);
    return { txHash: txHashes[0], txHashes, success: true };

  } catch (e) {
    logError('executeRoute', e);
    onLog(`{red-fg}❌ Erro fatal: ${e.message}{/}`);
    return txHashes.length > 0
      ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
  }
}

// Saldo SUPRA da wallet
async function fetchWalletBalance() {
  try {
    const { sender } = getWallet();
    const client = await getClient();
    const raw = await client.getAccountSupraCoinBalance(new HexString(sender));
    return { SUPRA: Number(raw) / 1e8 };
  } catch (_) { return { SUPRA: 0 }; }
}

module.exports = { executeRoute, executeSwap, fetchWalletBalance };
