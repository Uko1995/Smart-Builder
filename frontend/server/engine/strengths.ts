/**
 * Time-weighted attack and defence ratios.
 *
 * Attack and defence are ratios of a team's time-weighted scoring rate to the
 * competition average. Decay xi is 0.005 per day (half-life about 139 days).
 * Team rates are shrunk toward the league average by PRIOR_WEIGHT full-weight
 * matches. Only matches kicked off before the prediction cutoff are used.
 */

import { MAX_GOALS, normalisedMarginal, scoreProbability } from "@/server/engine/scoreline";

export const XI_PER_DAY = 0.005;
export const MIN_RATE = 0.05;
export const MAX_RATE = 6.0;
export const PRIOR_WEIGHT = 8.0;
export const RHO_GRID = Array.from({ length: 16 }, (_, index) => Math.round((-0.14 + index * 0.01) * 100) / 100);

const DAY_MS = 86_400_000;

export type HistoricalMatch = {
  matchId: string;
  leagueId: string;
  /** Kickoff as epoch milliseconds. */
  kickoff: number;
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
  homeCorners?: number | null;
  awayCorners?: number | null;
  homeCards?: number | null;
  awayCards?: number | null;
};

export type RateEstimate = {
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  rhoSource: string;
  homeMatches: number;
  awayMatches: number;
  leagueMatches: number;
  quality: number;
  clamped: boolean;
};

type Reader = (match: HistoricalMatch) => number | null | undefined;

export function sampleQuality(matches: number, fullSample = 30): number {
  if (matches <= 0) return 0;
  return Math.min(1, matches / fullSample);
}

function weight(cutoff: number, kickoff: number): number {
  return Math.exp(-XI_PER_DAY * Math.max(0, (cutoff - kickoff) / DAY_MS));
}

function ratesFromHistory(
  history: HistoricalMatch[],
  homeId: string,
  awayId: string,
  cutoff: number,
  homeValue: Reader,
  awayValue: Reader,
  minMatches: number,
  rho: number,
  rhoSource: string,
): RateEstimate | null {
  let leagueWeight = 0;
  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;
  let usableCount = 0;
  let homeWeight = 0;
  let homeScored = 0;
  let homeConceded = 0;
  let homeCount = 0;
  let awayWeight = 0;
  let awayScored = 0;
  let awayConceded = 0;
  let awayCount = 0;
  for (const match of history) {
    if (match.kickoff >= cutoff) continue;
    const scoredHome = homeValue(match);
    const scoredAway = awayValue(match);
    if (scoredHome === null || scoredHome === undefined || scoredAway === null || scoredAway === undefined) continue;
    const w = weight(cutoff, match.kickoff);
    usableCount += 1;
    leagueWeight += w;
    leagueHomeGoals += w * scoredHome;
    leagueAwayGoals += w * scoredAway;
    if (match.homeId === homeId) {
      homeWeight += w;
      homeScored += w * scoredHome;
      homeConceded += w * scoredAway;
      homeCount += 1;
    }
    if (match.awayId === awayId) {
      awayWeight += w;
      awayScored += w * scoredAway;
      awayConceded += w * scoredHome;
      awayCount += 1;
    }
  }
  if (leagueWeight === 0) return null;
  const leagueHomeAvg = Math.max(leagueHomeGoals / leagueWeight, 0.2);
  const leagueAwayAvg = Math.max(leagueAwayGoals / leagueWeight, 0.2);
  if (homeCount < minMatches || homeWeight === 0 || awayCount < minMatches || awayWeight === 0) return null;
  const homeTotal = homeWeight + PRIOR_WEIGHT;
  const awayTotal = awayWeight + PRIOR_WEIGHT;
  const homeScoredRate = (homeScored + PRIOR_WEIGHT * leagueHomeAvg) / homeTotal;
  const homeConcededRate = (homeConceded + PRIOR_WEIGHT * leagueAwayAvg) / homeTotal;
  const awayScoredRate = (awayScored + PRIOR_WEIGHT * leagueAwayAvg) / awayTotal;
  const awayConcededRate = (awayConceded + PRIOR_WEIGHT * leagueHomeAvg) / awayTotal;
  const attackHome = homeScoredRate / leagueHomeAvg;
  const defenceHome = homeConcededRate / leagueAwayAvg;
  const attackAway = awayScoredRate / leagueAwayAvg;
  const defenceAway = awayConcededRate / leagueHomeAvg;
  let lambdaHome = leagueHomeAvg * attackHome * defenceAway;
  let lambdaAway = leagueAwayAvg * attackAway * defenceHome;
  const clamped = lambdaHome < MIN_RATE || lambdaHome > MAX_RATE || lambdaAway < MIN_RATE || lambdaAway > MAX_RATE;
  lambdaHome = Math.min(MAX_RATE, Math.max(MIN_RATE, lambdaHome));
  lambdaAway = Math.min(MAX_RATE, Math.max(MIN_RATE, lambdaAway));
  return {
    lambdaHome,
    lambdaAway,
    rho,
    rhoSource,
    homeMatches: homeCount,
    awayMatches: awayCount,
    leagueMatches: usableCount,
    quality: sampleQuality(Math.min(homeCount, awayCount)),
    clamped,
  };
}

