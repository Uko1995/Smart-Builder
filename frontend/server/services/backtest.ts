/**
 * Walk-forward edge backtest against the closing market.
 *
 * Every probability is produced from matches before kick-off only: goal rates
 * from a 1100-day window, Elo updated match by match with its logit refitted at
 * each season start, and blend weights fitted on earlier seasons. The benchmark
 * is the de-margined closing price (Pinnacle before 23 July 2025, then Betfair
 * Exchange, then the market average).
 */

import type { Sql } from "@/server/db/client";
import { devig } from "@/server/engine/devig";
import {
  bootstrapRatio,
  chooseBet,
  closingLineValue,
  fitPool,
  multiLogLoss,
  PINNACLE_CUTOFF,
  pool,
  type Interval,
} from "@/server/engine/edge";
import { ELO_PARAMS, EloPool, fitOrderedLogit, logitProbabilities, outcomeOf, type EloSample, type OrderedLogit } from "@/server/engine/elo";
import { scorelineMatrix } from "@/server/engine/scoreline";
import { estimateGoalRates, selectRho, type HistoricalMatch } from "@/server/engine/strengths";

const DAY = 86_400_000;
const HISTORY_DAYS = 1100;
export const FIRST_RECORD_SEASON = 2019;
export const FIRST_TEST_SEASON = 2020;
export const PRIMARY_THRESHOLD = 0.05;
export const SENSITIVITY_THRESHOLDS = [0.02, 0.1];
const MIN_SEGMENT_BETS = 100;
const MIN_CONFIRM_BETS = 30;

export type Market = "1x2" | "ou25";
export type Source = "model" | "elo" | "blend";
/** The de-margined early market price alone. A control: any edge it shows comes from price shopping, not from our forecasts. */
export const CONTROL_SOURCE = "market";
const BET_SOURCES = ["model", "elo", "blend", CONTROL_SOURCE] as const;
export type Basis = "best_early" | "bet365_early" | "best_closing";
export const BLEND_SOURCES: Record<Market, string[]> = { "1x2": ["model", "elo", "market"], ou25: ["model", "market"] };

type Quote = { home: number | null; draw: number | null; away: number | null; over: number | null; under: number | null };

function seasonOf(kickoff: number): number {
  const date = new Date(kickoff);
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

export function quotePrices(quote: Quote | undefined, market: Market): number[] | null {
  if (!quote) return null;
  const prices = market === "1x2" ? [quote.home, quote.draw, quote.away] : [quote.over, quote.under];
  return prices.every((value) => value !== null && value > 1) ? (prices as number[]) : null;
}

/** De-margined closing probabilities and which book they came from. */
export function benchmark(closing: Map<string, Quote>, market: Market, kickoff: number): { probabilities: number[]; source: string } | null {
  const order = kickoff < PINNACLE_CUTOFF ? ["pinnacle", "betfair_exchange", "market_average"] : ["betfair_exchange", "market_average"];
  for (const book of order) {
    const prices = quotePrices(closing.get(book), market);
    const probabilities = prices && devig(prices, "power");
    if (probabilities) return { probabilities, source: book };
  }
  return null;
}

export type BacktestRecord = {
  fixtureId: number;
  leagueId: number;
  season: number;
  kickoff: number;
  market: Market;
  outcome: number;
  sources: Partial<Record<"model" | "elo" | "market" | "blend", number[]>>;
  close: number[];
  closeSource: string;
  prices: Partial<Record<Basis, number[]>>;
};

function matrixMarkets(lambdaHome: number, lambdaAway: number, rho: number): { oneX2: number[]; ou: number[] } {
  const matrix = scorelineMatrix(lambdaHome, lambdaAway, rho);
  let home = 0;
  let draw = 0;
  let away = 0;
  let over = 0;
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      const p = matrix[h][a];
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (h + a >= 3) over += p;
    }
  }
  const total = home + draw + away;
  return { oneX2: [home / total, draw / total, away / total], ou: [over / total, 1 - over / total] };
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

