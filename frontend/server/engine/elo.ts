/**
 * Club Elo ratings computed from stored results, one rating pool per league.
 *
 * Updates follow the World Football Elo convention: K scaled by a goal-difference
 * multiplier, with a home advantage that is itself updated after every match.
 * Teams entering a pool (promoted sides, new data) start at a low percentile of
 * the current ratings. After a long break a rating regresses part-way to the mean.
 * An ordered logit, fitted per league on pre-match rating differences, turns a
 * rating difference into home, draw and away probabilities.
 */

import type { HistoricalMatch } from "@/server/engine/strengths";

const DAY_MS = 86_400_000;

export const ELO_PARAMS = {
  start: 1500,
  k: 20,
  homeStart: 60,
  /** 0 keeps home advantage fixed; the per-league logit thresholds absorb league differences. Backtested slightly better. */
  homeRate: 0,
  entrantPercentile: 0.2,
  breakDays: 60,
  breakRegression: 0.2,
  /** Both teams need this many pool matches before a match is used for fitting or a probability is given. */
  minTeamMatches: 15,
  minFitSamples: 200,
};

export type EloParams = typeof ELO_PARAMS;
export type Outcome = 0 | 1 | 2; // away, draw, home
export type EloSample = { x: number; y: Outcome };
export type OrderedLogit = { theta1: number; theta2: number; beta: number; samples: number };
export type Probabilities1x2 = { home: number; draw: number; away: number };

export function goalMultiplier(goalDifference: number): number {
  const gd = Math.abs(goalDifference);
  if (gd <= 1) return 1;
  if (gd === 2) return 1.5;
  return (11 + gd) / 8;
}

export function outcomeOf(homeGoals: number, awayGoals: number): Outcome {
  return homeGoals > awayGoals ? 2 : homeGoals === awayGoals ? 1 : 0;
}

type TeamState = { rating: number; matches: number; last: number };

export class EloPool {
  private teams = new Map<string, TeamState>();
  homeAdvantage: number;
  matches = 0;

  constructor(private params: EloParams = ELO_PARAMS) {
    this.homeAdvantage = params.homeStart;
  }

  private mean(): number {
    if (!this.teams.size) return this.params.start;
    let total = 0;
    for (const team of this.teams.values()) total += team.rating;
    return total / this.teams.size;
  }

  private entrantRating(at: number): number {
    const active = [...this.teams.values()].filter((team) => at - team.last < 365 * DAY_MS).map((team) => team.rating);
    if (active.length < 10) return this.params.start;
    active.sort((a, b) => a - b);
    return active[Math.floor((active.length - 1) * this.params.entrantPercentile)];
  }

  private team(id: string, at: number): TeamState {
    let state = this.teams.get(id);
    if (!state) {
      state = { rating: this.entrantRating(at), matches: 0, last: at };
      this.teams.set(id, state);
    } else if (at - state.last > this.params.breakDays * DAY_MS) {
      const mean = this.mean();
      state.rating = mean + (state.rating - mean) * (1 - this.params.breakRegression);
      state.last = at;
    }
    return state;
  }

  /** Rating difference in units of 400 points, home advantage included. Null until both teams are established. */
  difference(homeId: string, awayId: string, at: number): number | null {
    const home = this.teams.get(homeId);
    const away = this.teams.get(awayId);
    if (!home || !away || home.matches < this.params.minTeamMatches || away.matches < this.params.minTeamMatches) return null;
    const mean = this.mean();
    const adjust = (team: TeamState) =>
      at - team.last > this.params.breakDays * DAY_MS ? mean + (team.rating - mean) * (1 - this.params.breakRegression) : team.rating;
    return (adjust(home) + this.homeAdvantage - adjust(away)) / 400;
  }

