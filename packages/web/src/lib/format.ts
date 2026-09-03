export function formatPct(fraction: number, decimals = 2): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function formatSignedPct(fraction: number, decimals = 2): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

export function formatScore(value: number): string {
  return value.toFixed(1);
}
