// src/dex/executor.js
// Usa singleton SupraClient — evita múltiplos /chain_id que causam 429

require('dotenv').config();
const { getSupraClient, HexString, SupraAccount, BCS } = require('../utils/supaClient');
const { logError } = require('../utils/logger');
const config = require('../config');

const ATMOS = config.atmosModule;
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

function serAddr(addr) {
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

async function executeOneSwap({ poolAddr, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum }) {
  const client = await getSupraClient(); // singleton — não faz /chain_id de novo
  const { account, sender } = getWallet();
  const fn = poolType === 'stable' ? 'swap_exact_in_stable_entry' : 'swap_exact_in_weighted_entry';

  const rawTx = await client.createRawTxObject(
    new HexString(sender), BigInt(seqNum),
    ATMOS, 'atmos_entry', fn, [],
    [serAddr(poolAddr), serAddr(tokenIn), serU64(amountIn), serAddr(tokenOut), serU64(minAmountOut)],
    {
      maxGasAmount:   BigInt(config.autoExecute?.maxGasAmount ?? 15000),
      gasUnitPrice:   BigInt(config.autoExecute?.gasUnitPrice ?? 100),
      expirationTime: Math.floor(Date.now() / 1000) + 300,
    }
  );
  const ser = new BCS.Serializer();
  rawTx.serialize(ser);
  return client.sendTxUsingSerializedRawTransaction(
    account, ser.getBytes(),
    { enableWaitForTransaction: true, enableTransactionSimulation: true }
  );
}

async function executeArbitrage(opportunity, onLog = () => {}) {
  const { steps }       = opportunity.result;
  const optimalAmountIn = opportunity.optimalAmount;
  const slippage        = config.autoExecute?.slippageTolerance ?? 0.005;
  const { getDecimals } = require('../config/tokens');
  const txHashes        = [];

  try {
    onLog('{grey-fg}A obter sequence number...{/}');
    const client = await getSupraClient();
    const { sender } = getWallet();
    const accInfo = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(accInfo.sequence_number);

    for (let i = 0; i < steps.length; i++) {
      const step     = steps[i];
      const ps       = step.pair;
      const poolType = ps.curve || ps.poolType || 'weighted';
      const addrIn   = step.from;
      const addrOut  = step.to;
      const decIn    = getDecimals(addrIn);
      const decOut   = getDecimals(addrOut);
      const amtIn    = i === 0 ? optimalAmountIn : steps[i - 1].amtOut;
      const amtInRaw = BigInt(Math.floor(amtIn * (10 ** decIn)));
      const minOut   = BigInt(Math.floor(step.amtOut * (10 ** decOut) * (1 - slippage)));

      if (amtInRaw <= 0n) {
        onLog(`{red-fg}❌ Hop ${i+1}: amountIn=0{/}`);
        return { success: false, txHashes, partial: txHashes.length > 0 };
      }

      const fSym = step.fromSym || step.from.slice(0, 8);
      const tSym = step.toSym   || step.to.slice(0, 8);
      onLog(`{grey-fg}Hop ${i+1}/${steps.length}: {cyan-fg}${fSym}{/}→{cyan-fg}${tSym}{/} [${poolType}] ${amtIn.toFixed(4)}→~${step.amtOut.toFixed(4)}{/}`);

      let tx;
      try {
        tx = await executeOneSwap({
          poolAddr: ps.poolAddr, tokenIn: addrIn,
          amountIn: amtInRaw, tokenOut: addrOut,
          minAmountOut: minOut, poolType, seqNum,
        });
      } catch (e) {
        logError(`hop ${i+1}`, e);
        // Mostrar mensagem de erro detalhada
        const detail = e.response?.data?.message || e.response?.data?.error || e.message || '';
        onLog(`{red-fg}❌ Hop ${i+1}: ${detail.slice(0, 120)}{/}`);
        return { success: false, txHashes, partial: txHashes.length > 0 };
      }

      if (!tx?.txHash) {
        onLog(`{red-fg}❌ Hop ${i+1}: sem txHash{/}`);
        return { success: false, txHashes, partial: txHashes.length > 0 };
      }
      txHashes.push(tx.txHash);
      onLog(`{green-fg}✅ Hop ${i+1}: ${tx.txHash.slice(0, 20)}...{/}`);
      seqNum++;
    }

    onLog(`{green-fg}✅ Arbitragem completa! ${txHashes.length} hops.{/}`);
    return { success: true, txHashes, txHash: txHashes[0] };

  } catch (e) {
    logError('executeArbitrage', e);
    const detail = e.response?.data?.message || e.message || '';
    onLog(`{red-fg}❌ ${detail.slice(0, 120)}{/}`);
    return { success: false, txHashes, partial: txHashes.length > 0 };
  }
}

async function fetchWalletBalance() {
  try {
    const { sender } = getWallet();
    const client = await getSupraClient();
    const raw = await client.getAccountSupraCoinBalance(new HexString(sender));
    return { SUPRA: Number(raw) / 1e8 };
  } catch (_) { return { SUPRA: 0 }; }
}

module.exports = { executeArbitrage, executeOneSwap, fetchWalletBalance };
