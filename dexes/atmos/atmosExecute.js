// dexes/atmos/atmosExecute.js
// Executor para a DEX Atmos — usa atmos_entry::swap_exact_in_*_entry
// Suporta rotas intra-Atmos (múltiplos hops sequenciais).

require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS } = require('supra-l1-sdk');
const { CONFIG } = require('../../config/config');
const { logError } = require('../../utils/logError');

let _client = null;
let _account = null;
let _sender  = null;

async function getClient() {
  if (!_client) _client = await SupraClient.init(CONFIG.rpc);
  return _client;
}

function getWallet() {
  if (!process.env.PRIVATE_KEY)    throw new Error('PRIVATE_KEY não definido no .env');
  if (!process.env.SENDER_ADDRESS) throw new Error('SENDER_ADDRESS não definido no .env');
  if (_account) return { account: _account, sender: _sender };
  const pkHex = process.env.PRIVATE_KEY.startsWith('0x')
    ? process.env.PRIVATE_KEY : '0x' + process.env.PRIVATE_KEY;
  _account = new SupraAccount(HexString.ensure(pkHex).toUint8Array());
  _sender  = process.env.SENDER_ADDRESS;
  return { account: _account, sender: _sender };
}

function serAddr(addr) {
  const hex = (addr.startsWith('0x') ? addr.slice(2) : addr).padStart(64, '0');
  const ser = new BCS.Serializer();
  ser.serializeFixedBytes(Buffer.from(hex, 'hex'));
  return ser.getBytes();
}

function serU64(value) {
  const ser = new BCS.Serializer();
  ser.serializeU64(BigInt(value));
  return ser.getBytes();
}

async function executeAtmosSwap(poolAddress, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum) {
  const client  = await getClient();
  const { account, sender } = getWallet();
  const fnName  = poolType === 'stable'
    ? 'swap_exact_in_stable_entry'
    : 'swap_exact_in_weighted_entry';

  const originalLog = console.log;
  console.log = () => {};
  try {
    const rawTx = await client.createRawTxObject(
      new HexString(sender),
      BigInt(seqNum),
      CONFIG.atmos.moduleAddress,
      'atmos_entry',
      fnName,
      [],
      [
        serAddr(poolAddress),
        serAddr(tokenIn),
        serU64(amountIn),
        serAddr(tokenOut),
        serU64(minAmountOut),
      ],
      {
        maxGasAmount:   BigInt(CONFIG.autoExecute?.maxGasAmount ?? 15000),
        gasUnitPrice:   BigInt(CONFIG.autoExecute?.gasUnitPrice ?? 100),
        expirationTime: Math.floor(Date.now() / 1000) + 300,
      }
    );
    const ser = new BCS.Serializer();
    rawTx.serialize(ser);
    return client.sendTxUsingSerializedRawTransaction(
      account, ser.getBytes(),
      { enableWaitForTransaction: true, enableTransactionSimulation: true }
    );
  } finally {
    console.log = originalLog;
  }
}

// Executa rota Atmos completa (1 ou mais hops)
async function executeAtmosArbitrage(opportunity, onLog = () => {}) {
  const client = await getClient();
  const { sender } = getWallet();
  const txHashes = [];
  const slippage = CONFIG.autoExecute?.slippageTolerance ?? 0.005;

  try {
    onLog('{grey-fg}Atmos: a obter sequence number...{/}');
    const accInfo = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(accInfo.sequence_number);

    const { result, optimalAmount } = opportunity;
    const { steps } = result;

    // Calcular amountIn raw para o primeiro hop
    const firstStep  = steps[0];
    const firstToken = CONFIG.tokens[firstStep.from];
    let currentAmtRaw = Math.round(optimalAmount * firstToken.decimals);

    for (let i = 0; i < steps.length; i++) {
      const step     = steps[i];
      const pool     = step.pair._pool;
      const poolType = pool?.poolType ?? 'weighted';
      const tokenIn  = CONFIG.tokens[step.from];
      const tokenOut = CONFIG.tokens[step.to];
      if (!tokenIn || !tokenOut) {
        onLog(`{red-fg}Token desconhecido no hop ${i+1}{/}`);
        return null;
      }

      const amountIn    = BigInt(i === 0 ? currentAmtRaw : Math.round(step.amtIn * tokenIn.decimals));
      const minAmtOut   = BigInt(Math.floor(step.amtOut * tokenOut.decimals * (1 - slippage)));

      onLog(`{grey-fg}Atmos hop ${i+1}/${steps.length}: ${tokenIn.symbol}→${tokenOut.symbol} via ${poolType} (${Number(amountIn)}){/}`);

      let txResult;
      try {
        txResult = await executeAtmosSwap(
          pool.address, tokenIn.type, amountIn, tokenOut.type, minAmtOut, poolType, seqNum
        );
      } catch (e) {
        logError(`atmosSwap hop ${i+1}`, e);
        onLog(`{red-fg}❌ Hop ${i+1} erro: ${e.message.slice(0, 80)}{/}`);
        return txHashes.length > 0 ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      if (!txResult?.txHash) {
        onLog(`{red-fg}❌ Hop ${i+1} sem txHash{/}`);
        return txHashes.length > 0 ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
      }

      txHashes.push(txResult.txHash);
      onLog(`{green-fg}✅ Atmos hop ${i+1}: ${txResult.txHash.slice(0, 14)}...{/}`);
      seqNum++;
    }

    return { txHash: txHashes[0], txHashes, success: true };
  } catch (e) {
    logError('executeAtmosArbitrage', e);
    onLog(`{red-fg}❌ Erro fatal Atmos: ${e.message}{/}`);
    return txHashes.length > 0 ? { txHash: txHashes[0], partial: true, txHashes, success: false } : null;
  }
}

module.exports = { executeAtmosArbitrage, executeAtmosSwap };
