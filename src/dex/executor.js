// src/dex/executor.js - Versão corrigida para execução
require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS } = require('supra-l1-sdk');
const { getClient } = require('../utils/client');
const { logError } = require('../utils/logger');
const config = require('../config');

const ATMOS = config.atmosModule;
let _account = null, _sender = null;

function getWallet() {
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY não definido');
  if (!process.env.SENDER_ADDRESS) throw new Error('SENDER_ADDRESS não definido');
  
  if (_account) return { account: _account, sender: _sender };
  
  const pk = process.env.PRIVATE_KEY.replace(/^0x/, '');
  _account = new SupraAccount(Buffer.from(pk, 'hex'));
  _sender = process.env.SENDER_ADDRESS;
  return { account: _account, sender: _sender };
}

function serAddr(hex) {
  const s = new BCS.Serializer();
  s.serializeFixedBytes(Buffer.from(hex.replace(/^0x/, '').padStart(64, '0'), 'hex'));
  return s.getBytes();
}

function serU64(v) {
  const s = new BCS.Serializer();
  s.serializeU64(BigInt(v));
  return s.getBytes();
}

async function executeSwap({ poolAddress, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum }) {
  const client = await getClient();
  const { account, sender } = getWallet();
  const module = 'atmos_entry_coin';
  const fn = poolType === 'stable' ? 'swap_exact_in_stable' : 'swap_exact_in_weighted';

  try {
    const rawTx = await client.createRawTxObject(
      new HexString(sender), 
      BigInt(seqNum),
      ATMOS, 
      module, 
      fn, 
      [], 
      [
        serAddr(poolAddress),
        serAddr(tokenIn),
        serU64(amountIn),
        serAddr(tokenOut),
        serU64(minAmountOut)
      ],
      {
        maxGasAmount: BigInt(30000),
        gasUnitPrice: BigInt(100),
        expirationTime: Math.floor(Date.now() / 1000) + 600,
      }
    );

    const s = new BCS.Serializer();
    rawTx.serialize(s);
    const tx = await client.sendTxUsingSerializedRawTransaction(account, s.getBytes(), {
      enableWaitForTransaction: true,
      enableTransactionSimulation: true
    });

    console.log(`✅ Swap executado: ${tx.txHash ? tx.txHash.slice(0, 20) + '...' : 'sem hash'}`);
    return tx;
  } catch (e) {
    logError('executeSwap', e);
    console.error("Erro detalhado:", e.message);
    throw e;
  }
}

async function executeRoute(opportunity, onLog = console.log) {
  const client = await getClient();
  const { sender } = getWallet();
  const { route, optimalAmountRaw, poolsMap } = opportunity;
  const slippage = 0.01; // 1%
  const txHashes = [];

  try {
    onLog("Obtendo sequence number...");
    const info = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(info.sequence_number);

    for (let i = 0; i < route.length; i++) {
      const hop = route[i];
      const pool = poolsMap[hop.pool];
      const poolType = pool?.poolType || 'weighted';
      const amtIn = BigInt(i === 0 ? optimalAmountRaw : hop.amountInRaw || 0);
      const minOut = BigInt(Math.floor(Number(hop.expectedOutRaw || 0) * (1 - slippage)));

      if (amtIn <= 0n) {
        onLog(`Hop ${i+1}: amountIn = 0`);
        break;
      }

      onLog(`Executando hop ${i+1}: ${hop.fromSymbol || hop.from} → ${hop.toSymbol || hop.to}`);

      const tx = await executeSwap({
        poolAddress: hop.pool,
        tokenIn: hop.from,
        amountIn: amtIn,
        tokenOut: hop.to,
        minAmountOut: minOut,
        poolType,
        seqNum
      });

      if (tx?.txHash) txHashes.push(tx.txHash);
      seqNum++;
    }

    onLog(`Rota concluída com ${txHashes.length} transações.`);
    return { success: txHashes.length > 0, txHashes };
  } catch (e) {
    logError('executeRoute', e);
    onLog(`Erro na rota: ${e.message}`);
    return { success: false, txHashes };
  }
}

module.exports = { executeRoute, executeSwap };