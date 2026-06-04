// executor.js — Execução real via atmos_entry::swap_exact_in_*_entry
// Entry function signature (do ABI):
//   swap_exact_in_weighted_entry(signer, pool: Object<Pool>, token_in: Object<Metadata>, amount_in: u64)
//   swap_exact_in_stable_entry(signer, pool: Object<Pool>, token_in: Object<Metadata>, amount_in: u64)
// NOTA: sem token_out (o contrato sabe qual é), sem min_out (sem slippage protection nativa)

require('dotenv').config();
const { SupraClient, HexString, SupraAccount, BCS, TxnBuilderTypes } = require('supra-l1-sdk');
const config = require('./config');

// Módulo de entrada — entry functions estão em atmos_entry, não em liquidity_pool
const ENTRY_MODULE = config.atmosModule + '::atmos_entry';

let _client = null;
let _account = null;
let _sender = null;

function getWallet() {
  if (!process.env.PRIVATE_KEY)     throw new Error('PRIVATE_KEY não definido no .env');
  if (!process.env.SENDER_ADDRESS)  throw new Error('SENDER_ADDRESS não definido no .env');

  if (!_account) {
    const pkHex = process.env.PRIVATE_KEY.startsWith('0x')
      ? process.env.PRIVATE_KEY
      : '0x' + process.env.PRIVATE_KEY;
    _account = new SupraAccount(HexString.ensure(pkHex).toUint8Array());
    _sender  = process.env.SENDER_ADDRESS;
  }
  return { account: _account, sender: _sender };
}

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// Serializa endereço como AccountAddress (32 bytes big-endian)
function serializeAddress(addr) {
  const hex = (addr.startsWith('0x') ? addr.slice(2) : addr).padStart(64, '0');
  const ser = new BCS.Serializer();
  ser.serializeFixedBytes(Buffer.from(hex, 'hex'));
  return ser.getBytes();
}

// Serializa u64
function serializeU64(value) {
  const ser = new BCS.Serializer();
  ser.serializeU64(BigInt(value));
  return ser.getBytes();
}

// Executa um único swap no Atmos via entry function
// poolAddress : endereço da pool (Object<Pool>)
// tokenIn     : endereço do FA metadata do token de entrada (Object<Metadata>)
// amountIn    : BigInt em raw units (u64)
// poolType    : 'weighted' | 'stable'
async function executeAtmosSwap(poolAddress, tokenIn, amountIn, poolType, seqNum) {
  const client  = await getClient();
  const { account, sender } = getWallet();

  const fnName = poolType === 'stable'
    ? 'swap_exact_in_stable_entry'
    : 'swap_exact_in_weighted_entry';

  const rawTx = await client.createRawTxObject(
    new HexString(sender),
    BigInt(seqNum),
    config.atmosModule,   // module address
    'atmos_entry',        // module name
    fnName,               // function name
    [],                   // type args — nenhum para FA tokens
    [
      serializeAddress(poolAddress),  // pool: Object<Pool>
      serializeAddress(tokenIn),      // token_in: Object<Metadata>
      serializeU64(amountIn),         // amount_in: u64
    ],
    {
      maxGasAmount:   BigInt(config.execution?.maxGasAmount  ?? 10000),
      gasUnitPrice:   BigInt(config.execution?.gasUnitPrice  ?? 100),
      expirationTime: Math.floor(Date.now() / 1000) + 300,
    }
  );

  const serializer = new BCS.Serializer();
  rawTx.serialize(serializer);

  return client.sendTxUsingSerializedRawTransaction(
    account,
    serializer.getBytes(),
    { enableWaitForTransaction: true, enableTransactionSimulation: true }
  );
}

// Executa uma rota completa de arbitragem (múltiplos hops)
async function executeArbitrage(opportunity, onLog = () => {}) {
  const { account, sender } = getWallet();
  const client = await getClient();
  const txHashes = [];

  try {
    onLog('{grey-fg}A obter sequence number...{/}');
    const accInfo = await client.getAccountInfo(new HexString(sender));
    let seqNum = Number(accInfo.sequence_number);

    const { route, optimalAmountRaw, poolsMap } = opportunity;

    for (let i = 0; i < route.length; i++) {
      const hop = route[i];
      const pool = poolsMap[hop.pool];
      const poolType = pool?.poolType ?? 'weighted';

      // amountIn: primeiro hop usa optimalAmountRaw; seguintes usam output anterior
      const amountIn = BigInt(i === 0 ? optimalAmountRaw : (hop.amountInRaw || 0));
      if (amountIn <= 0n) {
        onLog(`{red-fg}❌ Hop ${i+1} amountIn inválido — a abortar.{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false }
          : null;
      }

      onLog(`{grey-fg}Hop ${i+1}/${route.length}: ${hop.fromSymbol ?? hop.from.slice(0,8)} → ${hop.toSymbol ?? hop.to.slice(0,8)} (${poolType})...{/}`);

      let txResult;
      try {
        txResult = await executeAtmosSwap(hop.pool, hop.from, amountIn, poolType, seqNum);
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

// Fetch saldo SUPRA da wallet
async function fetchWalletBalance() {
  try {
    const { sender } = getWallet();
    const client = await getClient();
    const raw = await client.getAccountSupraCoinBalance(new HexString(sender));
    return { SUPRA: Number(raw) / 1e8 };
  } catch (_) { return { SUPRA: 0 }; }
}

module.exports = { executeArbitrage, fetchWalletBalance, executeAtmosSwap };
