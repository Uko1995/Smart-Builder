/**
 * Expected-value board and the append-only bet record.
 *
 * A bet is recommended only in a league × market × source × price segment that the
 * latest walk-forward backtest approved (positive closing-line value with a bootstrap
 * interval above zero). Everything else is withheld.
 */

import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import { devig } from "@/server/engine/devig";
import { bootstrapRatio, chooseBet, closingLineValue, pool } from "@/server/engine/edge";
import { iso } from "@/server/http";
import { BLEND_SOURCES, benchmark, PRIMARY_THRESHOLD, quotePrices, type Basis, type Market, type Source } from "@/server/services/backtest";
import { latestBatchForDate, REFERENCE_BOOKS } from "@/server/services/picks";
import { effectiveSettings } from "@/server/services/reference";

const SELECTIONS: Record<Market, string[]> = { "1x2": ["home", "draw", "away"], ou25: ["over", "under"] };
const PRICE_BOOK_NAMES: Record<string, string> = {
  bet365: "Bet365",
  pinnacle: "Pinnacle",
  betfair_exchange: "Betfair Exchange",
  market_max: "Best across books",
};

type Quote = { home: number | null; draw: number | null; away: number | null; over: number | null; under: number | null };
type SegmentRow = { segment_key: string; approved: boolean; stats: { bets: number; clv: { estimate: number; low: number; high: number } | null } };

export async function latestBacktest(db: Db) {
  const [row] = await db<{ id: number; created_at: Date; report: { blend_weights?: { live?: Record<Market, number[] | null> }; config?: { test_seasons?: string[] } } }[]>`
    SELECT id, created_at, report FROM edge_backtests ORDER BY id DESC LIMIT 1`;
  if (!row) return null;
  const segments = await db<SegmentRow[]>`
    SELECT segment_key, approved, stats FROM edge_segments WHERE backtest_id = ${row.id} AND approved`;
  return {
    id: row.id,
    createdAt: row.created_at,
    testSeasons: row.report.config?.test_seasons ?? [],
    weights: row.report.blend_weights?.live ?? { "1x2": null, ou25: null },
    approved: new Map(segments.map((segment) => [segment.segment_key, segment])),
  };
}

type SegmentStats = {
  bets: number;
  profit_units: number;
  roi: { estimate: number; low: number; high: number } | null;
  clv: { estimate: number; low: number; high: number } | null;
  confirmation: { bets: number; mean_clv: number | null };
  control_clv: number | null;
  approved: boolean;
};

/** The latest backtest: verdict, all-league rows and the strongest league segments. */
export async function backtestSummary(db: Db) {
  const [row] = await db<{ id: number; created_at: Date; report: { config: Record<string, unknown>; multiple_testing: Record<string, number>; log_loss: Record<string, unknown> } }[]>`
    SELECT id, created_at, report FROM edge_backtests ORDER BY id DESC LIMIT 1`;
  if (!row) return { backtest: null };
  const segments = await db<{ segment_key: string; league_id: number | null; league: string | null; market: string; source: string; price_basis: string; approved: boolean; stats: SegmentStats }[]>`
    SELECT s.segment_key, s.league_id, l.name AS league, s.market, s.source, s.price_basis, s.approved, s.stats
    FROM edge_segments s LEFT JOIN leagues l ON l.id = s.league_id WHERE s.backtest_id = ${row.id}`;
  const shape = (segment: (typeof segments)[number]) => ({
    segment_key: segment.segment_key,
    league: segment.league_id === null ? "All leagues" : (segment.league ?? String(segment.league_id)),
    market: segment.market,
    source: segment.source,
    price_basis: segment.price_basis,
    approved: segment.approved,
    bets: segment.stats.bets,
    profit_units: segment.stats.profit_units,
    roi: segment.stats.roi,
    clv: segment.stats.clv,
    confirmation: segment.stats.confirmation,
    control_clv: segment.stats.control_clv ?? null,
  });
  const minBets = Number(row.report.config.min_segment_bets ?? 100);
  const overall = row.report.log_loss as Record<string, Record<string, { minus_closing?: unknown; log_loss?: number } | number>>;
  return {
    backtest: { id: row.id, created_at: iso(row.created_at), config: row.report.config, multiple_testing: row.report.multiple_testing },
    log_loss: ["all|1x2", "all|ou25"].map((key) => ({ ...(overall[key] ?? {}), market_key: key.split("|")[1] })),
    aggregate: segments.filter((segment) => segment.league_id === null).map(shape).sort((a, b) => a.segment_key.localeCompare(b.segment_key)),
    approved: segments.filter((segment) => segment.approved).map(shape),
    leaders: segments
      .filter((segment) => segment.league_id !== null && segment.source !== "market" && segment.stats.bets >= minBets && segment.stats.clv)
      .sort((a, b) => (b.stats.clv?.low ?? -1) - (a.stats.clv?.low ?? -1))
      .slice(0, 10)
      .map(shape),
  };
}

