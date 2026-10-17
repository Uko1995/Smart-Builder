/** Read models for the dashboard. Empty results stay empty. */

import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import { brierScore, calibrationReport, logLoss, simulateUnitReturns } from "@/server/engine/evaluate";
import { addDays, iso } from "@/server/http";
import { MARKET_BY_KEY, MARKETS, marketCatalog } from "@/server/markets/registry";
import { impliedFor, isTrivialSelection, latestBatchForDate, latestOddsGroups, PICK_MARKETS } from "@/server/services/picks";
import type { BatchRow } from "@/server/services/predictions";
import { effectiveSettings } from "@/server/services/reference";

function perFixtureWarning(warning: string): boolean {
  return warning.includes(" was skipped: ") || warning.includes(" markets are unavailable for ");
}

type FixtureSummaryRow = {
  id: number;
  kickoff_at: Date;
  status: string;
  league: string | null;
  home: string | null;
  away: string | null;
  home_goals: number | null;
  away_goals: number | null;
  data_origin: string;
};

export function fixtureSummary(row: FixtureSummaryRow) {
  return {
    id: row.id,
    kickoff_at: iso(row.kickoff_at),
    status: row.status,
    league: row.league,
    home: row.home,
    away: row.away,
    home_goals: row.home_goals,
    away_goals: row.away_goals,
    data_origin: row.data_origin,
  };
}

export function batchSummary(batch: BatchRow) {
  return {
    public_id: batch.public_id,
    scope_date: batch.scope_date,
    status: batch.status,
    warnings: batch.warnings,
    diagnostics: batch.diagnostics,
    error_code: batch.error_code,
    error_message: batch.error_message,
    started_at: iso(batch.started_at),
    finished_at: iso(batch.finished_at),
    source_data_cutoff: iso(batch.source_data_cutoff),
    time_budget_seconds: batch.time_budget_seconds,
  };
}

export async function providerRows(db: Db) {
  const rows = await db<
    { key: string; name: string; kind: string; configured: boolean; health_status: string; last_checked_at: Date | null; last_error: string | null; quota_remaining: number | null }[]
  >`SELECT key, name, kind, configured, health_status, last_checked_at, last_error, quota_remaining FROM providers ORDER BY key`;
  return rows.map((row) => ({ ...row, last_checked_at: iso(row.last_checked_at) }));
}

const FIXTURE_SELECT = (db: Db) => db`
  SELECT f.id, f.kickoff_at, f.status, l.name AS league, h.name AS home, a.name AS away, f.home_goals, f.away_goals, f.data_origin,
         f.league_id, f.home_team_id, f.away_team_id
  FROM fixtures f
  LEFT JOIN leagues l ON l.id = f.league_id
  LEFT JOIN teams h ON h.id = f.home_team_id
  LEFT JOIN teams a ON a.id = f.away_team_id`;

