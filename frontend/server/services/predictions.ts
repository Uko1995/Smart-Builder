/** Prediction runs. Status is persisted before the response is returned. */

import { randomUUID } from "node:crypto";
import type { Settings } from "@/server/config";
import type { Db, Sql } from "@/server/db/client";
import { addDays } from "@/server/http";
import {
  CARD_LINES,
  CORNER_LINES,
  TEAM_CORNER_LINES,
  deriveFirstHalfMarkets,
  deriveGoalMarkets,
  deriveTotalMarkets,
  fairOdds,
  unitsToString,
  type DerivedEntry,
} from "@/server/engine/markets";
import { MAX_CORNERS, scorelineMatrix } from "@/server/engine/scoreline";
import { estimateCountRates, estimateGoalRates, selectRho, type HistoricalMatch, type RateEstimate } from "@/server/engine/strengths";
import { MARKET_BY_KEY, MODEL_VERSION_KEY } from "@/server/markets/registry";
import { refreshProviders } from "@/server/services/ingestion";
import { effectiveSettings, seedReference, type EffectiveSettings } from "@/server/services/reference";

export const TERMINAL = new Set(["succeeded", "succeeded_with_warnings", "failed", "insufficient_data", "no_qualifying_slips"]);

export type BatchRow = {
  id: number;
  public_id: string;
  scope_date: string;
  league_id: number | null;
  status: string;
  idempotency_key: string;
  request_payload: Record<string, unknown>;
  warnings: string[];
  diagnostics: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  time_budget_seconds: number;
  source_data_cutoff: Date | null;
  started_at: Date;
  finished_at: Date | null;
};

export class PredictionRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public batch: BatchRow | null = null,
  ) {
    super(message);
  }
}

class BudgetExceeded extends Error {}

async function loadBatch(db: Db, id: number): Promise<BatchRow> {
  const [row] = await db<BatchRow[]>`SELECT * FROM prediction_batches WHERE id = ${id}`;
  return row;
}

async function finish(
  db: Db,
  batchId: number,
  status: string,
  extra: { errorCode?: string; errorMessage?: string; warnings?: string[]; diagnostics?: Record<string, unknown> } = {},
): Promise<void> {
  await db`
    UPDATE prediction_batches SET status = ${status}, error_code = ${extra.errorCode ?? null}, error_message = ${extra.errorMessage ?? null},
      warnings = COALESCE(${extra.warnings ? db.json(extra.warnings) : null}::jsonb, warnings),
      diagnostics = COALESCE(${extra.diagnostics ? db.json(extra.diagnostics as never) : null}::jsonb, diagnostics),
      finished_at = now()
    WHERE id = ${batchId}`;
}

async function expireStaleRuns(db: Db): Promise<void> {
  await db`
    UPDATE prediction_batches SET status = 'failed', error_code = 'interrupted',
      error_message = 'The run did not finish within its time budget and was marked failed so it can be retried.',
      finished_at = now()
    WHERE status = 'running' AND started_at + make_interval(secs => time_budget_seconds + 30) < now()`;
}

