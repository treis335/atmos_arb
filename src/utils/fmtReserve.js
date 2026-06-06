// src/utils/fmtReserve.js — formata valor de reserva para exibição
function fmtReserve(v) {
  if (!v || !isFinite(v)) return '0';
  if (v >= 1e9)  return (v / 1e9).toFixed(1)  + 'B';
  if (v >= 1e6)  return (v / 1e6).toFixed(1)  + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
  if (v >= 1)    return v.toFixed(1);
  if (v >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}
module.exports = fmtReserve;