export async function overview(db: Db, settings: Settings, scope: string) {
  const start = new Date(`${scope}T00:00:00Z`);
  const end = new Date(`${addDays(scope, 1)}T00:00:00Z`);
  const fixtures = await db<FixtureSummaryRow[]>`
    ${FIXTURE_SELECT(db)} WHERE f.kickoff_at >= ${start} AND f.kickoff_at < ${end} ORDER BY f.kickoff_at, f.id`;
  const [latestOdds] = await db<{ latest: Date | null }[]>`SELECT max(captured_at) AS latest FROM odds_snapshots`;
  let latestRun = await latestBatchForDate(db, scope);
  if (latestRun === null) {
    const [row] = await db<BatchRow[]>`SELECT * FROM prediction_batches WHERE scope_date = ${scope} ORDER BY started_at DESC LIMIT 1`;
    latestRun = row ?? null;
  }
  const [settled] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM predictions WHERE outcome IS NOT NULL`;
  const config = await effectiveSettings(db, settings);
  return {
    timezone: "UTC",
    scope_date: scope,
    generated_at: new Date().toISOString(),
    providers: await providerRows(db),
    fixture_counts: {
      scheduled: fixtures.filter((item) => item.status === "scheduled").length,
      completed: fixtures.filter((item) => item.status === "completed").length,
      synthetic: fixtures.filter((item) => item.data_origin === "synthetic_demo").length,
    },
    fixtures: fixtures.map(fixtureSummary),
    latest_odds_captured_at: iso(latestOdds?.latest ?? null),
    latest_run: latestRun === null ? null : batchSummary(latestRun),
    warnings: latestRun === null ? [] : latestRun.warnings.filter((warning) => !perFixtureWarning(warning)),
    recent_performance: {
      settled_predictions: settled.count,
      note: "No return is shown until priced settlements exist. Sample size is reported with every metric.",
    },
    settings: { allow_synthetic: config.allow_synthetic, odds_freshness_minutes: config.odds_freshness_minutes },
  };
}

type CompletedRow = { kickoff_at: Date; home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null };

function form(completed: CompletedRow[], teamId: number): string[] {
  return completed
    .filter((item) => item.home_team_id === teamId || item.away_team_id === teamId)
    .sort((a, b) => b.kickoff_at.getTime() - a.kickoff_at.getTime())
    .slice(0, 5)
    .filter((item) => item.home_goals !== null && item.away_goals !== null)
    .map((item) => {
      const [scored, conceded] = item.home_team_id === teamId ? [item.home_goals!, item.away_goals!] : [item.away_goals!, item.home_goals!];
      return scored > conceded ? "W" : scored === conceded ? "D" : "L";
    });
}

function split(completed: CompletedRow[], teamId: number, atHome: boolean) {
  const rows: [number, number][] = [];
  for (const item of completed) {
    if (atHome && item.home_team_id === teamId && item.home_goals !== null) rows.push([item.home_goals, item.away_goals ?? 0]);
    if (!atHome && item.away_team_id === teamId && item.away_goals !== null) rows.push([item.away_goals, item.home_goals ?? 0]);
  }
  return {
    matches: rows.length,
    goals_for: rows.reduce((sum, item) => sum + item[0], 0),
    goals_against: rows.reduce((sum, item) => sum + item[1], 0),
  };
}

export async function fixtureDetail(db: Db, fixtureId: number) {
  const [fixture] = await db<(FixtureSummaryRow & { league_id: number; home_team_id: number; away_team_id: number })[]>`
    ${FIXTURE_SELECT(db)} WHERE f.id = ${fixtureId}`;
  if (!fixture) return null;
  const [stats] = await db<
    { home_corners: number | null; away_corners: number | null; home_cards: number | null; away_cards: number | null; home_xg: string | null; away_xg: string | null; source: string }[]
  >`SELECT home_corners, away_corners, home_cards, away_cards, home_xg, away_xg, source FROM match_statistics WHERE fixture_id = ${fixtureId}`;
  const completed = await db<CompletedRow[]>`
    SELECT kickoff_at, home_team_id, away_team_id, home_goals, away_goals FROM fixtures
    WHERE league_id = ${fixture.league_id} AND status = 'completed' AND kickoff_at < ${fixture.kickoff_at}
      AND (home_team_id IN (${fixture.home_team_id}, ${fixture.away_team_id}) OR away_team_id IN (${fixture.home_team_id}, ${fixture.away_team_id}))`;
  const [latest] = await db<{ feature_snapshot_id: number; version_key: string | null; payload: Record<string, unknown> | null }[]>`
    SELECT p.feature_snapshot_id, m.version_key, s.payload
    FROM predictions p
    LEFT JOIN model_versions m ON m.id = p.model_version_id
    LEFT JOIN feature_snapshots s ON s.id = p.feature_snapshot_id
    WHERE p.fixture_id = ${fixtureId} AND p.market_key = 'match_result'
    ORDER BY p.id DESC LIMIT 1`;
  let predictions: Record<string, unknown>[] = [];
  if (latest) {
    predictions = await db`
      SELECT market_key, selection, line, probability, elo_probability, fair_odds, implementation_status, data_quality, sample_size
      FROM predictions WHERE feature_snapshot_id = ${latest.feature_snapshot_id} ORDER BY id`;
  }
  return {
    fixture: fixtureSummary(fixture),
    league_id: fixture.league_id,
    measured: {
      home_form: form(completed, fixture.home_team_id),
      away_form: form(completed, fixture.away_team_id),
      home_record: split(completed, fixture.home_team_id, true),
      away_record: split(completed, fixture.away_team_id, false),
      match_statistics: stats ?? null,
    },
    model: {
      available: predictions.length > 0,
      model_version: latest?.version_key ?? null,
      scoreline: latest?.payload?.scoreline ?? null,
      elo: latest?.payload?.elo ?? null,
      predictions,
      note: "Scoreline cells are model estimates. Form and goals tables are measured historical results.",
    },
    unavailable_markets: MARKETS.filter((market) => ["insufficient_data", "unsupported", "experimental", "mapping_required"].includes(market.implementationStatus)).map(
      (market) => ({
        key: market.key,
        display_name: market.displayName,
        implementation_status: market.implementationStatus,
        required_data: market.requiredData,
      }),
    ),
  };
}

export type ExplorerFilters = {
  date?: string | null;
  league_id?: number | null;
  fixture_id?: number | null;
  market_key?: string | null;
  family?: string | null;
  status?: string | null;
  min_probability?: number | null;
  min_odds?: number | null;
  max_odds?: number | null;
  exclude_trivia?: boolean;
};

/** Predictions from the latest run for each fixture, filtered in the database before the limit. */
export async function explorer(db: Db, filters: ExplorerFilters, limit = 500) {
  const familyKeys = filters.family ? MARKETS.filter((item) => item.family === filters.family).map((item) => item.key) : null;
  const dayStart = filters.date ? new Date(`${filters.date}T00:00:00Z`) : null;
  const dayEnd = filters.date ? new Date(`${addDays(filters.date, 1)}T00:00:00Z`) : null;
  const rows = await db<
    (FixtureSummaryRow & {
      market_key: string;
      selection: string;
      line: string | null;
      probability: string;
      fair_odds: string | null;
      implementation_status: string;
      data_quality: string | null;
      version_key: string | null;
      decimal_odds: string | null;
      captured_at: Date | null;
      odds_origin: string | null;
      bookmaker: string | null;
      bookmaker_id: number | null;
      elo_probability: string | null;
    })[]
  >`
    WITH latest AS (SELECT fixture_id, max(batch_id) AS batch_id FROM predictions GROUP BY fixture_id)
    SELECT f.id, f.kickoff_at, f.status, l.name AS league, h.name AS home, a.name AS away, f.home_goals, f.away_goals, f.data_origin,
           p.market_key, p.selection, p.line, p.probability, p.elo_probability, p.fair_odds, p.implementation_status, p.data_quality, m.version_key,
           o.decimal_odds, o.captured_at, o.data_origin AS odds_origin, b.name AS bookmaker, o.bookmaker_id
    FROM predictions p
    JOIN latest ON latest.fixture_id = p.fixture_id AND latest.batch_id = p.batch_id
    JOIN fixtures f ON f.id = p.fixture_id
    LEFT JOIN leagues l ON l.id = f.league_id
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN model_versions m ON m.id = p.model_version_id
    LEFT JOIN odds_snapshots o ON o.id = p.odds_snapshot_id
    LEFT JOIN bookmakers b ON b.id = o.bookmaker_id
    WHERE TRUE
      ${filters.market_key ? db`AND p.market_key = ${filters.market_key}` : db``}
      ${familyKeys ? db`AND p.market_key IN ${db(familyKeys.length ? familyKeys : ["__none__"])}` : db``}
      ${filters.status ? db`AND p.implementation_status = ${filters.status}` : db``}
      ${filters.min_probability !== null && filters.min_probability !== undefined ? db`AND p.probability >= ${filters.min_probability}` : db``}
      ${dayStart && dayEnd ? db`AND f.kickoff_at >= ${dayStart} AND f.kickoff_at < ${dayEnd}` : db``}
      ${filters.league_id ? db`AND f.league_id = ${filters.league_id}` : db``}
      ${filters.fixture_id ? db`AND f.id = ${filters.fixture_id}` : db``}
    ORDER BY f.kickoff_at, p.probability DESC
    LIMIT ${limit * 3}`;
  const groups = await latestOddsGroups(db, [...new Set(rows.map((row) => row.id))]);
  const excludeTrivia = filters.exclude_trivia ?? true;
  const payload = [];
  for (const row of rows) {
    const odds = row.decimal_odds === null ? null : Number(row.decimal_odds);
    if (odds !== null && filters.min_odds !== null && filters.min_odds !== undefined && odds < filters.min_odds) continue;
    if (odds !== null && filters.max_odds !== null && filters.max_odds !== undefined && odds > filters.max_odds) continue;
    if (excludeTrivia && isTrivialSelection(row.market_key, row.line, odds)) continue;
    const market = MARKET_BY_KEY[row.market_key];
    payload.push({
      ...fixtureSummary(row),
      fixture_id: row.id,
      market_key: row.market_key,
      market_name: market ? market.displayName : null,
      family: market ? market.family : null,
      selection: row.selection,
      line: row.line,
      probability: row.probability,
      elo_probability: row.elo_probability,
      fair_odds: row.fair_odds,
      decimal_odds: row.decimal_odds,
      implied_probability: odds === null ? null : impliedFor(row.id, row.bookmaker_id, row.market_key, row.line, odds, groups).toFixed(8),
      captured_at: iso(row.captured_at),
      bookmaker: row.bookmaker,
      data_origin: odds === null ? row.data_origin : row.odds_origin,
      implementation_status: row.implementation_status,
      data_quality: row.data_quality,
      model_version: row.version_key,
      estimated_value: odds === null ? null : (Number(row.probability) * odds - 1).toFixed(8),
    });
    if (payload.length >= limit) break;
  }
  payload.sort(
    (a, b) =>
      (a.implied_probability === null ? 1 : 0) - (b.implied_probability === null ? 1 : 0) ||
      Number(b.implied_probability ?? 0) - Number(a.implied_probability ?? 0) ||
      Number(b.probability ?? 0) - Number(a.probability ?? 0) ||
      (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? ""),
  );
  return payload;
}

type SettledRow = { market_key: string; probability: string; outcome: string; decimal_odds: string | null; odds_origin: string | null };

function scoreGroup(rows: SettledRow[]) {
  if (rows.length < 20) return { status: "insufficient_data", observations: rows.length };
  const byMarket = new Map<string, SettledRow[]>();
  for (const row of rows) byMarket.set(row.market_key, [...(byMarket.get(row.market_key) ?? []), row]);
  const markets: Record<string, unknown> = {};
  for (const [key, group] of byMarket) {
    const outcomes = group.map((item) => (item.outcome === "won" ? 1 : 0));
    if (group.length < 20 || new Set(outcomes).size < 2) {
      markets[key] = { status: "insufficient_data", observations: group.length };
      continue;
    }
    const probabilities = group.map((item) => Number(item.probability));
    markets[key] = {
      status: "estimated",
      observations: group.length,
      brier_score: brierScore(outcomes, probabilities),
      log_loss: logLoss(outcomes, probabilities),
    };
  }
  return { status: "estimated", observations: rows.length, by_market: markets };
}

async function calibration(db: Db, settings: Settings) {
  const config = await effectiveSettings(db, settings);
  const rows = await db<{ market_key: string; probability: string; implied_probability: string | null; elo_probability: string | null; priced: boolean; outcome: string }[]>`
    SELECT DISTINCT ON (p.fixture_id, p.market_key, p.selection, p.line)
           p.market_key, p.probability, p.implied_probability, p.elo_probability, p.odds_snapshot_id IS NOT NULL AS priced, p.outcome
    FROM predictions p JOIN fixtures f ON f.id = p.fixture_id
    WHERE p.outcome IN ('won', 'lost') AND p.implementation_status = 'supported' AND p.market_key IN ${db([...PICK_MARKETS])}
      AND f.data_origin <> 'synthetic_demo'
    ORDER BY p.fixture_id, p.market_key, p.selection, p.line, p.batch_id DESC`;
  return calibrationReport(
    rows.map((row) => ({
      marketKey: row.market_key,
      probability: Number(row.probability),
      implied: row.implied_probability === null ? null : Number(row.implied_probability),
      elo: row.elo_probability === null ? null : Number(row.elo_probability),
      priced: row.priced,
      won: row.outcome === "won",
    })),
    Number(config.min_pick_probability),
  );
}

export async function performance(db: Db, settings: Settings) {
  const rows = await db<(SettledRow & { fixture_origin: string })[]>`
    SELECT p.market_key, p.probability, p.outcome, o.decimal_odds, o.data_origin AS odds_origin, f.data_origin AS fixture_origin
    FROM predictions p
    JOIN fixtures f ON f.id = p.fixture_id
    LEFT JOIN odds_snapshots o ON o.id = p.odds_snapshot_id
    WHERE p.outcome IN ('won', 'lost')
    ORDER BY p.id`;
  const real = rows.filter((row) => row.fixture_origin !== "synthetic_demo");
  const synthetic = rows.filter((row) => row.fixture_origin === "synthetic_demo");
  const evaluations = await db<
    { id: number; status: string; metrics: unknown; sample_sizes: unknown; notes: string; started_at: Date; finished_at: Date | null }[]
  >`SELECT id, status, metrics, sample_sizes, notes, started_at, finished_at FROM evaluation_runs ORDER BY id DESC`;
  return {
    settled_real: scoreGroup(real),
    settled_synthetic: scoreGroup(synthetic),
    calibration: await calibration(db, settings),
    evaluation_runs: evaluations.map((run) => ({ ...run, started_at: iso(run.started_at), finished_at: iso(run.finished_at) })),
    simulated_returns: simulateUnitReturns(
      real
        .filter((row) => row.decimal_odds !== null && row.odds_origin !== "synthetic_demo")
        .map((row) => ({ decimalOdds: Number(row.decimal_odds), won: row.outcome === "won" })),
    ),
    disclaimer: "Simulated results are not a betting history and do not imply future profit.",
  };
}

export async function coverage(db: Db, settings: Settings) {
  const leagues = await db<{ id: number; name: string; data_origin: string }[]>`SELECT id, name, data_origin FROM leagues ORDER BY name`;
  const mappings = await db`
    SELECT b.key AS bookmaker, m.key AS market_key, x.provider_market_key, x.status, x.notes
    FROM bookmaker_market_mappings x
    LEFT JOIN bookmakers b ON b.id = x.bookmaker_id
    LEFT JOIN market_definitions m ON m.id = x.market_definition_id
    ORDER BY x.id`;
  return {
    providers: await providerRows(db),
    leagues,
    markets: marketCatalog(),
    mappings,
    settings: await effectiveSettings(db, settings),
    secrets: {
      api_football_configured: Boolean(settings.apiFootballKey),
      odds_api_configured: Boolean(settings.oddsApiKey),
      football_data_configured: Boolean(settings.footballDataApiKey),
    },
  };
}

export async function ingestionLog(db: Db) {
  const rows = await db<
    { id: number; provider: string | null; kind: string; status: string; records_written: number; error_message: string | null; details: unknown; started_at: Date; finished_at: Date | null }[]
  >`
    SELECT r.id, p.key AS provider, r.kind, r.status, r.records_written, r.error_message, r.details, r.started_at, r.finished_at
    FROM ingestion_runs r LEFT JOIN providers p ON p.id = r.provider_id
    ORDER BY r.id DESC LIMIT 50`;
  return rows.map((row) => ({ ...row, started_at: iso(row.started_at), finished_at: iso(row.finished_at) }));
}
