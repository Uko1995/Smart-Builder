/**
 * Paper betting bot. Each run picks bets for several strategies at prices from the bookmakers
 * you can use, records them before kick-off in the append-only `paper_bets` table, and the report
 * settles them from results and measures them against the closing line. No money moves.
 */

import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import { devig } from "@/server/engine/devig";
import { bootstrapRatio, chooseBet, closingLineValue } from "@/server/engine/edge";
import { iso } from "@/server/http";
import { benchmark, quotePrices, type Market } from "@/server/services/backtest";
import { latestBatchForDate, REFERENCE_BOOKS } from "@/server/services/picks";
import { effectiveSettings } from "@/server/services/reference";

export const SELECTIONS: Record<Market, string[]> = { "1x2": ["home", "draw", "away"], ou25: ["over", "under"] };
export const VALUE_THRESHOLD = 0.05;
export const FAVOURITE_FLOOR = 0.65;
export const FAVOURITE_MIN_PRICE = 1.25;
export const FAVOURITE_STAKE_FRACTION = 0.01;
const SHARP_BOOKS = ["betfair_exchange", "pinnacle", "market_average"];

export const STRATEGIES = {
  sharp_value: {
    name: "Sharp price vs your bookmakers",
    rule: "Fair chance from the exchange or Pinnacle price (margin removed); bet when your bookmaker pays 5%+ more than it is worth. Quarter Kelly.",
  },
  model_value: {
    name: "Model value",
    rule: "Fair chance from our goals model; bet when your bookmaker pays 5%+ more than it is worth. Quarter Kelly.",
  },
  favourites: {
    name: "Strong favourites",
    rule: `Most likely outcome at ${FAVOURITE_FLOOR * 100}%+ (market estimate, else model), price ${FAVOURITE_MIN_PRICE}+. Flat 1% of bankroll.`,
  },
} as const;
export type Strategy = keyof typeof STRATEGIES;

export type Price = { price: number; book: string; capturedAt: Date };

export type PaperInput = {
  market: Market;
  model: number[] | null;
  sharp: number[] | null;
  prices: (Price | null)[];
};

export type PaperDecision = { selection: number; probability: number; price: Price; edge: number; stakeFraction: number };

/** What a strategy would bet on one match market, or null. */
export function decide(strategy: Strategy, input: PaperInput): PaperDecision | null {
  const candidates = (probabilities: number[]) =>
    probabilities.map((probability, selection) => ({ selection, probability, price: input.prices[selection]?.price ?? 0 }));
  if (strategy === "favourites") {
    const estimate = input.sharp ?? input.model;
    if (!estimate) return null;
    const selection = estimate.indexOf(Math.max(...estimate));
    const price = input.prices[selection];
    if (estimate[selection] < FAVOURITE_FLOOR || !price || price.price < FAVOURITE_MIN_PRICE) return null;
    return { selection, probability: estimate[selection], price, edge: estimate[selection] * price.price - 1, stakeFraction: FAVOURITE_STAKE_FRACTION };
  }
  const probabilities = strategy === "sharp_value" ? input.sharp : input.model;
  if (!probabilities) return null;
  const choice = chooseBet(candidates(probabilities), VALUE_THRESHOLD);
  if (!choice || choice.stake <= 0) return null;
  return { selection: choice.selection, probability: choice.probability, price: input.prices[choice.selection] as Price, edge: choice.edge, stakeFraction: choice.stake };
}

export function settle(market: string, selection: string, homeGoals: number | null, awayGoals: number | null): boolean | null {
  if (homeGoals === null || awayGoals === null) return null;
  const total = homeGoals + awayGoals;
  if (market === "1x2") return selection === "home" ? homeGoals > awayGoals : selection === "draw" ? homeGoals === awayGoals : awayGoals > homeGoals;
  if (market === "ou25") return selection === "over" ? total >= 3 : total < 3;
  return null;
}

type Candidate = PaperInput & { fixtureId: number; kickoff: Date };