export async function createPredictionRun(
  sql: Sql,
  settings: Settings,
  options: { scopeDate: string; leagueId: number | null; idempotencyKey: string; refresh: boolean; timeBudgetSeconds?: number | null },
): Promise<{ batch: BatchRow; created: boolean }> {
  await seedReference(sql, settings);
  const config = await effectiveSettings(sql, settings);
  const payload = { scope_date: options.scopeDate, league_id: options.leagueId, refresh: options.refresh };
  const [existing] = await sql<BatchRow[]>`SELECT * FROM prediction_batches WHERE idempotency_key = ${options.idempotencyKey}`;
  if (existing) {
    if (JSON.stringify(existing.request_payload) !== JSON.stringify(payload)) {
      throw new PredictionRequestError(409, "idempotency_conflict", "This idempotency key was already used for a different request.", existing);
    }
    return { batch: existing, created: false };
  }
  await expireStaleRuns(sql);
  const [running] = await sql<BatchRow[]>`SELECT * FROM prediction_batches WHERE scope_date = ${options.scopeDate} AND status = 'running'`;
  if (running) throw new PredictionRequestError(409, "run_in_progress", "A prediction run for this date is already in progress.", running);

  const requested = options.timeBudgetSeconds ?? config.prediction_time_budget_seconds;
  const budget = Math.max(5, Math.min(Math.trunc(requested), settings.predictionTimeBudgetCapSeconds));
  const inserted = await sql<{ id: number }[]>`
    INSERT INTO prediction_batches (public_id, scope_date, league_id, status, idempotency_key, request_payload, warnings, diagnostics,
                                    time_budget_seconds, source_data_cutoff, started_at)
    VALUES (${randomUUID()}, ${options.scopeDate}, ${options.leagueId}, 'running', ${options.idempotencyKey}, ${sql.json(payload)},
            '[]'::jsonb, '{}'::jsonb, ${budget}, now(), now())
    ON CONFLICT ON CONSTRAINT uq_prediction_idempotency DO NOTHING
    RETURNING id`;
  if (!inserted.length) {
    const [again] = await sql<BatchRow[]>`SELECT * FROM prediction_batches WHERE idempotency_key = ${options.idempotencyKey}`;
    return { batch: again, created: false };
  }
  const batchId = inserted[0].id;
  const started = Date.now();
  try {
    if (options.refresh) {
      const runs = await refreshProviders(sql, settings, { dateFrom: options.scopeDate, dateTo: options.scopeDate, scope: "odds" });
      if (runs.some((item) => item.status === "failed")) {
        const message = "An odds refresh failed, so no prediction batch was produced.";
        await finish(sql, batchId, "failed", {
          errorCode: "ingestion_failed",
          errorMessage: message,
          diagnostics: { ingestion_run_ids: runs.map((item) => item.id) },
        });
        throw new PredictionRequestError(502, "ingestion_failed", message, await loadBatch(sql, batchId));
      }
    }
    await sql.begin((tx) => generate(tx, settings, batchId, options.scopeDate, options.leagueId, config, started, budget));
    return { batch: await loadBatch(sql, batchId), created: true };
  } catch (error) {
    if (error instanceof PredictionRequestError) throw error;
    if (error instanceof BudgetExceeded) {
      const message = "The run exceeded its time budget. Raise the budget in Settings or run it from the command line.";
      await finish(sql, batchId, "failed", { errorCode: "time_budget_exceeded", errorMessage: message });
      throw new PredictionRequestError(504, "time_budget_exceeded", message, await loadBatch(sql, batchId));
    }
    console.error("prediction run failed", error);
    const message = "Prediction generation failed before a result could be stored.";
    await finish(sql, batchId, "failed", { errorCode: "prediction_failed", errorMessage: message });
    throw new PredictionRequestError(500, "prediction_failed", message, await loadBatch(sql, batchId));
  }
}

type FixtureRow = {
  id: number;
  league_id: number;
  home_team_id: number;
  away_team_id: number;
  kickoff_at: Date;
  data_origin: string;
  home: string | null;
  away: string | null;
  league: string | null;
};

type PredictionInsert = {
  batch_id: number;
  fixture_id: number;
  market_key: string;
  selection: string;
  line: string | null;
  probability: string;
  fair_odds: string | null;
  model_version_id: number;
  feature_snapshot_id: number;
  odds_snapshot_id: number | null;
  data_quality: string;
  sample_size: number;
  implementation_status: string;
  details: string;
};

function names(fixture: FixtureRow): string {
  return `${fixture.home ?? "Home"} vs ${fixture.away ?? "Away"} (${fixture.league ?? "League"})`;
}

function lineKey(line: number | string | null): string {
  return line === null ? "" : Number(line).toFixed(2);
}

