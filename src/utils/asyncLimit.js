// src/utils/asyncLimit.js — limita tasks async concorrentes
module.exports = function asyncLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (!queue.length || active >= concurrency) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(
      v => { active--; resolve(v); next(); },
      e => { active--; reject(e);  next(); }
    );
  };
  return fn => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
};
