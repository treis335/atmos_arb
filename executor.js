// executor.js — Execução real de rotas de arbitragem no Atmos DEX
// Baseado no padrão do arb_bot_dexyln, adaptado para Atmos (swap_exact_in_weighted/stable)

const { SupraClient, HexString, SupraAccount, BCS, TxnBuilderTypes } = require('supra-l1-sdk');
const config = require('./config');

let _client = null;
let _account = null;
let _sender = null;

function getWallet() {
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY não definido no .env');
  if (!process.env.SENDER_ADDRESS) throw new Error('SENDER_ADDRESS não definido no .env');

  if (!_sender) {
    const pkHex = process.env.PRIVATE_KEY.startsWith('0x')
      ? process.env.PRIVATE_KEY
      : '0x' + process.env.PRIVATE_KEY;
    _account = new SupraAccount(HexString.ensure(pkHex).toUint8Array());
    _sender = process.env.SENDER_ADDRESS;
  }
  return { account: _account, sender: _sender };
}

async function getClient() {
  if (!_client) _client = await SupraClient.init(config.rpc);
  return _client;
}

// Serializa um endereço como BCS AccountAddress (32 bytes)
function serializeAddress(addr) {
  const hex = addr.startsWith('0x') ? addr.slice(2) : addr;
  const padded = hex.padStart(64, '0');
  const bytes = Buffer.from(padded, 'hex');
  const ser = new BCS.Serializer();
  ser.serializeFixedBytes(bytes);
  return ser.getBytes();
}

// Serializa u64
function serializeU64(value) {
  const ser = new BCS.Serializer();
  BCS.serializeVectorWithFunc([value], 'serializeU64', ser);
  const s2 = new BCS.Serializer();
  s2.serializeU64(BigInt(value));
  return s2.getBytes();
}

// Serializa Option<vector<u8>> vazio — {"vec":[]}
function serializeEmptyOption() {
  const ser = new BCS.Serializer();
  ser.serializeU8(0); // None
  return ser.getBytes();
}

// Executa um único swap no Atmos
// poolAddress: endereço da pool
// tokenIn/Out: endereços full dos tokens
// amountIn: BigInt em raw units
// minAmountOut: BigInt em raw units (slippage protection)
// poolType: 'weighted' | 'stable'
async function executeAtmosSwap(poolAddress, tokenIn, tokenOut, amountIn, minAmountOut, poolType, seqNum) {
  const client = await getClient();
  const { account, sender } = getWallet();

  const fnName = poolType === 'stable'
    ? 'swap_exact_in_stable'
    : 'swap_exact_in_weighted';

  const rawTx = await client.createRawTxObject(
    new HexString(sender),
    BigInt(seqNum),
    config.atmosModule,
    'liquidity_pool',
    fnName,
    [], // type args — Atmos usa FA tokens, sem type args
    [
      serializeAddress(poolAddress),
      serializeAddress(tokenIn),
      serializeAddress(tokenOut),
      serializeU64(amountIn),
      serializeU64(minAmountOut),
      serializeEmptyOption(), // referral: Option<vector<u8>>
    ],
    {
      maxGasAmount: BigInt(config.execution?.maxGasAmount ?? 10000),
      gasUnitPrice: BigInt(config.execution?.gasUnitPrice ?? 100),
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
// opportunity: { route: [{from, to, pool}], profitPct, optimalAmountRaw }
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

      // Para o primeiro hop: usar optimalAmountRaw
      // Para hops seguintes: usar o output do hop anterior (guardado em hop.amountInRaw)
      const amountIn = BigInt(i === 0 ? optimalAmountRaw : hop.amountInRaw);

      // minAmountOut = output esperado com 0.5% de slippage
      const minAmountOut = BigInt(Math.floor(Number(hop.expectedOutRaw) * (1 - (config.execution?.slippageTolerance ?? 0.005))));

      onLog(`{grey-fg}Hop ${i + 1}/${route.length}: ${hop.fromSymbol} → ${hop.toSymbol} (${poolType})...{/}`);

      let txResult;
      try {
        txResult = await executeAtmosSwap(
          hop.pool,
          hop.from,
          hop.to,
          amountIn,
          minAmountOut,
          poolType,
          seqNum
        );
      } catch (e) {
        onLog(`{red-fg}❌ Hop ${i + 1} erro: ${e.message.slice(0, 60)}{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false }
          : null;
      }

      if (!txResult?.txHash) {
        onLog(`{red-fg}❌ Hop ${i + 1} sem txHash — a abortar.{/}`);
        return txHashes.length > 0
          ? { txHash: txHashes[0], partial: true, txHashes, success: false }
          : null;
      }

      txHashes.push(txResult.txHash);
      onLog(`{green-fg}✅ Hop ${i + 1}: ${txResult.txHash.slice(0, 12)}...{/}`);
      seqNum++;
    }

    onLog(`{green-fg}✅ Arbitragem completa! ${txHashes.length} hops executados.{/}`);
    return { txHash: txHashes[0], txHashes, success: true };

  } catch (e) {
    onLog(`{red-fg}❌ Erro fatal: ${e.message}{/}`);
    return txHashes.length > 0
      ? { txHash: txHashes[0], partial: true, txHashes, success: false }
      : null;
  }
}

// Fetch saldo da wallet (SUPRA + FA tokens relevantes)
async function fetchWalletBalance() {
  const { sender } = getWallet();
  const client = await getClient();
  try {
    const supraBalance = await client.getAccountSupraCoinBalance(new HexString(sender));
    return {
      SUPRA: Number(supraBalance) / 1e8,
    };
  } catch (_) {
    return { SUPRA: 0 };
  }
}

module.exports = { executeArbitrage, fetchWalletBalance, executeAtmosSwap };
