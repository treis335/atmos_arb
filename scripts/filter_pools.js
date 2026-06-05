// scripts/filter_pools.js — filtra pools com tokens conhecidos
// Gera data/pools_relevant.json
const fs   = require('fs');
const path = require('path');
const { TYPE_TO_KEY } = require('../src/config/tokens');

const pools = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'pools.json'), 'utf8'));
const knownTypes = new Set(Object.keys(TYPE_TO_KEY));
const relevant = pools.filter(p => knownTypes.has(p.token0Type) || knownTypes.has(p.token1Type));

console.log(`Total pools:     ${pools.length}`);
console.log(`Pools relevantes: ${relevant.length}`);
const out = path.join(process.cwd(), 'data', 'pools_relevant.json');
fs.writeFileSync(out, JSON.stringify(relevant, null, 2));
console.log(`📁 Guardado em data/pools_relevant.json`);