type Price = { price: number; book: string; capturedAt: Date };

type Offer = {
  fixtureId: number;
  leagueId: number;
  kickoff: Date;
  match: string;
  league: string | null;
  market: Market;
  probabilities: Partial<Record<Source, number[]>>;
  prices: Partial<Record<Basis, (Price | null)[]>>;
};

function bestOf(current: Price | null | undefined, next: Price): Price {
  return !current || next.price > current.price ? next : current;
}

/** Model, Elo and market probabilities with the bettable prices for each upcoming 1X2 and over/under 2.5 market. */
async function offers(db: Db, settings: Settings, scope: string, weights: Record<Market, number[] | null>): Promise<Offer[]> {
  const batch = await latestBatchForDate(db, scope);
  if (!batch) return [];
  const config = await effectiveSettings(db, settings);
  const rows = await db<
    { fixture_id: number; league_id: number; kickoff_at: Date; home: string | null; away: string | null; league: string | null; market_key: string; selection: string; probability: string; elo_probability: string | null }[]
  >`
    SELECT p.fixture_id, f.league_id, f.kickoff_at, h.name AS home, a.name AS away, l.name AS league, p.market_key, p.selection, p.probability, p.elo_probability
    FROM predictions p
    JOIN fixtures f ON f.id = p.fixture_id
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN leagues l ON l.id = f.league_id
    WHERE p.batch_id = ${batch.id} AND f.kickoff_at > now() AND p.implementation_status = 'supported'
      AND (p.market_key = 'match_result' OR (p.market_key = 'over_under_goals' AND p.line = 2.5))`;
  if (!rows.length) return [];
  const fixtureIds = [...new Set(rows.map((row) => row.fixture_id))];
  const referenceSince = new Date(Date.now() - Number(config.reference_odds_freshness_hours) * 3_600_000);
  const liveSince = new Date(Date.now() - Number(config.odds_freshness_minutes) * 60_000);
  const early = await db<{ fixture_id: number; bookmaker: string; captured_at: Date; home: string | null; draw: string | null; away: string | null; over_2_5: string | null; under_2_5: string | null }[]>`
    SELECT DISTINCT ON (fixture_id, bookmaker) fixture_id, bookmaker, captured_at, home, draw, away, over_2_5, under_2_5
    FROM market_prices WHERE fixture_id IN ${db(fixtureIds)} AND phase = 'early' AND captured_at >= ${referenceSince}
    ORDER BY fixture_id, bookmaker, captured_at DESC`;
  const live = await db<{ fixture_id: number; key: string; name: string; market_key: string; selection: string; decimal_odds: string; captured_at: Date }[]>`
    SELECT DISTINCT ON (o.fixture_id, o.bookmaker_id, o.market_key, o.selection) o.fixture_id, b.key, b.name, o.market_key, o.selection, o.decimal_odds, o.captured_at
    FROM odds_snapshots o JOIN bookmakers b ON b.id = o.bookmaker_id
    WHERE o.fixture_id IN ${db(fixtureIds)} AND NOT b.is_synthetic AND o.data_origin <> 'synthetic_demo' AND o.captured_at >= ${liveSince}
      AND (o.market_key = 'match_result' OR (o.market_key = 'over_under_goals' AND o.line = 2.5))
    ORDER BY o.fixture_id, o.bookmaker_id, o.market_key, o.selection, o.captured_at DESC`;

  const byKey = new Map<string, Offer>();
  for (const row of rows) {
    const market: Market = row.market_key === "match_result" ? "1x2" : "ou25";
    const key = `${row.fixture_id}|${market}`;
    const offer = byKey.get(key) ?? {
      fixtureId: row.fixture_id,
      leagueId: row.league_id,
      kickoff: row.kickoff_at,
      match: `${row.home ?? "?"} vs ${row.away ?? "?"}`,
      league: row.league,
      market,
      probabilities: {},
      prices: {},
    };
    const index = SELECTIONS[market].indexOf(row.selection);
    if (index < 0) continue;
    (offer.probabilities.model ??= new Array(SELECTIONS[market].length).fill(NaN))[index] = Number(row.probability);
    if (market === "1x2" && row.elo_probability !== null) (offer.probabilities.elo ??= [NaN, NaN, NaN])[index] = Number(row.elo_probability);
    byKey.set(key, offer);
  }
  const marketProbabilities = new Map<string, number[]>();
  for (const row of early) {
    const quote: Quote = {
      home: row.home === null ? null : Number(row.home),
      draw: row.draw === null ? null : Number(row.draw),
      away: row.away === null ? null : Number(row.away),
      over: row.over_2_5 === null ? null : Number(row.over_2_5),
      under: row.under_2_5 === null ? null : Number(row.under_2_5),
    };
    for (const market of ["1x2", "ou25"] as Market[]) {
      const offer = byKey.get(`${row.fixture_id}|${market}`);
      const prices = quotePrices(quote, market);
      if (!offer || !prices) continue;
      if (row.bookmaker === "market_average") {
        const fair = devig(prices, "power");
        if (fair) marketProbabilities.set(`${row.fixture_id}|${market}`, fair);
        continue;
      }
      const best = (offer.prices.best_early ??= prices.map(() => null));
      prices.forEach((price, index) => (best[index] = bestOf(best[index], { price, book: row.bookmaker, capturedAt: row.captured_at })));
      if (row.bookmaker === "bet365") offer.prices.bet365_early = prices.map((price) => ({ price, book: "bet365", capturedAt: row.captured_at }));
    }
  }
  for (const row of live) {
    if (REFERENCE_BOOKS.has(row.key)) continue;
    const market: Market = row.market_key === "match_result" ? "1x2" : "ou25";
    const offer = byKey.get(`${row.fixture_id}|${market}`);
    const index = SELECTIONS[market].indexOf(row.selection);
    if (!offer || index < 0) continue;
    const best = (offer.prices.best_early ??= SELECTIONS[market].map(() => null));
    best[index] = bestOf(best[index], { price: Number(row.decimal_odds), book: row.name, capturedAt: row.captured_at });
  }
  for (const offer of byKey.values()) {
    for (const source of Object.keys(offer.probabilities) as Source[]) {
      if (offer.probabilities[source]?.some((value) => !Number.isFinite(value))) delete offer.probabilities[source];
    }
    const market = marketProbabilities.get(`${offer.fixtureId}|${offer.market}`);
    const weight = weights[offer.market];
    const inputs = BLEND_SOURCES[offer.market].map((name) => (name === "market" ? market : offer.probabilities[name as Source]));
    if (weight && inputs.every(Boolean)) offer.probabilities.blend = pool(inputs as number[][], weight);
  }
  return [...byKey.values()];
}

