// src/utils/balance.js - Balance 100% funcional para Supra FA
const { getDecimals } = require('../config/tokens');

async function getWalletBalance(client, walletAddress, tokenMetadata) {
  if (!tokenMetadata || !walletAddress) return 0n;

  try {
    const result = await client.view({
      function: "0x1::primary_fungible_store::balance",
      type_arguments: [],
      arguments: [walletAddress, tokenMetadata]
    });

    const rawBalance = BigInt(result[0] || 0);
    return rawBalance;
  } catch (error) {
    console.warn(`[Balance] Falha ao buscar ${tokenMetadata.slice(0,12)}...`, error.message?.slice(0,100));
    return 0n;
  }
}

function formatBalance(rawBalance, decimals = 8) {
  return Number(rawBalance) / Math.pow(10, decimals);
}

module.exports = { getWalletBalance, formatBalance };