type LoadedMatch = HistoricalMatch & { fixtureId: number; early: Map<string, Quote>; closing: Map<string, Quote> };

async function loadMatches(sql: Sql): Promise<Map<number, LoadedMatch[]>> {
  const byId = new Map<number, LoadedMatch>();
  const byLeague = new Map<number, LoadedMatch[]>();
  const rows = await sql<{ id: number; league_id: number; kickoff_at: Date; home_team_id: number; away_team_id: number; home_goals: number; away_goals: number }[]>`
    SELECT id, league_id, kickoff_at, home_team_id, away_team_id, home_goals, away_goals FROM fixtures
    WHERE status = 'completed' AND data_origin <> 'synthetic_demo' AND home_goals IS NOT NULL AND away_goals IS NOT NULL
    ORDER BY kickoff_at, id`;
  for (const row of rows) {
    const match: LoadedMatch = {
      matchId: String(row.id),
      fixtureId: row.id,
      leagueId: String(row.league_id),
      kickoff: row.kickoff_at.getTime(),
      homeId: String(row.home_team_id),
      awayId: String(row.away_team_id),
      homeGoals: row.home_goals,
      awayGoals: row.away_goals,
      early: new Map(),
      closing: new Map(),
    };
    byId.set(row.id, match);
    const list = byLeague.get(row.league_id) ?? [];
    list.push(match);
    byLeague.set(row.league_id, list);
  }
  const num = (value: string | null) => (value === null ? null : Number(value));
  const cursor = sql<
    { fixture_id: number; bookmaker: string; phase: string; captured_at_estimated: boolean; home: string | null; draw: string | null; away: string | null; over_2_5: string | null; under_2_5: string | null }[]
  >`
    SELECT fixture_id, bookmaker, phase, captured_at_estimated, home, draw, away, over_2_5, under_2_5
    FROM market_prices ORDER BY fixture_id, bookmaker, phase, captured_at`.cursor(20000);
  for await (const batch of cursor) {
    for (const row of batch) {
      const match = byId.get(row.fixture_id);
      if (!match) continue;
      const target = row.phase === "closing" ? match.closing : match.early;
      // For early prices the file's own (estimated-time) quote is the one a bettor would have seen; keep it over later fetches.
      if (row.phase === "early" && target.has(row.bookmaker) && !row.captured_at_estimated) continue;
      target.set(row.bookmaker, { home: num(row.home), draw: num(row.draw), away: num(row.away), over: num(row.over_2_5), under: num(row.under_2_5) });
    }
  }
  return byLeague;
}