export type ValueBet = {
  fixture_id: number;
  match: string;
  league: string | null;
  kickoff_at: string | null;
  market: Market;
  selection: string;
  source: Source;
  price_basis: Basis;
  segment_key: string;
  probability: number;
  price: number;
  bookmaker: string;
  price_captured_at: string | null;
  edge: number;
  stake_fraction: number;
  stake_units: number;
  backtest_clv: { estimate: number; low: number; high: number } | null;
  backtest_bets: number;
};

export async function valueBoard(db: Db, settings: Settings, scope: string) {
  const backtest = await latestBacktest(db);
  const config = await effectiveSettings(db, settings);
  const bankroll = Number(config.bankroll_units);
  const base = { scope_date: scope, threshold: PRIMARY_THRESHOLD, bankroll_units: bankroll };
  if (!backtest) {
    return { ...base, backtest: null, approved_segments: [], bets: [] as ValueBet[], candidates_checked: 0, note: "No edge backtest has been run yet, so no bets are recommended." };
  }
  const approved = [...backtest.approved.values()].map((segment) => ({ key: segment.segment_key, bets: segment.stats.bets, clv: segment.stats.clv }));
  const summary = { id: backtest.id, created_at: iso(backtest.createdAt), test_seasons: backtest.testSeasons };
  if (!approved.length) {
    return {
      ...base,
      backtest: summary,
      approved_segments: approved,
      bets: [] as ValueBet[],
      candidates_checked: 0,
      note: "The backtest found no league or market where the model beats the closing line with confidence, so no expected-value bets are shown.",
    };
  }
  const bets: ValueBet[] = [];
  const all = await offers(db, settings, scope, backtest.weights);
  for (const offer of all) {
    let best: ValueBet | null = null;
    for (const [source, probabilities] of Object.entries(offer.probabilities) as [Source, number[]][]) {
      for (const [basis, prices] of Object.entries(offer.prices) as [Basis, (Price | null)[]][]) {
        const leagueKey = `${offer.leagueId}|${offer.market}|${source}|${basis}`;
        const marketKey = `all|${offer.market}|${source}|${basis}`;
        const segmentKey = backtest.approved.has(leagueKey) ? leagueKey : marketKey;
        const segment = backtest.approved.get(segmentKey);
        if (!segment) continue;
        const choice = chooseBet(
          probabilities.map((probability, selection) => ({ selection, probability, price: prices[selection]?.price ?? 0 })),
          PRIMARY_THRESHOLD,
        );
        if (!choice || (best && best.edge >= choice.edge)) continue;
        const taken = prices[choice.selection] as Price;
        best = {
          fixture_id: offer.fixtureId,
          match: offer.match,
          league: offer.league,
          kickoff_at: iso(offer.kickoff),
          market: offer.market,
          selection: SELECTIONS[offer.market][choice.selection],
          source,
          price_basis: basis,
          segment_key: segmentKey,
          probability: choice.probability,
          price: choice.price,
          bookmaker: PRICE_BOOK_NAMES[taken.book] ?? taken.book,
          price_captured_at: iso(taken.capturedAt),
          edge: choice.edge,
          stake_fraction: choice.stake,
          stake_units: Number((choice.stake * bankroll).toFixed(2)),
          backtest_clv: segment.stats.clv,
          backtest_bets: segment.stats.bets,
        };
      }
    }
    if (best) bets.push(best);
  }
  bets.sort((a, b) => b.edge - a.edge || (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""));
  return {
    ...base,
    backtest: summary,
    approved_segments: approved,
    bets,
    candidates_checked: all.length,
    note: `Only segments the backtest approved are shown. Stake is quarter Kelly, capped at 5% of a ${bankroll}-unit bankroll. Check the price is still available before staking.`,
  };
}

