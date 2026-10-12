/** Chronological evaluation. The final holdout is not used to choose rho. */

import { deriveGoalMarkets, unitsToNumber } from "@/server/engine/markets";
import { scorelineMatrix } from "@/server/engine/scoreline";
import { estimateGoalRates, type HistoricalMatch } from "@/server/engine/strengths";

const DAY_MS = 86_400_000;

export function brierScore(outcomes: number[], probabilities: number[]): number {
  let total = 0;
  for (let index = 0; index < outcomes.length; index += 1) total += (probabilities[index] - outcomes[index]) ** 2;
  return total / outcomes.length;
}

export function logLoss(outcomes: number[], probabilities: number[], eps = 1e-15): number {
  let total = 0;
  for (let index = 0; index < outcomes.length; index += 1) {
    const p = Math.min(1 - eps, Math.max(eps, probabilities[index]));
    total += outcomes[index] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return total / outcomes.length;
}

function binaryMetrics(probabilities: number[], outcomes: number[]) {
  if (outcomes.length < 20 || new Set(outcomes).size < 2) return { status: "insufficient_data", observations: outcomes.length };
  const clipped = probabilities.map((p) => Math.min(1 - 1e-6, Math.max(1e-6, p)));
  return {
    status: "estimated",
    observations: outcomes.length,
    brier_score: brierScore(outcomes, clipped),
    log_loss: logLoss(outcomes, clipped),
  };
}

function percentile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Quantile-binned reliability curve, the same binning as scikit-learn's calibration_curve. */
export function calibrationCurve(outcomes: number[], probabilities: number[], bins = 8) {
  const sorted = [...probabilities].sort((a, b) => a - b);
  const edges = Array.from({ length: bins + 1 }, (_, index) => percentile(sorted, index / bins));
  const inner = edges.slice(1, -1);
  const sums = new Array<number>(bins).fill(0);
  const trues = new Array<number>(bins).fill(0);
  const counts = new Array<number>(bins).fill(0);
  probabilities.forEach((p, index) => {
    let bin = 0;
    while (bin < inner.length && inner[bin] < p) bin += 1;
    sums[bin] += p;
    trues[bin] += outcomes[index];
    counts[bin] += 1;
  });
  const meanPredicted: number[] = [];
  const fractionPositive: number[] = [];
  for (let bin = 0; bin < bins; bin += 1) {
    if (counts[bin] === 0) continue;
    meanPredicted.push(sums[bin] / counts[bin]);
    fractionPositive.push(trues[bin] / counts[bin]);
  }
  return { meanPredicted, fractionPositive };
}

function calibration(probabilities: number[], outcomes: number[]) {
  const positives = outcomes.reduce((sum, value) => sum + value, 0);
  if (outcomes.length < 30 || positives < 5 || positives > outcomes.length - 5) {
    return { status: "insufficient_data", observations: outcomes.length };
  }
  const curve = calibrationCurve(outcomes, probabilities, 8);
  return {
    status: "estimated",
    observations: outcomes.length,
    mean_predicted: curve.meanPredicted,
    fraction_positive: curve.fractionPositive,
  };
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function walkForwardEvaluate(
  matches: HistoricalMatch[],
  options: { minMatches?: number; rhoMinMatches?: number; minimumTotal?: number; historyDays?: number | null; maxTest?: number | null } = {},
) {
  const minMatches = options.minMatches ?? 5;
  const rhoMinMatches = options.rhoMinMatches ?? 80;
  const minimumTotal = options.minimumTotal ?? 40;
  const historyDays = options.historyDays ?? null;
  const ordered = [...matches].sort((a, b) => a.kickoff - b.kickoff || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));
  if (ordered.length < minimumTotal) {
    return {
      status: "insufficient_data",
      observations: ordered.length,
      note: "The final holdout was not scored because the sample is too small.",
    };
  }
  const byLeague = new Map<string, HistoricalMatch[]>();
  for (const match of ordered) {
    const rows = byLeague.get(match.leagueId) ?? [];
    rows.push(match);
    byLeague.set(match.leagueId, rows);
  }
  const kickoffs = new Map([...byLeague].map(([league, rows]) => [league, rows.map((row) => row.kickoff)]));
  const prior = (match: HistoricalMatch) => {
    const keys = kickoffs.get(match.leagueId) as number[];
    const high = lowerBound(keys, match.kickoff);
    const low = historyDays === null ? 0 : lowerBound(keys, match.kickoff - historyDays * DAY_MS);
    return (byLeague.get(match.leagueId) as HistoricalMatch[]).slice(low, high);
  };
  const testStart = Math.floor(ordered.length * 0.8);
  let holdout = ordered.slice(testStart);
  if (options.maxTest && holdout.length > options.maxTest) holdout = holdout.slice(-options.maxTest);
  const last = ordered[testStart - 1];
  const probe = estimateGoalRates([...prior(last), last], last.homeId, last.awayId, last.kickoff + 1000, 1, rhoMinMatches);
  const frozenRho = probe === null || probe.rhoSource !== "estimated" ? 0 : probe.rho;
  const homeProbs: number[] = [];
  const homeOutcomes: number[] = [];
  const bttsProbs: number[] = [];
  const bttsOutcomes: number[] = [];
  const overProbs: number[] = [];
  const overOutcomes: number[] = [];
  const scoreLog: number[] = [];
  let skipped = 0;
  for (const match of holdout) {
    const estimate = estimateGoalRates(prior(match), match.homeId, match.awayId, match.kickoff, minMatches, 1e9);
    if (estimate === null) {
      skipped += 1;
      continue;
    }
    const matrix = scorelineMatrix(estimate.lambdaHome, estimate.lambdaAway, frozenRho);
    const derived = deriveGoalMarkets(matrix, false);
    const find = (market: string, selection: string, line: number | null) =>
      unitsToNumber((derived.find((item) => item.marketKey === market && item.selection === selection && item.line === line) as { units: number }).units);
    homeProbs.push(find("match_result", "home", null));
    homeOutcomes.push(match.homeGoals > match.awayGoals ? 1 : 0);
    bttsProbs.push(find("btts", "yes", null));
    bttsOutcomes.push(match.homeGoals >= 1 && match.awayGoals >= 1 ? 1 : 0);
    overProbs.push(find("over_under_goals", "over", 2.5));
    overOutcomes.push(match.homeGoals + match.awayGoals >= 3 ? 1 : 0);
    if (match.homeGoals < matrix.length && match.awayGoals < matrix[0].length) {
      scoreLog.push(Math.log(Math.max(matrix[match.homeGoals][match.awayGoals], 1e-12)));
    }
  }
  const observations = homeProbs.length;
  return {
    status: observations >= 20 ? "estimated" : "insufficient_data",
    observations,
    skipped,
    holdout_start_index: ordered.length - holdout.length,
    frozen_rho: frozenRho,
    rho_note: "Rho was selected only on matches before the final holdout, then frozen.",
    home_win: binaryMetrics(homeProbs, homeOutcomes),
    btts_yes: binaryMetrics(bttsProbs, bttsOutcomes),
    over_2_5: binaryMetrics(overProbs, overOutcomes),
    home_win_calibration: calibration(homeProbs, homeOutcomes),
    mean_scoreline_log_score: scoreLog.length ? scoreLog.reduce((sum, value) => sum + value, 0) / scoreLog.length : null,
    disclaimer: "Historical scores do not estimate future profit. No odds were used in this probability check.",
  };
}

export type CalibrationRow = {
  marketKey: string;
  probability: number;
  implied: number | null;
  elo: number | null;
  priced: boolean;
  won: boolean;
};

type Score = { brier_score: number; log_loss: number };

function score(probabilities: number[], outcomes: number[]): Score {
  const clipped = probabilities.map((p) => Math.min(1 - 1e-6, Math.max(1e-6, p)));
  return { brier_score: brierScore(outcomes, clipped), log_loss: logLoss(outcomes, clipped) };
}

function hitRate(rows: CalibrationRow[]) {
  if (!rows.length) return { observations: 0, mean_probability: null, hit_rate: null };
  return {
    observations: rows.length,
    mean_probability: rows.reduce((sum, row) => sum + row.probability, 0) / rows.length,
    hit_rate: rows.filter((row) => row.won).length / rows.length,
  };
}

/** Same rows scored by two sources, so the comparison is fair. Null until there are 20 such rows. */
function headToHead(rows: CalibrationRow[], other: (row: CalibrationRow) => number | null) {
  const paired = rows.filter((row) => other(row) !== null);
  if (paired.length < 20) return { status: "insufficient_data", observations: paired.length };
  const outcomes = paired.map((row) => (row.won ? 1 : 0));
  return {
    status: "estimated",
    observations: paired.length,
    model: score(paired.map((row) => row.probability), outcomes),
    other: score(paired.map((row) => other(row) as number), outcomes),
  };
}

/**
 * Settled-prediction calibration: does a 70% call win about 70% of the time?
 * Buckets are fixed 10-point bands of model probability. Picks are priced rows at or above the pick threshold.
 */
export function calibrationReport(rows: CalibrationRow[], minPickProbability: number) {
  const buckets = [];
  for (let low = 0; low < 1; low = Math.round((low + 0.1) * 10) / 10) {
    const high = Math.round((low + 0.1) * 10) / 10;
    const inBand = rows.filter((row) => row.probability >= low && (high >= 1 ? row.probability <= 1 : row.probability < high));
    if (inBand.length) buckets.push({ low, high, ...hitRate(inBand) });
  }
  const byMarket: Record<string, unknown> = {};
  for (const marketKey of [...new Set(rows.map((row) => row.marketKey))].sort()) {
    const group = rows.filter((row) => row.marketKey === marketKey);
    byMarket[marketKey] = {
      all: hitRate(group),
      picks: hitRate(group.filter((row) => row.priced && row.probability >= minPickProbability)),
    };
  }
  return {
    status: rows.length >= 20 ? "estimated" : "insufficient_data",
    observations: rows.length,
    min_pick_probability: minPickProbability,
    buckets,
    picks: hitRate(rows.filter((row) => row.priced && row.probability >= minPickProbability)),
    by_market: byMarket,
    model_vs_market: headToHead(rows, (row) => row.implied),
    model_vs_elo: headToHead(rows, (row) => row.elo),
    note: "Lower Brier score and log loss are better. Each match and selection is counted once, from its latest prediction.",
  };
}

/** Rows without a stored historical price are ignored rather than filled in. */
export function simulateUnitReturns(rows: { decimalOdds: number | null; won: boolean | null }[]) {
  const usable = rows.filter((row) => row.decimalOdds !== null && row.won !== null);
  if (usable.length < 30) {
    return {
      status: "insufficient_data",
      observations: usable.length,
      note: "Fewer than 30 priced settlements. No return is reported.",
    };
  }
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const row of usable) {
    equity += row.won ? (row.decimalOdds as number) - 1 : -1;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return {
    status: "simulated",
    observations: usable.length,
    profit_units: equity.toFixed(4),
    max_drawdown_units: maxDrawdown.toFixed(4),
    stake: "1 unit per settled selection",
    disclaimer: "Simulated staking is not a betting record and is not evidence of future profit.",
  };
}