/** Match markets kicking off later on the scope date, with model, sharp and your-bookmaker prices. */
async function candidates(db: Db, settings: Settings, scope: string): Promise<Candidate[]> {
  const config = await effectiveSettings(db, settings);
  const batch = await latestBatchForDate(db, scope);
  const start = new Date(`${scope}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const fixtures = await db<{ id: number; kickoff_at: Date }[]>`
    SELECT id, kickoff_at FROM fixtures
    WHERE kickoff_at >= ${start} AND kickoff_at < ${end} AND kickoff_at > now() AND status = 'scheduled' AND data_origin <> 'synthetic_demo'`;
  if (!fixtures.length) return [];
  const ids = fixtures.map((fixture) => fixture.id);
  const byKey = new Map<string, Candidate>();
  for (const fixture of fixtures) {
    for (const market of ["1x2", "ou25"] as Market[]) {
      byKey.set(`${fixture.id}|${market}`, { fixtureId: fixture.id, kickoff: fixture.kickoff_at, market, model: null, sharp: null, prices: SELECTIONS[market].map(() => null) });
    }
  }
  if (batch) {
    const rows = await db<{ fixture_id: number; market_key: string; selection: string; probability: string }[]>`
      SELECT fixture_id, market_key, selection, probability FROM predictions
      WHERE batch_id = ${batch.id} AND fixture_id IN ${db(ids)} AND implementation_status = 'supported'
        AND (market_key = 'match_result' OR (market_key = 'over_under_goals' AND line = 2.5))`;
    for (const row of rows) {
      const market: Market = row.market_key === "match_result" ? "1x2" : "ou25";
      const item = byKey.get(`${row.fixture_id}|${market}`);
      const index = SELECTIONS[market].indexOf(row.selection);
      if (!item || index < 0) continue;
      (item.model ??= SELECTIONS[market].map(() => NaN))[index] = Number(row.probability);
    }
  }
  const referenceSince = new Date(Date.now() - Number(config.reference_odds_freshness_hours) * 3_600_000);
  const early = await db<{ fixture_id: number; bookmaker: string; captured_at: Date; home: string | null; draw: string | null; away: string | null; over_2_5: string | null; under_2_5: string | null }[]>`
    SELECT DISTINCT ON (fixture_id, bookmaker) fixture_id, bookmaker, captured_at, home, draw, away, over_2_5, under_2_5
    FROM market_prices WHERE fixture_id IN ${db(ids)} AND phase = 'early' AND captured_at >= ${referenceSince}
    ORDER BY fixture_id, bookmaker, captured_at DESC`;
  const num = (value: string | null) => (value === null ? null : Number(value));
  const sharpRank = new Map<string, number>();
  const fallback = new Map<string, (Price | null)[]>();
  for (const row of early) {
    const quote = { home: num(row.home), draw: num(row.draw), away: num(row.away), over: num(row.over_2_5), under: num(row.under_2_5) };
    for (const market of ["1x2", "ou25"] as Market[]) {
      const key = `${row.fixture_id}|${market}`;
      const item = byKey.get(key);
      const prices = quotePrices(quote, market);
      if (!item || !prices) continue;
      const rank = SHARP_BOOKS.indexOf(row.bookmaker);
      if (rank >= 0 && rank < (sharpRank.get(key) ?? Infinity)) {
        const fair = devig(prices, "power");
        if (fair) {
          item.sharp = fair;
          sharpRank.set(key, rank);
        }
      }
      if (row.bookmaker === "bet365") fallback.set(key, prices.map((price) => ({ price, book: "Bet365", capturedAt: row.captured_at })));
    }
  }
  const liveSince = new Date(Date.now() - Number(config.odds_freshness_minutes) * 60_000);
  const live = await db<{ fixture_id: number; key: string; name: string; market_key: string; selection: string; decimal_odds: string; captured_at: Date }[]>`
    SELECT DISTINCT ON (o.fixture_id, o.bookmaker_id, o.market_key, o.selection) o.fixture_id, b.key, b.name, o.market_key, o.selection, o.decimal_odds, o.captured_at
    FROM odds_snapshots o JOIN bookmakers b ON b.id = o.bookmaker_id
    WHERE o.fixture_id IN ${db(ids)} AND NOT b.is_synthetic AND o.data_origin <> 'synthetic_demo' AND o.captured_at >= ${liveSince}
      AND (o.market_key = 'match_result' OR (o.market_key = 'over_under_goals' AND o.line = 2.5))
    ORDER BY o.fixture_id, o.bookmaker_id, o.market_key, o.selection, o.captured_at DESC`;
  for (const row of live) {
    if (REFERENCE_BOOKS.has(row.key)) continue;
    const market: Market = row.market_key === "match_result" ? "1x2" : "ou25";
    const item = byKey.get(`${row.fixture_id}|${market}`);
    const index = SELECTIONS[market].indexOf(row.selection);
    if (!item || index < 0) continue;
    const price = Number(row.decimal_odds);
    const current = item.prices[index];
    if (!current || price > current.price) item.prices[index] = { price, book: row.name, capturedAt: row.captured_at };
  }
  for (const [key, item] of byKey) {
    if (item.model?.some((value) => !Number.isFinite(value))) item.model = null;
    if (item.prices.every((price) => price === null)) item.prices = fallback.get(key) ?? item.prices;
  }
  return [...byKey.values()].filter((item) => item.prices.some(Boolean));
}

type Logged = {
  id: number;
  strategy: Strategy;
  fixture_id: number;
  market: Market;
  selection: string;
  probability: string;
  price: string;
  bookmaker: string;
  edge: string;
  stake_units: string;
  kickoff_at: Date;
  recorded_at: Date;
  home_goals: number | null;
  away_goals: number | null;
  status: string;
  home: string | null;
  away: string | null;
  league: string | null;
};

async function loadBets(db: Db): Promise<Logged[]> {
  return db<Logged[]>`
    SELECT b.id, b.strategy, b.fixture_id, b.market, b.selection, b.probability, b.price, b.bookmaker, b.edge, b.stake_units,
           b.kickoff_at, b.recorded_at, f.home_goals, f.away_goals, f.status, h.name AS home, a.name AS away, l.name AS league
    FROM paper_bets b
    JOIN fixtures f ON f.id = b.fixture_id
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN leagues l ON l.id = f.league_id
    ORDER BY b.kickoff_at, b.id`;
}

function profitOf(bet: Logged): number | null {
  if (bet.status !== "completed") return null;
  const result = settle(bet.market, bet.selection, bet.home_goals, bet.away_goals);
  if (result === null) return null;
  const stake = Number(bet.stake_units);
  return result ? stake * (Number(bet.price) - 1) : -stake;
}

/** Records today's paper bets. Stakes are sized on each strategy's paper bankroll after settled results. */
export async function runPaperBets(db: Db, settings: Settings, scope: string) {
  const config = await effectiveSettings(db, settings);
  const start = Number(config.bankroll_units);
  const bankroll = new Map<Strategy, number>((Object.keys(STRATEGIES) as Strategy[]).map((key) => [key, start]));
  for (const bet of await loadBets(db)) {
    const profit = profitOf(bet);
    if (profit !== null) bankroll.set(bet.strategy, (bankroll.get(bet.strategy) ?? start) + profit);
  }
  const rows = [];
  for (const item of await candidates(db, settings, scope)) {
    for (const strategy of Object.keys(STRATEGIES) as Strategy[]) {
      const decision = decide(strategy, item);
      const balance = bankroll.get(strategy) ?? start;
      if (!decision || balance <= 0) continue;
      const stake = Number((decision.stakeFraction * balance).toFixed(4));
      if (stake <= 0) continue;
      rows.push({
        strategy,
        fixture_id: item.fixtureId,
        market: item.market,
        selection: SELECTIONS[item.market][decision.selection],
        probability: decision.probability.toFixed(8),
        price: decision.price.price.toFixed(3),
        bookmaker: decision.price.book.slice(0, 40),
        price_captured_at: decision.price.capturedAt,
        edge: decision.edge.toFixed(6),
        stake_units: stake.toFixed(4),
        bankroll_units: balance.toFixed(2),
        kickoff_at: item.kickoff,
      });
    }
  }
  if (!rows.length) return { scope_date: scope, considered: 0, recorded: 0 };
  const inserted = await db`INSERT INTO paper_bets ${db(rows)} ON CONFLICT (strategy, fixture_id, market) DO NOTHING RETURNING id`;
  return { scope_date: scope, considered: rows.length, recorded: inserted.length };
}

type Quote = { home: number | null; draw: number | null; away: number | null; over: number | null; under: number | null };

export async function paperReport(db: Db, settings: Settings) {
  const config = await effectiveSettings(db, settings);
  const start = Number(config.bankroll_units);
  const bets = await loadBets(db);
  const closing = new Map<number, Map<string, Quote>>();
  if (bets.length) {
    const rows = await db<{ fixture_id: number; bookmaker: string; home: string | null; draw: string | null; away: string | null; over_2_5: string | null; under_2_5: string | null }[]>`
      SELECT DISTINCT ON (fixture_id, bookmaker) fixture_id, bookmaker, home, draw, away, over_2_5, under_2_5
      FROM market_prices WHERE phase = 'closing' AND fixture_id IN ${db([...new Set(bets.map((bet) => bet.fixture_id))])}
      ORDER BY fixture_id, bookmaker, captured_at DESC`;
    const num = (value: string | null) => (value === null ? null : Number(value));
    for (const row of rows) {
      const books = closing.get(row.fixture_id) ?? new Map<string, Quote>();
      books.set(row.bookmaker, { home: num(row.home), draw: num(row.draw), away: num(row.away), over: num(row.over_2_5), under: num(row.under_2_5) });
      closing.set(row.fixture_id, books);
    }
  }
  const items = bets.map((bet) => {
    const close = closing.has(bet.fixture_id) ? benchmark(closing.get(bet.fixture_id)!, bet.market, bet.kickoff_at.getTime()) : null;
    const fair = close ? close.probabilities[SELECTIONS[bet.market].indexOf(bet.selection)] : null;
    const profit = profitOf(bet);
    return {
      id: bet.id,
      strategy: bet.strategy,
      fixture_id: bet.fixture_id,
      match: `${bet.home ?? "?"} vs ${bet.away ?? "?"}`,
      league: bet.league,
      market: bet.market,
      selection: bet.selection,
      probability: Number(bet.probability),
      price: Number(bet.price),
      bookmaker: bet.bookmaker,
      edge: Number(bet.edge),
      stake_units: Number(bet.stake_units),
      kickoff_at: iso(bet.kickoff_at),
      recorded_at: iso(bet.recorded_at),
      score: bet.home_goals === null || bet.away_goals === null ? null : `${bet.home_goals}–${bet.away_goals}`,
      result: profit === null ? null : profit > 0 ? "won" : "lost",
      profit_units: profit,
      clv: fair === null ? null : closingLineValue(Number(bet.price), fair),
    };
  });
  const strategies = (Object.keys(STRATEGIES) as Strategy[]).map((key) => {
    const group = items.filter((item) => item.strategy === key);
    const settled = group.filter((item) => item.profit_units !== null);
    const withClv = group.filter((item) => item.clv !== null);
    let balance = start;
    let peak = start;
    let drawdown = 0;
    const curve = [{ at: null as string | null, bankroll: start }];
    for (const item of settled) {
      balance += item.profit_units as number;
      peak = Math.max(peak, balance);
      drawdown = Math.max(drawdown, peak - balance);
      curve.push({ at: item.kickoff_at, bankroll: Number(balance.toFixed(2)) });
    }
    return {
      key,
      ...STRATEGIES[key],
      bets: group.length,
      open: group.length - settled.length,
      settled: settled.length,
      won: settled.filter((item) => item.result === "won").length,
      staked_units: Number(settled.reduce((sum, item) => sum + item.stake_units, 0).toFixed(2)),
      profit_units: Number((balance - start).toFixed(2)),
      bankroll_units: Number(balance.toFixed(2)),
      max_drawdown_units: Number(drawdown.toFixed(2)),
      roi: bootstrapRatio(settled.map((item) => item.profit_units as number), settled.map((item) => item.stake_units)),
      clv: bootstrapRatio(withClv.map((item) => item.clv as number), null),
      with_clv: withClv.length,
      curve,
    };
  });
  return {
    starting_bankroll_units: start,
    strategies,
    bets: [...items].reverse().slice(0, 300),
    note:
      "Paper bets only: nothing is staked. Bets are recorded before kick-off at the best price from your bookmakers (live prices from The Odds API, otherwise Bet365's football-data.co.uk price). Judge a strategy on closing-line value first; profit needs several hundred bets before its interval means much.",
  };
}
