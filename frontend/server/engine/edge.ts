/**
 * Edge measurement against the closing market: stake sizing, closing-line value,
 * opinion pooling and bootstrap intervals. Pure functions only.
 */

export const KELLY_FRACTION = 0.25;
export const MAX_STAKE_FRACTION = 0.05;
/** Pinnacle closing prices in football-data.co.uk are unreliable from this date. */
export const PINNACLE_CUTOFF = Date.UTC(2025, 6, 23);

/** Quarter Kelly as a fraction of bankroll, capped. Zero when the bet has no edge. */
export function kellyStake(probability: number, odds: number, fraction = KELLY_FRACTION, cap = MAX_STAKE_FRACTION): number {
  if (!(odds > 1) || !(probability > 0)) return 0;
  const full = (probability * odds - 1) / (odds - 1);
  return full <= 0 ? 0 : Math.min(cap, fraction * full);
}

/** Expected return of a price taken, measured at the fair closing probability. */
export function closingLineValue(priceTaken: number, fairClosingProbability: number): number {
  return priceTaken * fairClosingProbability - 1;
}

export function multiLogLoss(probabilities: number[], outcome: number): number {
  return -Math.log(Math.max(1e-12, probabilities[outcome]));
}

/** Seeded generator so reported intervals are reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Interval = { estimate: number; low: number; high: number };

function percentile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * Percentile bootstrap for a ratio of sums, sum(numerator) / sum(denominator).
 * With a denominator of ones this is the mean.
 */
export function bootstrapRatio(numerator: number[], denominator: number[] | null, reps = 1000, seed = 7): Interval | null {
  const n = numerator.length;
  if (n < 2) return null;
  const den = denominator ?? new Array<number>(n).fill(1);
  const ratio = (indices: ArrayLike<number>) => {
    let top = 0;
    let bottom = 0;
    for (let i = 0; i < indices.length; i += 1) {
      top += numerator[indices[i]];
      bottom += den[indices[i]];
    }
    return bottom === 0 ? 0 : top / bottom;
  };
  const all = Array.from({ length: n }, (_, index) => index);
  const random = mulberry32(seed);
  const draws: number[] = [];
  const sample = new Uint32Array(n);
  for (let rep = 0; rep < reps; rep += 1) {
    for (let i = 0; i < n; i += 1) sample[i] = Math.floor(random() * n);
    draws.push(ratio(sample));
  }
  draws.sort((a, b) => a - b);
  return { estimate: ratio(all), low: percentile(draws, 0.025), high: percentile(draws, 0.975) };
}

/**
 * Log-linear opinion pool: p_k proportional to the product of source_k^w.
 * Weights are fitted by gradient ascent on the log-likelihood, which is concave in w.
 */
export function pool(sources: number[][], weights: number[]): number[] {
  const k = sources[0].length;
  const logs = new Array<number>(k).fill(0);
  for (let s = 0; s < sources.length; s += 1) {
    for (let j = 0; j < k; j += 1) logs[j] += weights[s] * Math.log(Math.max(1e-12, sources[s][j]));
  }
  const max = Math.max(...logs);
  const exps = logs.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

export function fitPool(rows: { sources: number[][]; outcome: number }[], iterations = 300, rate = 0.5): number[] | null {
  if (rows.length < 200) return null;
  const m = rows[0].sources.length;
  const weights = new Array<number>(m).fill(1 / m);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array<number>(m).fill(0);
    for (const row of rows) {
      const p = pool(row.sources, weights);
      for (let s = 0; s < m; s += 1) {
        let expected = 0;
        for (let j = 0; j < p.length; j += 1) expected += p[j] * Math.log(Math.max(1e-12, row.sources[s][j]));
        gradient[s] += Math.log(Math.max(1e-12, row.sources[s][row.outcome])) - expected;
      }
    }
    let change = 0;
    for (let s = 0; s < m; s += 1) {
      const step = (rate * gradient[s]) / rows.length;
      weights[s] = Math.max(0, weights[s] + step);
      change += Math.abs(step);
    }
    if (change < 1e-7) break;
  }
  return weights;
}

export type Candidate = { selection: number; probability: number; price: number };

/** The single best-value selection in a market, or null when none clears the threshold. */
export function chooseBet(candidates: Candidate[], threshold: number): (Candidate & { edge: number; stake: number }) | null {
  let best: (Candidate & { edge: number; stake: number }) | null = null;
  for (const candidate of candidates) {
    if (!(candidate.price > 1)) continue;
    const edge = candidate.probability * candidate.price - 1;
    if (edge <= threshold) continue;
    if (!best || edge > best.edge) best = { ...candidate, edge, stake: kellyStake(candidate.probability, candidate.price) };
  }
  return best;
}
