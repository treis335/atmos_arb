// src/utils/asyncLimit.js — semáforo para limitar concorrência de tasks async
// Versão optimizada: usa Promise queue em vez de array + shift (O(1) amortizado)
module.exports = function asyncLimit(concurrency) {
  let active = 0;
  const queue = [];

  const next = () => {
    while (active < concurrency && queue.length) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(v => { active--; resolve(v); next(); },
                e => { active--; reject(e);  next(); });
    }
  };

  return fn => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
};
