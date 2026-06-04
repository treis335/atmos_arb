// monitor.js
const fs = require('fs');
const { fetchAllReserves, friendlyToken } = require('./engine');
const { buildGraph, findTriangularCycles } = require('./detector');
const config = require('./config');

if (!fs.existsSync('pools.json')) {
  console.error('pools.json não encontrado. Execute "npm run discover" primeiro.');
  process.exit(1);
}
const pools = JSON.parse(fs.readFileSync('pools.json', 'utf8'));
console.log(`✅ Carregadas ${pools.length} pools de pools.json\n`);

let iteration = 0;
let lastOpportunities = [];

async function tick() {
  const start = Date.now();
  iteration++;
  console.log(`\n[${new Date().toLocaleTimeString()}] Ciclo ${iteration} – a carregar reservas...`);

  // Carregar reservas em paralelo com barra de progresso simples
  let completed = 0;
  const reserves = await fetchAllReserves(pools, (done, total) => {
    process.stdout.write(`\r🔄 Progresso: ${done}/${total}`);
  });
  console.log(`\n✅ Reservas carregadas: ${reserves.length}/${pools.length} pools (${Date.now() - start}ms)`);

  if (reserves.length === 0) {
    console.log('⚠️ Nenhuma pool com liquidez.');
    return;
  }

  // Construir grafo e detectar ciclos
  const graph = buildGraph(reserves);
  const cycles = findTriangularCycles(graph, config.minProfitPercent);
  lastOpportunities = cycles;

  // Mostrar oportunidades
  if (cycles.length === 0) {
    console.log('❌ Nenhuma oportunidade de arbitragem triangular significativa.');
  } else {
    console.log(`🎯 ENCONTRADAS ${cycles.length} OPORTUNIDADES:`);
    for (let i = 0; i < Math.min(cycles.length, 5); i++) {
      const c = cycles[i];
      const routeStr = c.route.map(s => `${friendlyToken(s.from)}→${friendlyToken(s.to)}`).join('→');
      console.log(`   ${i+1}. Lucro: ${c.profitPct.toFixed(3)}% | Rota: ${routeStr}`);
    }
  }

  // Mostrar preços dos pares relevantes (opcional)
  const relevantPairs = reserves.filter(r => {
    const t0 = r.pool.token0Type;
    const t1 = r.pool.token1Type;
    return config.relevantTokens.includes(t0) || config.relevantTokens.includes(t1);
  }).slice(0, 5);
  if (relevantPairs.length) {
    console.log(`\n📊 Preços de alguns pares relevantes:`);
    for (const r of relevantPairs) {
      const t0 = friendlyToken(r.pool.token0Type);
      const t1 = friendlyToken(r.pool.token1Type);
      console.log(`   ${t0}/${t1}: 1 ${t0} = ${r.rawPrice.toFixed(6)} ${t1} (fee ${r.pool.swapFeeBps/100}%)`);
    }
  }

  console.log(`⏱️ Ciclo concluído em ${Date.now() - start}ms. Aguardando ${config.pollIntervalMs/1000}s...`);
}

async function start() {
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error('Erro no tick:', err.message);
    }
    await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
  }
}

start();