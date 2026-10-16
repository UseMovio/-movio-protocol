// Pure number formatting for the market board.
const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
const sub = (n) => String(n).split('').map((d) => SUB[+d]).join('');

export const DASH = '—';

export function fmtPrice(p) {
  if (!Number.isFinite(p)) return DASH;
  if (p === 0) return '$0';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.01) return '$' + p.toFixed(4);
  const exp = Math.floor(Math.log10(p));
  const zeros = -exp - 1;
  let digits = Math.round(p / Math.pow(10, exp) * 1000);
  let z = zeros;
  if (digits >= 10000) { digits = Math.round(digits / 10); z -= 1; }
  const body = String(digits).padStart(4, '0');
  return z >= 3 ? `$0.0${sub(z)}${body}` : `$0.${'0'.repeat(Math.max(z, 0))}${body}`;
}

export function fmtCompact(n) {
  if (!Number.isFinite(n)) return DASH;
  return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: n >= 1e5 ? 2 : 1 }).format(n);
}

export function fmtPct(n) {
  if (!Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  const body = a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(2);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${body}%`;
}

export const arrow = (n) => (n > 0 ? '▲ ' : n < 0 ? '▼ ' : '');