async function loadHistory(db: Db, allowSynthetic: boolean, leagueIds: number[], since: Date): Promise<HistoricalMatch[]> {
  if (!leagueIds.length) return [];
  const rows = await db<
    {
      id: number;
      league_id: number;
      kickoff_at: Date;
      home_team_id: number;
      away_team_id: number;
      home_goals: number;
      away_goals: number;
      ht_home_goals: number | null;
      ht_away_goals: number | null;
      home_corners: number | null;
      away_corners: number | null;
      home_cards: number | null;
      away_cards: number | null;
    }[]
  >`
    SELECT f.id, f.league_id, f.kickoff_at, f.home_team_id, f.away_team_id, f.home_goals, f.away_goals, f.ht_home_goals, f.ht_away_goals,
           s.home_corners, s.away_corners, s.home_cards, s.away_cards
    FROM fixtures f LEFT JOIN match_statistics s ON s.fixture_id = f.id
    WHERE f.status = 'completed' AND f.league_id IN ${db(leagueIds)} AND f.kickoff_at >= ${since}
      AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
      AND (${allowSynthetic} OR f.data_origin <> 'synthetic_demo')`;
  return rows.map((row) => ({
    matchId: String(row.id),
    leagueId: String(row.league_id),
    kickoff: row.kickoff_at.getTime(),
    homeId: String(row.home_team_id),
    awayId: String(row.away_team_id),
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    htHomeGoals: row.ht_home_goals,
    htAwayGoals: row.ht_away_goals,
    homeCorners: row.home_corners,
    awayCorners: row.away_corners,
    homeCards: row.home_cards,
    awayCards: row.away_cards,
  }));
}

function toInsert(
  batchId: number,
  fixtureId: number,
  modelId: number,
  snapshotId: number,
  item: DerivedEntry,
  quality: string,
  sampleSize: number,
  status: string,
): PredictionInsert {
  return {
    batch_id: batchId,
    fixture_id: fixtureId,
    market_key: item.marketKey,
    selection: item.selection,
    line: item.line === null ? null : item.line.toFixed(2),
    probability: unitsToString(item.units),
    fair_odds: fairOdds(item.units),
    model_version_id: modelId,
    feature_snapshot_id: snapshotId,
    odds_snapshot_id: null,
    data_quality: quality,
    sample_size: sampleSize,
    implementation_status: status,
    details: JSON.stringify(item.details ?? {}),
  };
}

function sideMarkets(
  history: HistoricalMatch[],
  fixture: FixtureRow,
  minMatches: number,
  push: (items: DerivedEntry[], estimate: RateEstimate, status: (key: string) => string) => void,
): string[] {
  const missing: string[] = [];
  const home = String(fixture.home_team_id);
  const away = String(fixture.away_team_id);
  const cutoff = fixture.kickoff_at.getTime();
  // Data is present, so the registry default of insufficient_data is raised to supported.
  const raised = (key: string) => {
    const status = MARKET_BY_KEY[key].implementationStatus;
    return status === "insufficient_data" ? "supported" : status;
  };
  const corners = estimateCountRates(history, home, away, cutoff, minMatches, "corners");
  if (corners === null) missing.push("corners");
  else {
    const matrix = scorelineMatrix(corners.lambdaHome, corners.lambdaAway, 0, MAX_CORNERS);
    push(deriveTotalMarkets(matrix, "match_corners", CORNER_LINES, "team_corners_home", "team_corners_away", TEAM_CORNER_LINES, TEAM_CORNER_LINES), corners, raised);
  }
  const cards = estimateCountRates(history, home, away, cutoff, minMatches, "cards");
  if (cards === null) missing.push("cards");
  else {
    const matrix = scorelineMatrix(cards.lambdaHome, cards.lambdaAway, 0, 12);
    push(deriveTotalMarkets(matrix, "match_cards", CARD_LINES, "team_cards_home", "team_cards_away", CARD_LINES, CARD_LINES), cards, () => "supported");
  }
  const half = estimateCountRates(history, home, away, cutoff, minMatches, "first_half");
  if (half === null) missing.push("first_half");
  else {
    const matrix = scorelineMatrix(half.lambdaHome, half.lambdaAway, 0);
    push(deriveFirstHalfMarkets(matrix), half, () => "supported");
  }
  return missing;
}

