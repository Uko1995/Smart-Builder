/** Derive market probabilities from one shared count distribution. */

import type { Matrix } from "@/server/engine/scoreline";

export type Predicate = (home: number, away: number) => boolean;

export const HALF_GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
export const HANDICAP_LINES = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
export const INTEGER_HANDICAP_LINES = [-2, -1, 0, 1, 2];
export const CORNER_LINES = [7.5, 8.5, 9.5, 10.5, 11.5];
export const TEAM_CORNER_LINES = [3.5, 4.5, 5.5];
export const CARD_LINES = [2.5, 3.5, 4.5, 5.5];

const UNITS = 100_000_000;

export type DerivedEntry = {
  marketKey: string;
  selection: string;
  line: number | null;
  /** Probability in 1e-8 units, so partitions add up exactly. */
  units: number;
  details: Record<string, unknown>;
};

/** Round to 8 decimals the way the stored numeric(12,8) column will hold it. */
export function quantizeUnits(value: number): number {
  let probability = value;
  if (probability < 0 && probability > -1e-10) probability = 0;
  if (probability < 0 || probability > 1.0000001) throw new Error(`probability out of range: ${value}`);
  return Math.round(Number(probability.toFixed(8)) * UNITS);
}

export function unitsToString(units: number): string {
  const sign = units < 0 ? "-" : "";
  const absolute = Math.abs(units);
  const whole = Math.floor(absolute / UNITS);
  const fraction = String(absolute % UNITS).padStart(8, "0");
  return `${sign}${whole}.${fraction}`;
}

export function unitsToNumber(units: number): number {
  return units / UNITS;
}

function roundHalfUp(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

export function fairOdds(units: number): string | null {
  if (units <= 0) return null;
  return roundHalfUp(UNITS / units, 4).toFixed(4);
}

export function rawImpliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 1) throw new Error("decimal odds must be greater than 1");
  return roundHalfUp(1 / decimalOdds, 8);
}

/**
 * Share of this price after removing the bookmaker overround. siblingOdds must
 * be the mutually exclusive outcomes, including this price. One price alone
 * falls back to 1 / odds.
 */
export function deviggedProbability(decimalOdds: number, siblingOdds: number[]): number {
  const raw = rawImpliedProbability(decimalOdds);
  if (siblingOdds.length < 2) return raw;
  const total = siblingOdds.reduce((sum, price) => sum + rawImpliedProbability(price), 0);
  if (total <= 0) return raw;
  return roundHalfUp(raw / total, 8);
}

export function sumWhere(matrix: Matrix, predicate: Predicate): number {
  let total = 0;
  for (let home = 0; home < matrix.length; home += 1) {
    const row = matrix[home];
    for (let away = 0; away < row.length; away += 1) {
      if (predicate(home, away)) total += row[away];
    }
  }
  return total;
}

export function entry(
  marketKey: string,
  selection: string,
  line: number | null,
  probability: number,
  details: Record<string, unknown> = {},
): DerivedEntry {
  return { marketKey, selection, line, units: quantizeUnits(probability), details };
}

/** Mutually exclusive outcomes: push rounding drift onto the largest so they sum to exactly 1. */
export function partition(entries: DerivedEntry[]): DerivedEntry[] {
  const total = entries.reduce((sum, item) => sum + item.units, 0);
  const drift = UNITS - total;
  if (Math.abs(drift) > 10_000) throw new Error(`mutually exclusive outcomes drifted by ${drift / UNITS}`);
  if (entries.length) {
    let largest = entries[0];
    for (const item of entries) if (item.units > largest.units) largest = item;
    largest.units += drift;
  }
  return entries;
}

function overUnder(matrix: Matrix, marketKey: string, line: number, value: (h: number, a: number) => number): DerivedEntry[] {
  return partition([
    entry(marketKey, "over", line, sumWhere(matrix, (h, a) => value(h, a) > line)),
    entry(marketKey, "under", line, sumWhere(matrix, (h, a) => value(h, a) < line)),
  ]);
}

export function goalPredicate(marketKey: string, selection: string, line: number | null): Predicate | null {
  switch (marketKey) {
    case "match_result":
    case "first_half_result":
      return ({ home: (h, a) => h > a, draw: (h, a) => h === a, away: (h, a) => h < a } as Record<string, Predicate>)[selection] ?? null;
    case "double_chance":
      return (
        ({ home_or_draw: (h, a) => h >= a, home_or_away: (h, a) => h !== a, draw_or_away: (h, a) => h <= a } as Record<string, Predicate>)[
          selection
        ] ?? null
      );
    case "draw_no_bet":
      if (selection === "home") return (h, a) => h > a;
      if (selection === "away") return (h, a) => h < a;
      return null;
    case "over_under_goals":
    case "first_half_over_under":
      if (line === null) throw new Error("line is required");
      if (selection === "over") return (h, a) => h + a > line;
      if (selection === "under") return (h, a) => h + a < line;
      return null;
    case "btts":
      if (selection === "yes") return (h, a) => h >= 1 && a >= 1;
      if (selection === "no") return (h, a) => h === 0 || a === 0;
      return null;
    case "asian_handicap":
    case "asian_handicap_integer":
      if (line === null) throw new Error("line is required");
      if (selection === "home") return (h, a) => h + line > a;
      if (selection === "away") return (h, a) => a - line > h;
      return null;
    case "correct_score": {
      const [homeScore, awayScore] = selection.split("-").map(Number);
      return (h, a) => h === homeScore && a === awayScore;
    }
    case "team_total_home":
      if (line === null) throw new Error("line is required");
      if (selection === "over") return (h) => h > line;
      if (selection === "under") return (h) => h < line;
      return null;
    case "team_total_away":
      if (line === null) throw new Error("line is required");
      if (selection === "over") return (_h, a) => a > line;
      if (selection === "under") return (_h, a) => a < line;
      return null;
    default:
      return null;
  }
}