/** Produces walk-forward records for every completed match with a closing benchmark. */
export async function buildRecords(sql: Sql, log: (line: string) => void = () => undefined): Promise<BacktestRecord[]> {
  const byLeague = await loadMatches(sql);
  const records: BacktestRecord[] = [];
  const recordStart = Date.UTC(FIRST_RECORD_SEASON, 6, 1);
  for (const [leagueId, matches] of byLeague) {
    const kickoffs = matches.map((match) => match.kickoff);
    const elo = new EloPool(ELO_PARAMS);
    const samples: EloSample[] = [];
    let fit: OrderedLogit | null = null;
    let fitSeason = -1;
    const rhoBySeason = new Map<number, number>();
    for (const match of matches) {
      const season = seasonOf(match.kickoff);
      if (match.kickoff >= recordStart) {
        if (season !== fitSeason) {
          fit = fitOrderedLogit(samples, ELO_PARAMS.minFitSamples);
          fitSeason = season;
        }
        const window = matches.slice(lowerBound(kickoffs, match.kickoff - HISTORY_DAYS * DAY), lowerBound(kickoffs, match.kickoff));
        if (!rhoBySeason.has(season)) rhoBySeason.set(season, window.length >= 80 ? selectRho(window, Date.UTC(season, 6, 1)) : 0);
        const estimate = estimateGoalRates(window, match.homeId, match.awayId, match.kickoff, 5, 1e9);
        const model = estimate ? matrixMarkets(estimate.lambdaHome, estimate.lambdaAway, rhoBySeason.get(season) ?? 0) : null;
        const x = fit ? elo.difference(match.homeId, match.awayId, match.kickoff) : null;
        const eloProbabilities = fit && x !== null ? logitProbabilities(fit, x) : null;
        for (const market of ["1x2", "ou25"] as Market[]) {
          const bench = benchmark(match.closing, market, match.kickoff);
          if (!bench) continue;
          const marketEarly = quotePrices(match.early.get("market_average"), market);
          const sources: BacktestRecord["sources"] = {};
          if (model) sources.model = market === "1x2" ? model.oneX2 : model.ou;
          if (market === "1x2" && eloProbabilities) sources.elo = [eloProbabilities.home, eloProbabilities.draw, eloProbabilities.away];
          const marketProbabilities = marketEarly && devig(marketEarly, "power");
          if (marketProbabilities) sources.market = marketProbabilities;
          const prices: BacktestRecord["prices"] = {};
          const bestEarly = quotePrices(match.early.get("market_max"), market);
          const bet365Early = quotePrices(match.early.get("bet365"), market);
          if (bestEarly) prices.best_early = bestEarly;
          if (bet365Early) prices.bet365_early = bet365Early;
          if (!bestEarly && !bet365Early) {
            const bestClosing = quotePrices(match.closing.get("market_max"), market);
            if (bestClosing) prices.best_closing = bestClosing;
          }
          const outcome = market === "1x2" ? 2 - outcomeOf(match.homeGoals, match.awayGoals) : match.homeGoals + match.awayGoals >= 3 ? 0 : 1;
          records.push({ fixtureId: match.fixtureId, leagueId, season, kickoff: match.kickoff, market, outcome, sources, close: bench.probabilities, closeSource: bench.source, prices });
        }
      }
      const pre = elo.update(match);
      if (pre !== null) samples.push({ x: pre, y: outcomeOf(match.homeGoals, match.awayGoals) });
    }
    log(`league ${leagueId}: ${records.length} records so far`);
  }
  return records;
}

/** Adds blend probabilities, with weights fitted only on seasons before each record's season. */
export function addBlend(records: BacktestRecord[]): Record<Market, Record<number, number[] | null>> {
  const weightsBySeason: Record<Market, Record<number, number[] | null>> = { "1x2": {}, ou25: {} };
  for (const market of ["1x2", "ou25"] as Market[]) {
    const names = BLEND_SOURCES[market];
    const usable = records.filter((record) => record.market === market && names.every((name) => record.sources[name as keyof BacktestRecord["sources"]]));
    const seasons = [...new Set(usable.map((record) => record.season))].sort();
    for (const season of [...seasons, Math.max(...seasons, FIRST_TEST_SEASON) + 1]) {
      const train = usable.filter((record) => record.season < season);
      const weights = fitPool(
        train.map((record) => ({ sources: names.map((name) => record.sources[name as keyof BacktestRecord["sources"]] as number[]), outcome: record.outcome })),
      );
      weightsBySeason[market][season] = weights;
      if (!weights) continue;
      for (const record of usable) {
        if (record.season !== season) continue;
        record.sources.blend = pool(names.map((name) => record.sources[name as keyof BacktestRecord["sources"]] as number[]), weights);
      }
    }
  }
  return weightsBySeason;
}

type Bet = { season: number; stake: number; profit: number; clv: number; price: number; edge: number };

function interval(value: Interval | null) {
  return value && { estimate: round(value.estimate), low: round(value.low), high: round(value.high) };
}

function round(value: number, digits = 5): number {
  return Number(value.toFixed(digits));
}