  /** Applies one result and returns the pre-match difference, or null if either team was not yet established. */
  update(match: HistoricalMatch): number | null {
    const home = this.team(match.homeId, match.kickoff);
    const away = this.team(match.awayId, match.kickoff);
    const established = home.matches >= this.params.minTeamMatches && away.matches >= this.params.minTeamMatches;
    const dr = home.rating + this.homeAdvantage - away.rating;
    const expected = 1 / (1 + 10 ** (-dr / 400));
    const actual = match.homeGoals > match.awayGoals ? 1 : match.homeGoals === match.awayGoals ? 0.5 : 0;
    const change = this.params.k * goalMultiplier(match.homeGoals - match.awayGoals) * (actual - expected);
    home.rating += change;
    away.rating -= change;
    this.homeAdvantage += change * this.params.homeRate;
    home.matches += 1;
    away.matches += 1;
    home.last = match.kickoff;
    away.last = match.kickoff;
    this.matches += 1;
    return established ? dr / 400 : null;
  }
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

export function logitProbabilities(fit: OrderedLogit, x: number): Probabilities1x2 {
  const away = sigmoid(fit.theta1 - fit.beta * x);
  const notHome = sigmoid(fit.theta2 - fit.beta * x);
  return { home: 1 - notHome, draw: Math.max(1e-9, notHome - away), away };
}

/** Maximum likelihood by gradient ascent. The ordered logit log-likelihood is concave, so this converges. */
export function fitOrderedLogit(samples: EloSample[], minSamples = ELO_PARAMS.minFitSamples): OrderedLogit | null {
  if (samples.length < minSamples) return null;
  const counts = [0, 0, 0];
  for (const sample of samples) counts[sample.y] += 1;
  if (counts.some((count) => count === 0)) return null;
  const n = samples.length;
  let theta1 = Math.log(counts[0] / (n - counts[0]));
  let theta2 = Math.log((counts[0] + counts[1]) / counts[2]);
  let beta = 1;
  const rate = 2;
  for (let iteration = 0; iteration < 400; iteration += 1) {
    let g1 = 0;
    let g2 = 0;
    let gb = 0;
    for (const { x, y } of samples) {
      const a = sigmoid(theta1 - beta * x);
      const b = sigmoid(theta2 - beta * x);
      if (y === 0) {
        g1 += 1 - a;
        gb -= x * (1 - a);
      } else if (y === 2) {
        g2 -= b;
        gb += x * b;
      } else {
        const gap = Math.max(1e-9, b - a);
        g1 -= (a * (1 - a)) / gap;
        g2 += (b * (1 - b)) / gap;
        gb += (x * (a * (1 - a) - b * (1 - b))) / gap;
      }
    }
    theta1 += (rate * g1) / n;
    theta2 = Math.max(theta1 + 1e-3, theta2 + (rate * g2) / n);
    beta += (rate * gb) / n;
    if (Math.abs(g1) / n + Math.abs(g2) / n + Math.abs(gb) / n < 1e-7) break;
  }
  return { theta1, theta2, beta, samples: n };
}

export type LeagueElo = {
  pool: EloPool;
  fit: OrderedLogit | null;
  predict: (homeId: string, awayId: string, at: number) => Probabilities1x2 | null;
};

/** Ratings and probability mapping from matches before the cutoff only. */
export function buildLeagueElo(matches: HistoricalMatch[], cutoff: number, params: EloParams = ELO_PARAMS): LeagueElo {
  const ordered = matches.filter((match) => match.kickoff < cutoff).sort((a, b) => a.kickoff - b.kickoff);
  const pool = new EloPool(params);
  const samples: EloSample[] = [];
  for (const match of ordered) {
    const x = pool.update(match);
    if (x !== null) samples.push({ x, y: outcomeOf(match.homeGoals, match.awayGoals) });
  }
  const fit = fitOrderedLogit(samples, params.minFitSamples);
  return {
    pool,
    fit,
    predict: (homeId, awayId, at) => {
      if (!fit) return null;
      const x = pool.difference(homeId, awayId, at);
      return x === null ? null : logitProbabilities(fit, x);
    },
  };
}

/** Elo probability for a 1X2-family selection, or null for markets Elo does not price. */
export function eloSelectionProbability(probabilities: Probabilities1x2, marketKey: string, selection: string): number | null {
  const { home, draw, away } = probabilities;
  if (marketKey === "match_result") return selection === "home" ? home : selection === "draw" ? draw : selection === "away" ? away : null;
  if (marketKey === "double_chance") {
    if (selection === "home_or_draw") return home + draw;
    if (selection === "draw_or_away") return draw + away;
    if (selection === "home_or_away") return home + away;
    return null;
  }
  if (marketKey === "draw_no_bet") {
    if (selection === "home") return home / (home + away);
    if (selection === "away") return away / (home + away);
  }
  return null;
}