export function integerPushPredicate(selection: string, line: number): Predicate {
  if (selection === "home") return (h, a) => h + line === a;
  if (selection === "away") return (h, a) => a - line === h;
  throw new Error(selection);
}

export function deriveGoalMarkets(matrix: Matrix, includeExperimental = true): DerivedEntry[] {
  const derived: DerivedEntry[] = [];
  derived.push(
    ...partition([
      entry("match_result", "home", null, sumWhere(matrix, (h, a) => h > a)),
      entry("match_result", "draw", null, sumWhere(matrix, (h, a) => h === a)),
      entry("match_result", "away", null, sumWhere(matrix, (h, a) => h < a)),
    ]),
  );
  // Double-chance selections overlap, so they are not a partition.
  derived.push(
    entry("double_chance", "home_or_draw", null, sumWhere(matrix, (h, a) => h >= a)),
    entry("double_chance", "home_or_away", null, sumWhere(matrix, (h, a) => h !== a)),
    entry("double_chance", "draw_or_away", null, sumWhere(matrix, (h, a) => h <= a)),
  );
  const homeWin = sumWhere(matrix, (h, a) => h > a);
  const awayWin = sumWhere(matrix, (h, a) => h < a);
  const draw = sumWhere(matrix, (h, a) => h === a);
  const decisive = homeWin + awayWin;
  if (decisive > 0) {
    const shared = { push_probability: unitsToString(quantizeUnits(draw)), interpretation: "conditional_on_no_draw" };
    derived.push(
      entry("draw_no_bet", "home", null, homeWin / decisive, { win_probability: unitsToString(quantizeUnits(homeWin)), ...shared }),
      entry("draw_no_bet", "away", null, awayWin / decisive, { win_probability: unitsToString(quantizeUnits(awayWin)), ...shared }),
    );
  }
  for (const line of HALF_GOAL_LINES) {
    derived.push(...overUnder(matrix, "over_under_goals", line, (h, a) => h + a));
    derived.push(...overUnder(matrix, "team_total_home", line, (h) => h));
    derived.push(...overUnder(matrix, "team_total_away", line, (_h, a) => a));
  }
  derived.push(
    ...partition([
      entry("btts", "yes", null, sumWhere(matrix, (h, a) => h >= 1 && a >= 1)),
      entry("btts", "no", null, sumWhere(matrix, (h, a) => h === 0 || a === 0)),
    ]),
  );
  for (const line of HANDICAP_LINES) {
    derived.push(
      ...partition([
        entry("asian_handicap", "home", line, sumWhere(matrix, (h, a) => h + line > a)),
        entry("asian_handicap", "away", line, sumWhere(matrix, (h, a) => a - line > h)),
      ]),
    );
  }
  if (includeExperimental) {
    for (const line of INTEGER_HANDICAP_LINES) {
      for (const selection of ["home", "away"]) {
        const win = goalPredicate("asian_handicap_integer", selection, line) as Predicate;
        derived.push(
          entry("asian_handicap_integer", selection, line, sumWhere(matrix, win), {
            push_probability: unitsToString(quantizeUnits(sumWhere(matrix, integerPushPredicate(selection, line)))),
            implementation_status: "experimental",
          }),
        );
      }
    }
  }
  for (let home = 0; home < Math.min(5, matrix.length); home += 1) {
    for (let away = 0; away < Math.min(5, matrix[home].length); away += 1) {
      const probability = matrix[home][away];
      if (probability < 0.01) continue;
      derived.push(entry("correct_score", `${home}-${away}`, null, probability));
    }
  }
  return derived;
}

export function deriveTotalMarkets(
  matrix: Matrix,
  marketKey: string,
  lines: number[],
  homeMarketKey?: string,
  awayMarketKey?: string,
  homeLines: number[] = [],
  awayLines: number[] = [],
): DerivedEntry[] {
  const derived: DerivedEntry[] = [];
  for (const line of lines) derived.push(...overUnder(matrix, marketKey, line, (h, a) => h + a));
  if (homeMarketKey) for (const line of homeLines) derived.push(...overUnder(matrix, homeMarketKey, line, (h) => h));
  if (awayMarketKey) for (const line of awayLines) derived.push(...overUnder(matrix, awayMarketKey, line, (_h, a) => a));
  return derived;
}

export function deriveFirstHalfMarkets(matrix: Matrix): DerivedEntry[] {
  const entries = partition([
    entry("first_half_result", "home", null, sumWhere(matrix, (h, a) => h > a)),
    entry("first_half_result", "draw", null, sumWhere(matrix, (h, a) => h === a)),
    entry("first_half_result", "away", null, sumWhere(matrix, (h, a) => h < a)),
  ]);
  for (const line of [0.5, 1.5, 2.5]) entries.push(...overUnder(matrix, "first_half_over_under", line, (h, a) => h + a));
  return entries;
}

export function countPredicate(marketKey: string, selection: string, line: number | null): Predicate | null {
  if (line === null) return null;
  const side = (
    {
      match_corners: "total",
      match_cards: "total",
      team_corners_home: "home",
      team_cards_home: "home",
      team_corners_away: "away",
      team_cards_away: "away",
    } as Record<string, "total" | "home" | "away">
  )[marketKey];
  if (!side) return null;
  return (home, away) => {
    const value = side === "total" ? home + away : side === "home" ? home : away;
    if (selection === "over") return value > line;
    if (selection === "under") return value < line;
    throw new Error(selection);
  };
}