/** Appends every recommendation not yet recorded. Rows are never updated; the first price recorded is the one that counts. */
export async function recordBets(db: Db, settings: Settings, scope: string): Promise<number> {
  const board = await valueBoard(db, settings, scope);
  if (!board.backtest || !board.bets.length) return 0;
  const rows = board.bets
    .filter((bet) => bet.kickoff_at && Date.parse(bet.kickoff_at) > Date.now())
    .map((bet) => ({
      fixture_id: bet.fixture_id,
      market: bet.market,
      selection: bet.selection,
      segment_key: bet.segment_key,
      source: bet.source,
      probability: bet.probability.toFixed(8),
      price: bet.price.toFixed(3),
      bookmaker: bet.bookmaker.slice(0, 24),
      price_captured_at: bet.price_captured_at,
      edge: bet.edge.toFixed(6),
      stake_units: bet.stake_units.toFixed(4),
      bankroll_units: board.bankroll_units.toFixed(2),
      kickoff_at: bet.kickoff_at,
      backtest_id: board.backtest!.id,
    }));
  if (!rows.length) return 0;
  const inserted = await db`INSERT INTO bet_log ${db(rows)} ON CONFLICT (fixture_id, market, selection) DO NOTHING RETURNING id`;
  return inserted.length;
}