export function betStats(bets: Bet[], confirmFrom: number) {
  const stakes = bets.map((bet) => bet.stake);
  const turnover = stakes.reduce((sum, value) => sum + value, 0);
  const profit = bets.reduce((sum, bet) => sum + bet.profit, 0);
  const clv = bootstrapRatio(bets.map((bet) => bet.clv), null);
  const confirm = bets.filter((bet) => bet.season >= confirmFrom);
  const confirmClv = confirm.length ? confirm.reduce((sum, bet) => sum + bet.clv, 0) / confirm.length : null;
  const passesRule = clv !== null && bets.length >= MIN_SEGMENT_BETS && clv.low > 0;
  return {
    bets: bets.length,
    turnover_units: round(turnover, 2),
    profit_units: round(profit, 2),
    roi: interval(bootstrapRatio(bets.map((bet) => bet.profit), stakes)),
    clv: interval(clv),
    clv_stake_weighted: turnover ? round(bets.reduce((sum, bet) => sum + bet.clv * bet.stake, 0) / turnover) : null,
    mean_price: bets.length ? round(bets.reduce((sum, bet) => sum + bet.price, 0) / bets.length, 3) : null,
    confirmation: { from_season: confirmFrom, bets: confirm.length, mean_clv: confirmClv === null ? null : round(confirmClv) },
    passes_clv_rule: passesRule,
    holds_in_confirmation: confirm.length >= MIN_CONFIRM_BETS && (confirmClv ?? 0) > 0,
    control_clv: null as number | null,
    beats_control: false,
    approved: false,
  };
}

function isControl(key: string): boolean {
  return key.split("|")[2] === CONTROL_SOURCE;
}

/**
 * A segment is approved only when its CLV interval is above zero, it held in the confirmation
 * season, and its CLV lower bound beats the market-only control on the same league, market and prices.
 */
export function applyControl(segments: Record<string, ReturnType<typeof betStats>>): void {
  for (const [key, stats] of Object.entries(segments)) {
    if (isControl(key)) continue;
    const [league, market, , basis] = key.split("|");
    const control = segments[`${league}|${market}|${CONTROL_SOURCE}|${basis}`];
    stats.control_clv = control?.clv ? control.clv.estimate : null;
    stats.beats_control = stats.clv !== null && (stats.control_clv === null || stats.clv.low > stats.control_clv);
    stats.approved = stats.passes_clv_rule && stats.holds_in_confirmation && stats.beats_control;
  }
}

export function simulate(records: BacktestRecord[], threshold: number, bankroll = 100) {
  const bets = new Map<string, Bet[]>();
  const push = (key: string, bet: Bet) => {
    const list = bets.get(key) ?? [];
    list.push(bet);
    bets.set(key, list);
  };
  for (const record of records) {
    if (record.season < FIRST_TEST_SEASON) continue;
    for (const source of BET_SOURCES) {
      const probabilities = record.sources[source];
      if (!probabilities) continue;
      for (const basis of Object.keys(record.prices) as Basis[]) {
        const prices = record.prices[basis] as number[];
        const choice = chooseBet(
          probabilities.map((probability, selection) => ({ selection, probability, price: prices[selection] })),
          threshold,
        );
        if (!choice || choice.stake <= 0) continue;
        const stake = choice.stake * bankroll;
        const bet: Bet = {
          season: record.season,
          stake,
          profit: choice.selection === record.outcome ? stake * (choice.price - 1) : -stake,
          clv: closingLineValue(choice.price, record.close[choice.selection]),
          price: choice.price,
          edge: choice.edge,
        };
        push(`${record.leagueId}|${record.market}|${source}|${basis}`, bet);
        push(`all|${record.market}|${source}|${basis}`, bet);
      }
    }
  }
  return bets;
}

function logLossTable(records: BacktestRecord[]) {
  const groups = new Map<string, BacktestRecord[]>();
  for (const record of records) {
    if (record.season < FIRST_TEST_SEASON) continue;
    for (const key of [`${record.leagueId}|${record.market}`, `all|${record.market}`]) {
      const list = groups.get(key) ?? [];
      list.push(record);
      groups.set(key, list);
    }
  }
  const table: Record<string, unknown> = {};
  for (const [key, group] of groups) {
    const row: Record<string, unknown> = { matches: group.length, closing: round(group.reduce((sum, r) => sum + multiLogLoss(r.close, r.outcome), 0) / group.length) };
    for (const source of ["model", "elo", "blend", "market"] as const) {
      const paired = group.filter((record) => record.sources[source]);
      if (paired.length < 50) continue;
      const deltas = paired.map((record) => multiLogLoss(record.sources[source] as number[], record.outcome) - multiLogLoss(record.close, record.outcome));
      row[source] = {
        matches: paired.length,
        log_loss: round(paired.reduce((sum, record) => sum + multiLogLoss(record.sources[source] as number[], record.outcome), 0) / paired.length),
        minus_closing: interval(bootstrapRatio(deltas, null, 500)),
      };
    }
    table[key] = row;
  }
  return table;
}