const goalsHome: Reader = (match) => match.homeGoals;
const goalsAway: Reader = (match) => match.awayGoals;

/** Pass rho when it was already selected for this league at or before the cutoff. */
export function estimateGoalRates(
  history: HistoricalMatch[],
  homeId: string,
  awayId: string,
  cutoff: number,
  minMatches: number,
  rhoMinMatches: number,
  rho?: number,
): RateEstimate | null {
  const base = ratesFromHistory(history, homeId, awayId, cutoff, goalsHome, goalsAway, minMatches, 0, "withheld");
  if (base === null) return null;
  if (base.leagueMatches < rhoMinMatches) return base;
  return { ...base, rho: rho ?? selectRho(history, cutoff), rhoSource: "estimated" };
}

function byKickoff(left: HistoricalMatch, right: HistoricalMatch): number {
  if (left.kickoff !== right.kickoff) return left.kickoff - right.kickoff;
  return left.matchId < right.matchId ? -1 : left.matchId > right.matchId ? 1 : 0;
}

/**
 * Pick rho by chronological validation inside the pre-cutoff sample. The last
 * 20 percent of pre-cutoff matches is the validation slice.
 */
export function selectRho(history: HistoricalMatch[], cutoff: number): number {
  const prior = history.filter((match) => match.kickoff < cutoff).sort(byKickoff);
  if (prior.length < 20) return 0;
  const split = Math.floor(prior.length * 0.8);
  const validation = prior.slice(split);
  const train = prior.slice(0, split);
  if (!validation.length || !train.length) return 0;
  const estimates: { match: HistoricalMatch; estimate: RateEstimate; home: number[]; away: number[] }[] = [];
  for (const match of validation) {
    const estimate = ratesFromHistory(train, match.homeId, match.awayId, match.kickoff, goalsHome, goalsAway, 1, 0, "candidate");
    if (estimate !== null && match.homeGoals <= MAX_GOALS && match.awayGoals <= MAX_GOALS) {
      estimates.push({
        match,
        estimate,
        home: normalisedMarginal(estimate.lambdaHome),
        away: normalisedMarginal(estimate.lambdaAway),
      });
    }
  }
  let bestRho = 0;
  let bestScore: number | null = null;
  for (const rho of RHO_GRID) {
    let score = 0;
    let used = 0;
    for (const { match, estimate, home, away } of estimates) {
      const probability = scoreProbability(home, away, estimate.lambdaHome, estimate.lambdaAway, rho, match.homeGoals, match.awayGoals);
      score += Math.log(Math.max(probability, 1e-12));
      used += 1;
    }
    if (used === 0) continue;
    const mean = score / used;
    if (bestScore === null || mean > bestScore + 1e-12) {
      bestScore = mean;
      bestRho = rho;
    } else if (Math.abs(mean - bestScore) <= 1e-12) {
      if (Math.abs(rho) < Math.abs(bestRho) || (Math.abs(rho) === Math.abs(bestRho) && rho < bestRho)) bestRho = rho;
    }
  }
  return bestRho;
}

export type CountKind = "corners" | "cards" | "first_half";

const COUNT_READERS: Record<CountKind, [Reader, Reader]> = {
  corners: [(match) => match.homeCorners, (match) => match.awayCorners],
  cards: [(match) => match.homeCards, (match) => match.awayCards],
  first_half: [(match) => match.htHomeGoals, (match) => match.htAwayGoals],
};

export function estimateCountRates(
  history: HistoricalMatch[],
  homeId: string,
  awayId: string,
  cutoff: number,
  minMatches: number,
  kind: CountKind,
): RateEstimate | null {
  const [homeValue, awayValue] = COUNT_READERS[kind];
  return ratesFromHistory(history, homeId, awayId, cutoff, homeValue, awayValue, minMatches, 0, "not_used");
}
