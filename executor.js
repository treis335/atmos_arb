// executor.js — Execução real via atmos_entry::swap_exact_in_*_entry
//
// Assinatura correcta (do ABI atmos_entry-ABI.json):
//   swap_exact_in_weighted_entry(
//     &signer,
//     pool:           Object<Pool>,        <- endereço da pool
//     token_in:       Object<Metadata>,    <- endereço FA metadata token entrada
//     amount_in:      u64,                 <- amount raw
//     token_out:      Object<Metadata>,    <- endereço FA metadata token saída
//     min_amount_out: u64                  <- slippage protection
//   )
//   (idem para swap_exact_in_stable_entry)

require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS } = require('supra-l1-sdk');
const config = require('./config');

let _client = null;
let _account = null;
let _sender  = null;

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

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// Serializa endereço como AccountAddress 32 bytes (Object<X> = endereço)
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

// Executa um swap no Atmos
// tokenIn/Out : endereços FA metadata (Object<Metadata>)
// amountIn    : BigInt raw units
// minAmountOut: BigInt raw units (0 = sem slippage protection, aceita qualquer output)
async function executeAtmosSwap(poolAddress, tokenIn, amountIn, tokenOut, minAmountOut, poolType, seqNum) {
  const client = await getClient();
  const { account, sender } = getWallet();

  const fnName = poolType === 'stable'
    ? 'swap_exact_in_stable_entry'
    : 'swap_exact_in_weighted_entry';

  const rawTx = await client.createRawTxObject(
    new HexString(sender),
    BigInt(seqNum),
    config.atmosModule,
    'atmos_entry',
    fnName,
    [], // sem type args (FA tokens não precisam)
    [
      serAddr(poolAddress),       // pool: Object<Pool>
      serAddr(tokenIn),           // token_in: Object<Metadata>
      serU64(amountIn),           // amount_in: u64
      serAddr(tokenOut),          // token_out: Object<Metadata>
      serU64(minAmountOut),       // min_amount_out: u64
    ],
    {
      maxGasAmount:   BigInt(config.execution?.maxGasAmount  ?? 10000),
      gasUnitPrice:   BigInt(config.execution?.gasUnitPrice  ?? 100),
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

// Executa uma rota completa de arbitragem (múltiplos hops sequenciais)
async function executeArbitrage(opportunity, onLog = () => {}) {
  const client = await getClient();
  const { sender } = getWallet();
  const txHashes = [];

  try {
    onLog('{grey-fg}A obter sequence number...{/}');
    const accInfo = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(accInfo.sequence_number);

    const { route, optimalAmountRaw, poolsMap } = opportunity;
    const slippage = config.execution?.slippageTolerance ?? 0.005;

    for (let i = 0; i < route.length; i++) {
      const hop      = route[i];
      const pool     = poolsMap[hop.pool];
      const poolType = pool?.poolType ?? 'weighted';

      const amountIn    = BigInt(i === 0 ? optimalAmountRaw : (hop.amountInRaw || 0));
      const minAmountOut = BigInt(Math.floor(Number(hop.expectedOutRaw ?? 0) * (1 - slippage)));

      if (amountIn <= 0n) {
        onLog(`{red-fg}❌ Hop ${i+1} amountIn=0 — a abortar.{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false }
          : null;
      }

      const fromSym = hop.fromSymbol ?? hop.from.slice(0, 8);
      const toSym   = hop.toSymbol   ?? hop.to.slice(0, 8);
      onLog(`{grey-fg}Hop ${i+1}/${route.length}: ${fromSym}→${toSym} via ${poolType} (${Number(amountIn)} raw){/}`);

      let txResult;
      try {
        txResult = await executeAtmosSwap(
          hop.pool, hop.from, amountIn, hop.to, minAmountOut, poolType, seqNum
        );
      } catch (e) {
        onLog(`{red-fg}❌ Hop ${i+1} erro: ${e.message.slice(0, 80)}{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false }
          : null;
      }

      if (!txResult?.txHash) {
        onLog(`{red-fg}❌ Hop ${i+1} sem txHash — a abortar.{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false }
          : null;
      }

      txHashes.push(txResult.txHash);
      onLog(`{green-fg}✅ Hop ${i+1}: ${txResult.txHash.slice(0, 16)}...{/}`);
      seqNum++;
    }

    onLog(`{green-fg}✅ Arbitragem completa! ${txHashes.length} hops.{/}`);
    return { txHash: txHashes[0], txHashes, success: true };

  } catch (e) {
    onLog(`{red-fg}❌ Erro fatal: ${e.message}{/}`);
    return txHashes.length > 0
      ? { txHash: txHashes[0], partial: true, txHashes, success: false }
      : null;
  }
}

// Fetch saldo SUPRA
async function fetchWalletBalance() {
  try {
    const { sender } = getWallet();
    const client = await getClient();
    const raw = await client.getAccountSupraCoinBalance(new HexString(sender));
    return { SUPRA: Number(raw) / 1e8 };
  } catch (_) { return { SUPRA: 0 }; }
}

module.exports = { executeArbitrage, fetchWalletBalance, executeAtmosSwap };