type LoggedBet = {
  id: number;
  fixture_id: number;
  market: Market;
  selection: string;
  segment_key: string;
  source: string;
  probability: string;
  price: string;
  bookmaker: string;
  edge: string;
  stake_units: string;
  kickoff_at: Date;
  recorded_at: Date;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  home: string | null;
  away: string | null;
};

function won(bet: LoggedBet): boolean | null {
  if (bet.status !== "completed" || bet.home_goals === null || bet.away_goals === null) return null;
  const { home_goals: h, away_goals: a } = bet;
  switch (bet.selection) {
    case "home":
      return h > a;
    case "draw":
      return h === a;
    case "away":
      return h < a;
    case "over":
      return h + a >= 3;
    case "under":
      return h + a < 3;
    default:
      return null;
  }
}

/** Closing-line value per bet and per segment (primary), and settled profit with its interval (secondary). */
export async function betRecord(db: Db) {
  const bets = await db<LoggedBet[]>`
    SELECT b.id, b.fixture_id, b.market, b.selection, b.segment_key, b.source, b.probability, b.price, b.bookmaker, b.edge, b.stake_units,
           b.kickoff_at, b.recorded_at, f.status, f.home_goals, f.away_goals, h.name AS home, a.name AS away
    FROM bet_log b
    JOIN fixtures f ON f.id = b.fixture_id
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    ORDER BY b.kickoff_at DESC, b.id DESC`;
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
    const price = Number(bet.price);
    const stake = Number(bet.stake_units);
    const close = closing.has(bet.fixture_id) ? benchmark(closing.get(bet.fixture_id)!, bet.market, bet.kickoff_at.getTime()) : null;
    const fair = close ? close.probabilities[SELECTIONS[bet.market].indexOf(bet.selection)] : null;
    const result = won(bet);
    return {
      id: bet.id,
      fixture_id: bet.fixture_id,
      match: `${bet.home ?? "?"} vs ${bet.away ?? "?"}`,
      market: bet.market,
      selection: bet.selection,
      segment_key: bet.segment_key,
      price,
      bookmaker: bet.bookmaker,
      edge: Number(bet.edge),
      stake_units: stake,
      kickoff_at: iso(bet.kickoff_at),
      recorded_at: iso(bet.recorded_at),
      closing_source: close?.source ?? null,
      fair_closing_probability: fair,
      clv: fair === null ? null : closingLineValue(price, fair),
      result: result === null ? null : result ? "won" : "lost",
      profit_units: result === null ? null : result ? stake * (price - 1) : -stake,
    };
  });
  const summarize = (group: typeof items) => {
    const withClv = group.filter((item) => item.clv !== null);
    const settled = group.filter((item) => item.profit_units !== null);
    return {
      bets: group.length,
      with_closing_price: withClv.length,
      clv: bootstrapRatio(withClv.map((item) => item.clv as number), null),
      settled: settled.length,
      profit_units: settled.reduce((sum, item) => sum + (item.profit_units as number), 0),
      roi: bootstrapRatio(settled.map((item) => item.profit_units as number), settled.map((item) => item.stake_units)),
    };
  };
  const segments = new Map<string, typeof items>();
  for (const item of items) segments.set(item.segment_key, [...(segments.get(item.segment_key) ?? []), item]);
  return {
    overall: summarize(items),
    segments: [...segments.entries()].map(([key, group]) => ({ segment_key: key, ...summarize(group) })),
    bets: items.slice(0, 200),
    note: "Closing-line value is the health metric: price taken × fair closing probability − 1. Closing prices arrive from football-data.co.uk a few days after each match. Profit is secondary and noisy; read it with its interval.",
  };
}
