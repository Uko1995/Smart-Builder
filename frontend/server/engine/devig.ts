/**
 * Removing the bookmaker margin from a complete set of prices.
 *
 * Proportional normalisation spreads the margin evenly, which overstates
 * longshots. The power method raises each implied probability to an exponent k
 * so they sum to one; Shin's method models a share z of insider money. Both put
 * more of the margin on longshots, which matches how books shade prices.
 */

function implied(odds: number[]): number[] | null {
  if (odds.length < 2 || odds.some((price) => !Number.isFinite(price) || price <= 1)) return null;
  return odds.map((price) => 1 / price);
}

/** Bisection on a function that is monotone over [low, high]. */
function solve(f: (x: number) => number, low: number, high: number): number {
  let a = low;
  let b = high;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const mid = (a + b) / 2;
    if (f(a) * f(mid) <= 0) b = mid;
    else a = mid;
    if (b - a < 1e-12) break;
  }
  return (a + b) / 2;
}

export function proportional(odds: number[]): number[] | null {
  const r = implied(odds);
  if (!r) return null;
  const total = r.reduce((sum, value) => sum + value, 0);
  return r.map((value) => value / total);
}

/** Power method: p_i = r_i^k with k chosen so the p_i sum to one. */
export function power(odds: number[]): number[] | null {
  const r = implied(odds);
  if (!r) return null;
  const total = r.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) < 1e-12) return r;
  const k = solve((x) => r.reduce((sum, value) => sum + value ** x, 0) - 1, 0.01, 10);
  const p = r.map((value) => value ** k);
  const norm = p.reduce((sum, value) => sum + value, 0);
  return p.map((value) => value / norm);
}

/** Shin (1993), with z found so the probabilities sum to one. */
export function shin(odds: number[]): number[] | null {
  const r = implied(odds);
  if (!r) return null;
  const total = r.reduce((sum, value) => sum + value, 0);
  if (total <= 1) return proportional(odds);
  const probabilities = (z: number) => r.map((value) => (Math.sqrt(z * z + 4 * (1 - z) * (value * value) / total) - z) / (2 * (1 - z)));
  const z = solve((x) => probabilities(x).reduce((sum, value) => sum + value, 0) - 1, 0, 0.5);
  const p = probabilities(z);
  const norm = p.reduce((sum, value) => sum + value, 0);
  return p.map((value) => value / norm);
}

export type DevigMethod = "power" | "shin" | "proportional";

export function devig(odds: number[], method: DevigMethod = "power"): number[] | null {
  return method === "power" ? power(odds) : method === "shin" ? shin(odds) : proportional(odds);
}