async function generate(
  tx: Db,
  settings: Settings,
  batchId: number,
  scopeDate: string,
  leagueId: number | null,
  config: EffectiveSettings,
  started: number,
  budgetSeconds: number,
): Promise<void> {
  const allowSynthetic = Boolean(config.allow_synthetic);
  const start = new Date(`${scopeDate}T00:00:00Z`);
  const end = new Date(`${addDays(scopeDate, 1)}T00:00:00Z`);
  const fixtures = await tx<FixtureRow[]>`
    SELECT f.id, f.league_id, f.home_team_id, f.away_team_id, f.kickoff_at, f.data_origin, h.name AS home, a.name AS away, l.name AS league
    FROM fixtures f
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN leagues l ON l.id = f.league_id
    WHERE f.kickoff_at >= ${start} AND f.kickoff_at < ${end} AND f.status = 'scheduled'
      AND (${leagueId}::bigint IS NULL OR f.league_id = ${leagueId})
      AND (${allowSynthetic} OR f.data_origin <> 'synthetic_demo')
    ORDER BY f.kickoff_at, f.id`;
  const warnings: string[] = [];
  if (!fixtures.length) {
    await finish(tx, batchId, "insufficient_data", { warnings: ["No scheduled fixtures are stored for this date."], diagnostics: { fixtures: 0 } });
    return;
  }
  const [model] = await tx<{ id: number }[]>`SELECT id FROM model_versions WHERE version_key = ${MODEL_VERSION_KEY}`;
  if (!model) throw new Error("model version is not seeded");
  await tx`UPDATE prediction_batches SET model_version_id = ${model.id} WHERE id = ${batchId}`;
  const historySince = new Date(start.getTime() - settings.predictionHistoryDays * 86_400_000);
  const history = await loadHistory(tx, allowSynthetic, [...new Set(fixtures.map((item) => item.league_id))], historySince);
  const historyByLeague = new Map<string, HistoricalMatch[]>();
  for (const match of history) {
    const rows = historyByLeague.get(match.leagueId) ?? [];
    rows.push(match);
    historyByLeague.set(match.leagueId, rows);
  }
  const minMatches = Math.trunc(config.min_team_matches);
  const rhoMin = Math.trunc(config.rho_min_matches);
  const rhoByLeague = new Map<string, number>();
  const predictions: PredictionInsert[] = [];
  let syntheticUsed = false;

  for (const fixture of fixtures) {
    if (Date.now() - started > budgetSeconds * 1000) throw new BudgetExceeded();
    if (fixture.data_origin === "synthetic_demo") syntheticUsed = true;
    const leagueKey = String(fixture.league_id);
    const leagueHistory = historyByLeague.get(leagueKey) ?? [];
    if (!rhoByLeague.has(leagueKey)) {
      const prior = leagueHistory.filter((match) => match.kickoff < start.getTime()).length;
      rhoByLeague.set(leagueKey, prior >= rhoMin ? selectRho(leagueHistory, start.getTime()) : 0);
    }
    const estimate = estimateGoalRates(
      leagueHistory,
      String(fixture.home_team_id),
      String(fixture.away_team_id),
      fixture.kickoff_at.getTime(),
      minMatches,
      rhoMin,
      rhoByLeague.get(leagueKey),
    );
    if (estimate === null || fixture.home === null || fixture.away === null) {
      warnings.push(`${names(fixture)} was skipped: fewer than ${minMatches} completed matches for one or both teams.`);
      continue;
    }
    const matrix = scorelineMatrix(estimate.lambdaHome, estimate.lambdaAway, estimate.rho);
    const [snapshot] = await tx<{ id: number }[]>`
      INSERT INTO feature_snapshots (model_version_id, fixture_id, training_cutoff, payload)
      VALUES (${model.id}, ${fixture.id}, ${fixture.kickoff_at}, ${tx.json({
        lambda_home: estimate.lambdaHome,
        lambda_away: estimate.lambdaAway,
        rho: estimate.rho,
        rho_source: estimate.rhoSource,
        home_matches: estimate.homeMatches,
        away_matches: estimate.awayMatches,
        league_matches: estimate.leagueMatches,
        quality: estimate.quality,
        clamped: estimate.clamped,
        scoreline: matrix.map((row) => row.map((value) => Number(value.toFixed(8)))),
        data_origin: fixture.data_origin,
      })})
      RETURNING id`;
    const quality = estimate.quality.toFixed(4);
    for (const item of deriveGoalMarkets(matrix)) {
      predictions.push(
        toInsert(batchId, fixture.id, model.id, snapshot.id, item, quality, estimate.leagueMatches, MARKET_BY_KEY[item.marketKey].implementationStatus),
      );
    }
    const missing = sideMarkets(leagueHistory, fixture, minMatches, (items, rates, status) => {
      for (const item of items) {
        predictions.push(toInsert(batchId, fixture.id, model.id, snapshot.id, item, quality, rates.leagueMatches, status(item.marketKey)));
      }
    });
    const labels: Record<string, string> = { corners: "Corner", cards: "Card", first_half: "First-half" };
    for (const kind of missing) {
      warnings.push(`${labels[kind]} markets are unavailable for ${names(fixture)} because the required history is incomplete.`);
    }
  }
  if (syntheticUsed) warnings.push("This run includes synthetic demonstration fixtures. They are not real results or prices.");
  if (!predictions.length) {
    await finish(tx, batchId, "insufficient_data", {
      warnings: warnings.length ? warnings : ["Historical samples were too small to estimate a scoreline."],
      diagnostics: { fixtures: fixtures.length, predictions: 0 },
    });
    return;
  }
  const priced = await linkOdds(tx, predictions);
  for (let index = 0; index < predictions.length; index += 1000) {
    await tx`INSERT INTO predictions ${tx(predictions.slice(index, index + 1000) as never)}`;
  }
  await finish(tx, batchId, warnings.length ? "succeeded_with_warnings" : "succeeded", {
    warnings,
    diagnostics: {
      fixtures: fixtures.length,
      predictions: predictions.length,
      priced,
      note: "Picks are ranked after the run. Accumulators are not generated.",
    },
  });
}