export type EdgeReport = Awaited<ReturnType<typeof runEdgeBacktest>>;

export async function storeBacktest(sql: Sql, report: EdgeReport): Promise<number> {
  const { segments, ...summary } = report;
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO edge_backtests (config, report) VALUES (${sql.json(report.config)}, ${sql.json(summary as never)}) RETURNING id`;
  const rows = Object.entries(segments).map(([key, stats]) => {
    const [league, market, source, basis] = key.split("|");
    return {
      backtest_id: row.id,
      segment_key: key,
      league_id: league === "all" ? null : Number(league),
      market,
      source,
      price_basis: basis,
      approved: stats.approved,
      stats: sql.json(stats as never),
    };
  });
  for (let index = 0; index < rows.length; index += 500) await sql`INSERT INTO edge_segments ${sql(rows.slice(index, index + 500))}`;
  return row.id;
}

function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "–" : `${(value * 100).toFixed(digits)}%`;
}

function ci(value: { estimate: number; low: number; high: number } | null, digits = 1): string {
  return value ? `${pct(value.estimate, digits)} [${pct(value.low, digits)}, ${pct(value.high, digits)}]` : "–";
}

export function renderMarkdown(report: EdgeReport, leagueNames: Map<number, string>, backtestId: number): string {
  const name = (id: string) => (id === "all" ? "All leagues" : (leagueNames.get(Number(id)) ?? id));
  const lines: string[] = [];
  const approved = Object.entries(report.segments).filter(([, stats]) => stats.approved);
  lines.push(`# Edge backtest (#${backtestId})`, "", `Generated ${report.generated_at}. Seasons tested: ${report.config.test_seasons.join(", ")}.`, "");
  lines.push("## Verdict", "");
  if (!approved.length) {
    lines.push(
      "**Nothing we forecast beats the closing line.** No segment (league or all-league market × source × price) has closing-line value with a bootstrap 95% interval above zero that also held in the confirmation season and beat the market-only control. Expected-value picks are not shipped for any segment.",
    );
  } else {
    lines.push(`${approved.length} segment(s) pass the stop rule (CLV 95% CI above zero over ≥${report.config.min_segment_bets} bets, positive CLV over ≥${report.config.min_confirmation_bets} bets from ${report.config.confirmation_from}, and a CLV lower bound above the market-only control):`, "");
    for (const [key, stats] of approved) {
      const [league, market, source, basis] = key.split("|");
      lines.push(`- ${name(league)} · ${market} · ${source} · ${basis}: ${stats.bets} bets, CLV ${ci(stats.clv)}, ROI ${ci(stats.roi)}`);
    }
  }
  const mt = report.multiple_testing;
  lines.push(
    "",
    `Multiple testing: ${mt.segments_with_enough_bets} segments had enough bets; by chance alone about ${mt.expected_false_passes_at_2_5_percent} would show a CLV interval above zero. ${mt.passing_clv_rule} did, ${mt.beating_control} of those also beat the market-only control, and ${mt.approved} passed every test.`,
    "",
  );
  const weights = report.blend_weights.live;
  const fmt = (values: number[] | null, names: string[]) => (values ? names.map((n, i) => `${n} ${values[i].toFixed(2)}`).join(", ") : "not fitted");
  lines.push(
    `Blend weights fitted on all seasons: 1X2 ${fmt(weights["1x2"], BLEND_SOURCES["1x2"])}; over/under 2.5 ${fmt(weights.ou25, BLEND_SOURCES.ou25)}. A weight near zero means that forecast adds nothing to the early market price.`,
    "",
  );
  lines.push("## Method", "");
  lines.push(
    `- Benchmark: ${report.config.benchmark}, margin removed with the ${report.config.devig} method. Closing sources used: ${Object.entries(report.closing_sources).map(([book, n]) => `${book} ${n}`).join(", ")}.`,
    "- Model: Dixon–Coles goal rates from the previous 1100 days, rho picked per league at each season start. Elo: per-league ratings updated after every match, logit refitted at each season start. Market: power-devigged average early price. Blend: log-linear pool of model, Elo (1X2 only) and market, weights fitted on earlier seasons only.",
    `- Betting rule: one bet per match and market, on the selection with the highest expected value if it exceeds ${pct(report.config.threshold, 0)}; stake = quarter Kelly capped at 5% of a flat ${report.config.bankroll_units}-unit bankroll.`,
    "- Price bases: `best_early` = best early price across books (football-data `Max`, includes line-shopping), `bet365_early` = a single realistic book, `best_closing` = best closing price (only for leagues with no early prices; not achievable before kick-off, shown for reference).",
    "- Control: `market` bets the de-margined early market-average price at the same prices. It uses no forecast of ours, so any CLV it shows comes from price shopping (an outlying best price against the consensus), not from modelling.",
    "- CLV = price taken × fair closing probability − 1. Intervals: 1000-sample bootstrap, 95% percentile.",
    "",
  );
  lines.push("## Log loss against the closing line", "", "Lower is better. `Δ` = source minus closing on the same matches, with a 95% interval; a negative Δ would mean beating the close.", "");
  lines.push("| League | Market | Matches | Closing | Model Δ | Elo Δ | Blend Δ | Early market Δ |", "|---|---|---|---|---|---|---|---|");
  const fmtDelta = (cell: unknown) => {
    const value = cell as { minus_closing: { estimate: number; low: number; high: number } | null } | undefined;
    const m = value?.minus_closing;
    return m ? `${m.estimate.toFixed(4)} [${m.low.toFixed(4)}, ${m.high.toFixed(4)}]` : "–";
  };
  const llRows = Object.entries(report.log_loss).sort(([a], [b]) => (a.startsWith("all") ? -1 : b.startsWith("all") ? 1 : a.localeCompare(b)));
  for (const [key, value] of llRows) {
    const [league, market] = key.split("|");
    const row = value as Record<string, unknown> & { matches: number; closing: number };
    lines.push(`| ${name(league)} | ${market} | ${row.matches} | ${row.closing.toFixed(4)} | ${fmtDelta(row.model)} | ${fmtDelta(row.elo)} | ${fmtDelta(row.blend)} | ${fmtDelta(row.market)} |`);
  }
  lines.push("", "## Betting simulation, all leagues", "");
  lines.push("| Threshold | Market | Source | Prices | Bets | Profit (units) | ROI [95% CI] | CLV [95% CI] |", "|---|---|---|---|---|---|---|---|");
  const allRows = (threshold: string, table: Record<string, ReturnType<typeof betStats>>) =>
    Object.entries(table)
      .filter(([key]) => key.startsWith("all|"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, stats]) => {
        const [, market, source, basis] = key.split("|");
        return `| ${threshold} | ${market} | ${source} | ${basis} | ${stats.bets} | ${stats.profit_units} | ${ci(stats.roi)} | ${ci(stats.clv)} |`;
      });
  lines.push(...allRows(pct(report.config.threshold, 0), report.segments));
  for (const [threshold, table] of Object.entries(report.sensitivity)) lines.push(...allRows(pct(Number(threshold), 0), table));
  lines.push("", "## Best league segments by CLV lower bound", "", "Top 25 segments with at least the minimum number of bets.", "");
  lines.push("| League | Market | Source | Prices | Bets | ROI [95% CI] | CLV [95% CI] | Control CLV | Confirmation CLV (bets) | Approved |", "|---|---|---|---|---|---|---|---|---|---|");
  const ranked = Object.entries(report.segments)
    .filter(([key, stats]) => !key.startsWith("all|") && !isControl(key) && stats.bets >= report.config.min_segment_bets && stats.clv)
    .sort(([, a], [, b]) => (b.clv?.low ?? -1) - (a.clv?.low ?? -1))
    .slice(0, 25);
  for (const [key, stats] of ranked) {
    const [league, market, source, basis] = key.split("|");
    lines.push(
      `| ${name(league)} | ${market} | ${source} | ${basis} | ${stats.bets} | ${ci(stats.roi)} | ${ci(stats.clv)} | ${pct(stats.control_clv)} | ${pct(stats.confirmation.mean_clv)} (${stats.confirmation.bets}) | ${stats.approved ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export async function runEdgeBacktest(sql: Sql, log: (line: string) => void = () => undefined) {
  const started = Date.now();
  const records = await buildRecords(sql, log);
  log(`records: ${records.length} in ${Math.round((Date.now() - started) / 1000)}s`);
  const blendWeights = addBlend(records);
  const testSeasons = [...new Set(records.filter((record) => record.season >= FIRST_TEST_SEASON).map((record) => record.season))].sort();
  const lastFull = testSeasons.length >= 2 ? testSeasons[testSeasons.length - 2] : testSeasons[testSeasons.length - 1];
  const segments: Record<string, ReturnType<typeof betStats>> = {};
  for (const [key, bets] of simulate(records, PRIMARY_THRESHOLD)) segments[key] = betStats(bets, lastFull);
  applyControl(segments);
  const sensitivity: Record<string, Record<string, ReturnType<typeof betStats>>> = {};
  for (const threshold of SENSITIVITY_THRESHOLDS) {
    sensitivity[String(threshold)] = {};
    for (const [key, bets] of simulate(records, threshold)) if (key.startsWith("all|")) sensitivity[String(threshold)][key] = betStats(bets, lastFull);
    applyControl(sensitivity[String(threshold)]);
  }
  const tested = Object.entries(segments).filter(([key, stats]) => !isControl(key) && stats.bets >= MIN_SEGMENT_BETS);
  const closeSources: Record<string, number> = {};
  for (const record of records) closeSources[record.closeSource] = (closeSources[record.closeSource] ?? 0) + 1;
  const latestSeason = Math.max(...Object.keys(blendWeights["1x2"]).map(Number));
  return {
    generated_at: new Date().toISOString(),
    config: {
      test_seasons: testSeasons.map((season) => `${season}/${season + 1}`),
      confirmation_from: `${lastFull}/${lastFull + 1}`,
      threshold: PRIMARY_THRESHOLD,
      sensitivity_thresholds: SENSITIVITY_THRESHOLDS,
      kelly_fraction: 0.25,
      max_stake_fraction: 0.05,
      bankroll_units: 100,
      devig: "power",
      benchmark: "Pinnacle closing before 2025-07-23, then Betfair Exchange closing, then market-average closing",
      min_segment_bets: MIN_SEGMENT_BETS,
      min_confirmation_bets: MIN_CONFIRM_BETS,
    },
    blend_weights: { by_season: blendWeights, live: { "1x2": blendWeights["1x2"][latestSeason] ?? null, ou25: blendWeights.ou25[latestSeason] ?? null } },
    records: records.length,
    closing_sources: closeSources,
    log_loss: logLossTable(records),
    segments,
    sensitivity,
    multiple_testing: {
      segments_with_enough_bets: tested.length,
      expected_false_passes_at_2_5_percent: round(tested.length * 0.025, 1),
      passing_clv_rule: tested.filter(([, stats]) => stats.passes_clv_rule).length,
      beating_control: tested.filter(([, stats]) => stats.passes_clv_rule && stats.beats_control).length,
      approved: tested.filter(([, stats]) => stats.approved).length,
    },
    runtime_seconds: Math.round((Date.now() - started) / 1000),
  };
}
