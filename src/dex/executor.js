// src/dex/executor.js
// CONFIRMADO PELAS ABIs:
//
// atmos_entry::swap_exact_in_weighted_entry(&signer, pool, token_in_meta, amount_in, token_out_meta, min_out)
// atmos_entry_coin::swap_exact_in_weighted (&signer, pool, token_in_meta, amount_in, token_out_meta, min_out)
//
// AMBOS usam Object<Metadata> para os tokens — FA address puro.
// Diferença interna: entry_coin faz unwrap/wrap de Coin<T> automaticamente.
// Usamos atmos_entry_coin para compatibilidade com Coin<T> e FA.
//
// Serialização BCS de Object<X> = AccountAddress (32 bytes big-endian).
// Serialização BCS de u64 = 8 bytes little-endian.

require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS } = require('supra-l1-sdk');
const { getClient } = require('../utils/client');
const { logError }  = require('../utils/logger');
const config        = require('../config');

const ATMOS = config.atmosModule;
let _account = null, _sender = null;

function getWallet() {
  if (!process.env.PRIVATE_KEY)    throw new Error('PRIVATE_KEY não definido no .env');
  if (!process.env.SENDER_ADDRESS) throw new Error('SENDER_ADDRESS não definido no .env');
  if (_account) return { account: _account, sender: _sender };
  const pk = process.env.PRIVATE_KEY.replace(/^0x/, '');
  _account = new SupraAccount(Buffer.from(pk, 'hex'));
  _sender  = process.env.SENDER_ADDRESS;
  return { account: _account, sender: _sender };
}

// BCS: AccountAddress (32 bytes big-endian) para Object<X>
function serAddr(hex) {
  const s = new BCS.Serializer();
  s.serializeFixedBytes(Buffer.from(hex.replace(/^0x/, '').padStart(64, '0'), 'hex'));
  return s.getBytes();
}

// BCS: u64 (8 bytes little-endian)
function serU64(v) {
  const s = new BCS.Serializer();
  s.serializeU64(BigInt(v));
  return s.getBytes();
}

async function executeSwap({ poolAddress, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum }) {
  const client = await getClient();
  const { account, sender } = getWallet();
  // atmos_entry_coin: swap_exact_in_weighted / swap_exact_in_stable
  const module = 'atmos_entry_coin';
  const fn     = poolType === 'stable' ? 'swap_exact_in_stable' : 'swap_exact_in_weighted';

  const orig = console.log; console.log = () => {};
  try {
    const rawTx = await client.createRawTxObject(
      new HexString(sender), BigInt(seqNum),
      ATMOS, module, fn,
      [], // sem type params — FA-based não usa generics
      [
        serAddr(poolAddress),        // Object<Pool>
        serAddr(tokenIn),            // Object<Metadata> token_in
        serU64(amountIn),            // u64 amount_in
        serAddr(tokenOut),           // Object<Metadata> token_out
        serU64(minAmountOut),        // u64 min_amount_out
      ],
      {
        maxGasAmount:   BigInt(config.execution?.maxGasAmount  ?? 20000),
        gasUnitPrice:   BigInt(config.execution?.gasUnitPrice  ?? 100),
        expirationTime: Math.floor(Date.now() / 1000) + 300,
      }
    );
    const s = new BCS.Serializer();
    rawTx.serialize(s);
    return await client.sendTxUsingSerializedRawTransaction(
      account, s.getBytes(),
      { enableWaitForTransaction: true, enableTransactionSimulation: true }
    );
  } finally { console.log = orig; }
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
        return txHashes.length
          ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      onLog(`{grey-fg}Hop ${i+1}/${route.length}: {cyan-fg}${hop.fromSymbol||hop.from.slice(0,8)}{/}→{cyan-fg}${hop.toSymbol||hop.to.slice(0,8)}{/} [${poolType}]{/}`);

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
        return txHashes.length
          ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      if (!tx?.txHash) {
        onLog(`{red-fg}❌ Hop ${i+1}: sem txHash.{/}`);
        return txHashes.length
          ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      txHashes.push(tx.txHash);
      onLog(`{green-fg}✅ Hop ${i+1}: ${tx.txHash.slice(0,20)}...{/}`);
      seqNum++;
    }

    onLog(`{green-fg}✅ Rota completa (${txHashes.length} hops)!{/}`);
    return { txHash: txHashes[0], txHashes, success: true };
  } catch (e) {
    logError('executeRoute', e);
    onLog(`{red-fg}❌ Erro: ${e.message}{/}`);
    return txHashes.length
      ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
  }
}

// Saldo SUPRA + FA tokens da wallet usando get_fa_balances_multi
// get_fa_balances_multi(vector<address>, address) → vector<CoinBalanceResponse>
// CoinBalanceResponse: { name, symbol, decimals, balance_coin, balance_fa, ... }
async function fetchWalletBalance(walletAddr) {
  try {
    if (!walletAddr && process.env.SENDER_ADDRESS) walletAddr = process.env.SENDER_ADDRESS;
    if (!walletAddr) return { SUPRA: 0 };

    const client = await getClient();
    // Saldo SUPRA nativo
    const raw = await client.getAccountSupraCoinBalance(new HexString(walletAddr));
    const supra = Number(raw) / 1e8;

    // Saldos FA tokens em batch (todas as FA addresses do config)
    const { TOKENS } = require('../config/tokens');
    const faAddrs = Object.values(TOKENS)
      .map(t => t.type)
      .filter(t => !t.includes('::')) // só FA tokens (endereço nu)
      .slice(0, 30); // limite razoável

    const balances = { SUPRA: supra };
    if (faAddrs.length > 0) {
      try {
        const { callView } = require('../utils/client');
        const ATMOS = config.atmosModule;
        const res = await callView(
          `${ATMOS}::coin_utils::get_fa_balances_multi`,
          [], [JSON.stringify(faAddrs), walletAddr]
        );
        if (Array.isArray(res)) {
          for (const r of res) {
            const sym = r.symbol || r.name;
            const bal = Number(r.balance_fa ?? r.balance_coin ?? 0) / (10 ** (r.decimals ?? 8));
            if (sym && bal > 0) balances[sym] = bal;
          }
        }
      } catch (_) {}
    }
    return balances;
  } catch (_) { return { SUPRA: 0 }; }
}

module.exports = { executeRoute, executeSwap, fetchWalletBalance };