/** Link each supported prediction to the freshest stored price for the same selection. */
async function linkOdds(db: Db, predictions: PredictionInsert[]): Promise<number> {
  const fixtureIds = [...new Set(predictions.map((item) => item.fixture_id))];
  const rows = await db<{ id: number; fixture_id: number; market_key: string; selection: string; line: string | null; captured_at: Date }[]>`
    SELECT id, fixture_id, market_key, selection, line, captured_at FROM odds_snapshots WHERE fixture_id IN ${db(fixtureIds)}`;
  const latest = new Map<string, { id: number; captured: number }>();
  for (const row of rows) {
    const key = `${row.fixture_id}|${row.market_key}|${row.selection}|${lineKey(row.line)}`;
    const current = latest.get(key);
    if (!current || row.captured_at.getTime() > current.captured) latest.set(key, { id: row.id, captured: row.captured_at.getTime() });
  }
  let priced = 0;
  for (const prediction of predictions) {
    if (prediction.implementation_status !== "supported") continue;
    const match = latest.get(`${prediction.fixture_id}|${prediction.market_key}|${prediction.selection}|${lineKey(prediction.line)}`);
    if (!match) continue;
    prediction.odds_snapshot_id = match.id;
    priced += 1;
  }
  return priced;
}

/**
 * Keeps Neon's free tier small. Unpriced predictions are dropped after the
 * retention window; priced ones stay because they are the pick track record.
 */
export async function pruneOldPredictions(db: Db, retentionDays: number): Promise<{ predictions: number; snapshots: number }> {
  const predictions = await db`
    DELETE FROM predictions p USING prediction_batches b
    WHERE p.batch_id = b.id AND b.scope_date < (now() at time zone 'utc')::date - ${retentionDays}::int
      AND p.odds_snapshot_id IS NULL`;
  const snapshots = await db`
    DELETE FROM feature_snapshots s
    WHERE s.created_at < now() - make_interval(days => ${retentionDays})
      AND NOT EXISTS (SELECT 1 FROM predictions p WHERE p.feature_snapshot_id = s.id)`;
  return { predictions: predictions.count, snapshots: snapshots.count };
}
