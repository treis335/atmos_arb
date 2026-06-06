// resolveTokens.js — vai ao blockchain buscar símbolo+decimais de TODOS os FA tokens
// Usa coin_utils::get_fa_details_multi (devolve CoinDetailsResponse[])
// Guarda resultado em data/token_metadata.json
//
// USO: node resolveTokens.js
// Corre UMA VEZ antes de arrancar o bot pela primeira vez.
// O bot usa token_metadata.json ao arrancar para mostrar nomes reais.

require('dotenv').config();
const { SupraClient } = require('supra-l1-sdk');
const fs   = require('fs');
const path = require('path');

const RPC         = process.env.RPC_URL || 'https://rpc-mainnet.supra.com';
const ATMOS       = '0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234';
const OUTPUT_FILE = path.join(__dirname, 'data', 'token_metadata.json');

const pools = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'pools.json'), 'utf8'));
const FA_ADDRS = [...new Set(
  pools.flatMap(p => [p.token0Type, p.token1Type]).filter(t => !t.includes('::'))
)].sort();

console.log(`\n🔍 A resolver ${FA_ADDRS.length} tokens FA da Atmos DEX...\n`);
console.log('Isto consulta coin_utils::get_fa_details_multi no blockchain Supra.');
console.log('Demora ~30-60 segundos. Corre apenas uma vez.\n');

function shortAddr(addr) {
  const h = addr.startsWith('0x') ? addr.slice(2) : addr;
  return '0x' + h.slice(0, 4) + '..' + h.slice(-4);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function resolveAll() {
  const client  = await SupraClient.init(RPC);
  const results = {};
  let resolved  = 0;
  let failed    = 0;
  const BATCH   = 15; // batches pequenos para evitar timeout

  for (let i = 0; i < FA_ADDRS.length; i += BATCH) {
    const batch    = FA_ADDRS.slice(i, i + BATCH);
    const bNum     = Math.floor(i / BATCH) + 1;
    const bTotal   = Math.ceil(FA_ADDRS.length / BATCH);

    process.stdout.write(`  Batch ${bNum}/${bTotal} (${batch.length} tokens)... `);

    try {
      const res = await client.invokeViewMethod(
        `${ATMOS}::coin_utils::get_fa_details_multi`, [], [batch]
      );

      const arr = Array.isArray(res) ? res : [];

      for (let j = 0; j < batch.length; j++) {
        const addr = batch[j];
        const info = arr[j];
        const sym  = info?.symbol || info?.Symbol || null;
        const dec  = Number(info?.decimals ?? info?.Decimals ?? 8);
        const name = info?.name   || info?.Name   || sym || '';

        results[addr] = { symbol: sym || shortAddr(addr), decimals: dec, name, resolved: !!sym };
        if (sym) resolved++; else failed++;
      }

      // Tokens em falta no retorno
      for (let j = arr.length; j < batch.length; j++) {
        const addr = batch[j];
        results[addr] = { symbol: shortAddr(addr), decimals: 8, name: '', resolved: false };
        failed++;
      }

      const ok = arr.filter((_, j) => arr[j]?.symbol).length;
      console.log(`✓ ${ok}/${batch.length} com símbolo`);

    } catch (e) {
      console.log(`✗ Falhou batch — a tentar individualmente...`);

      for (const addr of batch) {
        try {
          const r   = await client.invokeViewMethod(`${ATMOS}::coin_utils::get_fa_details_multi`, [], [[addr]]);
          const arr = Array.isArray(r) ? r : [];
          const info = arr[0];
          const sym  = info?.symbol || null;
          const dec  = Number(info?.decimals ?? 8);
          results[addr] = { symbol: sym || shortAddr(addr), decimals: dec, name: info?.name || '', resolved: !!sym };
          if (sym) resolved++; else failed++;
        } catch (_) {
          results[addr] = { symbol: shortAddr(addr), decimals: 8, name: '', resolved: false };
          failed++;
        }
        await sleep(100);
      }
    }

    if (i + BATCH < FA_ADDRS.length) await sleep(400);
  }

  // Adicionar SUPRA (não é FA)
  results['0x1::supra_coin::SupraCoin'] = {
    symbol: 'SUPRA', decimals: 8, name: 'Supra Coin', resolved: true
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  // Tabela de resultados
  console.log('\n' + '═'.repeat(72));
  console.log(` RESULTADO: ${resolved}/${FA_ADDRS.length} tokens resolvidos com símbolo real`);
  console.log('═'.repeat(72));

  const sorted = Object.entries(results).sort((a, b) =>
    (a[1].symbol || 'zzz').localeCompare(b[1].symbol || 'zzz')
  );

  for (const [addr, info] of sorted) {
    const sym   = (info.symbol  || '???').padEnd(12);
    const dec   = String(info.decimals || 8).padStart(2);
    const name  = (info.name   || '').slice(0, 25).padEnd(25);
    const short = addr.includes('::') ? addr.split('::').pop().padEnd(16)
                : ('0x' + addr.slice(2, 8) + '..' + addr.slice(-6)).padEnd(16);
    const flag  = info.resolved ? '✓' : '·';
    console.log(`  ${flag} ${sym} dec=${dec}  ${short}  ${name}`);
  }

  console.log('\n✅ Guardado em: ' + OUTPUT_FILE);
  console.log('\nAgora podes arrancar o bot:  node index.js\n');
}

resolveAll().catch(e => {
  console.error('\n❌ Erro fatal:', e.message);
  console.error('Verifica a ligação à internet e o RPC URL.');
  process.exit(1);
});
