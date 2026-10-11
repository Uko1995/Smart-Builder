/** HTTP API served from Next.js route handlers. Everything except health checks requires a session. */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decodeToken } from "@/server/auth";
import { getSettings, type Settings } from "@/server/config";
import { getDb, type Sql } from "@/server/db/client";
import { walkForwardEvaluate } from "@/server/engine/evaluate";
import type { HistoricalMatch } from "@/server/engine/strengths";
import { ApiError, errorResponse, json, parseDate, parseOptionalNumber, todayUtc } from "@/server/http";
import { MODEL_VERSION_KEY } from "@/server/markets/registry";
import { enforceRateLimit } from "@/server/rate-limit";
import { seedDemo } from "@/server/services/demo";
import { ImportErrorSet, importFixturesCsv, importOddsCsv } from "@/server/services/imports";
import { refreshProviders } from "@/server/services/ingestion";
import { dailyPicks } from "@/server/services/picks";
import { createPredictionRun, PredictionRequestError, TERMINAL, type BatchRow } from "@/server/services/predictions";
import { seedReference, updateSettings } from "@/server/services/reference";
import { recordResult } from "@/server/services/settlement";
import { isActiveUser } from "@/server/services/users";
import { batchSummary, coverage, explorer, fixtureDetail, ingestionLog, overview, performance } from "@/server/services/views";

const MARKETS_MIN_PROBABILITY = 0.5;

type Context = {
  request: Request;
  url: URL;
  params: string[];
  sql: Sql;
  settings: Settings;
  requestId: string;
};

type Handler = (context: Context) => Promise<unknown>;

type Route = { method: string; pattern: string[]; handler: Handler; public?: boolean };

const predictionSchema = z.object({
  scope_date: z.string(),
  league_id: z.number().int().nullable().optional(),
  refresh: z.boolean().default(false),
  time_budget_seconds: z.number().int().min(5).max(240).nullable().optional(),
});

const resultSchema = z.object({
  home_goals: z.number().int().min(0).max(30),
  away_goals: z.number().int().min(0).max(30),
  ht_home_goals: z.number().int().min(0).max(30).nullable().optional(),
  ht_away_goals: z.number().int().min(0).max(30).nullable().optional(),
  home_corners: z.number().int().min(0).max(40).nullable().optional(),
  away_corners: z.number().int().min(0).max(40).nullable().optional(),
  home_cards: z.number().int().min(0).max(30).nullable().optional(),
  away_cards: z.number().int().min(0).max(30).nullable().optional(),
});

const refreshSchema = z.object({
  date_from: z.string(),
  date_to: z.string(),
  season: z.string().nullable().optional(),
  force: z.boolean().default(false),
});

const settingsSchema = z.object({ changes: z.record(z.unknown()) });

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(422, "invalid_request", "The request body must be JSON.");
  }
}

function requiredDate(value: string | null, field: string): string {
  const parsed = parseDate(value, field);
  if (parsed === null) throw new ApiError(422, "invalid_request", `${field} is required.`);
  return parsed;
}

function idParam(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new ApiError(404, "not_found", `${label} not found.`);
  return Number(value);
}

function queryInt(url: URL, name: string): number | null {
  const value = parseOptionalNumber(url.searchParams.get(name), name);
  if (value !== null && !Number.isInteger(value)) throw new ApiError(422, "invalid_request", `${name} must be an integer.`);
  return value;
}

async function evaluation(sql: Sql, settings: Settings) {
  const rows = await sql<{ id: number; league_id: number; kickoff_at: Date; home_team_id: number; away_team_id: number; home_goals: number; away_goals: number }[]>`
    SELECT id, league_id, kickoff_at, home_team_id, away_team_id, home_goals, away_goals FROM fixtures
    WHERE status = 'completed' AND data_origin <> 'synthetic_demo' AND home_goals IS NOT NULL AND away_goals IS NOT NULL`;
  const matches: HistoricalMatch[] = rows.map((row) => ({
    matchId: String(row.id),
    leagueId: String(row.league_id),
    kickoff: row.kickoff_at.getTime(),
    homeId: String(row.home_team_id),
    awayId: String(row.away_team_id),
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
  }));
  const metrics = walkForwardEvaluate(matches, { historyDays: settings.predictionHistoryDays, maxTest: 3000 }) as Record<string, unknown>;
  const [model] = await sql<{ id: number }[]>`SELECT id FROM model_versions WHERE version_key = ${MODEL_VERSION_KEY}`;
  await sql`
    INSERT INTO evaluation_runs (model_version_id, status, metrics, sample_sizes, notes, started_at, finished_at)
    VALUES (${model?.id ?? null}, ${String(metrics.status)}, ${sql.json(metrics as never)},
            ${sql.json({ observations: Number(metrics.observations ?? 0) })},
            'Final holdout metrics are descriptive. They were not used to choose pick thresholds.', now(), now())`;
  return { evaluation: metrics };
}

const ROUTES: Route[] = [
  {
    method: "GET",
    pattern: ["health"],
    public: true,
    handler: async ({ settings }) => ({ status: "ok", service: "soccer-prediction-lab", environment: settings.environment }),
  },
  {
    method: "GET",
    pattern: ["ready"],
    public: true,
    handler: async ({ sql }) => {
      try {
        await sql`SELECT 1`;
      } catch {
        throw new ApiError(503, "not_ready", "Database is not reachable.");
      }
      return { status: "ready", database: "ok" };
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "overview"],
    handler: async ({ sql, settings, url }) => {
      await seedReference(sql, settings);
      return overview(sql, settings, parseDate(url.searchParams.get("scope_date")) ?? todayUtc());
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "coverage"],
    handler: async ({ sql, settings }) => {
      await seedReference(sql, settings);
      return coverage(sql, settings);
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "fixtures"],
    handler: async ({ sql, settings, url }) => {
      const scope = requiredDate(url.searchParams.get("scope_date"), "scope_date");
      const payload = await overview(sql, settings, scope);
      return { scope_date: scope, fixtures: payload.fixtures };
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "fixtures", ":id"],
    handler: async ({ sql, params }) => {
      const payload = await fixtureDetail(sql, idParam(params[0], "Fixture"));
      if (payload === null) throw new ApiError(404, "not_found", "Fixture not found.");
      return payload;
    },
  },
  {
    method: "POST",
    pattern: ["api", "v1", "fixtures", ":id", "result"],
    handler: async ({ sql, params, request }) => {
      const data = resultSchema.parse(await body(request));
      try {
        return await sql.begin((tx) => recordResult(tx, idParam(params[0], "Fixture"), data));
      } catch (error) {
        if (error instanceof Error && error.message === "fixture not found") throw new ApiError(404, "not_found", error.message);
        throw error;
      }
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "markets"],
    handler: async ({ sql, settings }) => {
      await seedReference(sql, settings);
      return coverage(sql, settings);
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "odds"],
    handler: async ({ sql, url }) => {
      const scope = parseDate(url.searchParams.get("scope_date"));
      const rows = await explorer(sql, scope ? { date: scope } : {});
      return { odds: rows.filter((row) => row.decimal_odds !== null) };
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "explorer"],
    handler: async ({ sql, url }) => {
      const query = url.searchParams;
      const minProbability = parseOptionalNumber(query.get("min_probability"), "min_probability");
      return {
        min_probability_floor: MARKETS_MIN_PROBABILITY,
        rows: await explorer(sql, {
          date: parseDate(query.get("scope_date")),
          league_id: queryInt(url, "league_id"),
          fixture_id: queryInt(url, "fixture_id"),
          market_key: query.get("market_key") || null,
          family: query.get("family") || null,
          status: query.get("status") || null,
          min_probability: Math.max(minProbability ?? 0, MARKETS_MIN_PROBABILITY),
          min_odds: parseOptionalNumber(query.get("min_odds"), "min_odds"),
          max_odds: parseOptionalNumber(query.get("max_odds"), "max_odds"),
          exclude_trivia: true,
        }),
      };
    },
  },
  {
    method: "POST",
    pattern: ["api", "v1", "ingestion", "refresh"],
    handler: async ({ sql, settings, request, requestId }) => {
      const data = refreshSchema.parse(await body(request));
      const dateFrom = requiredDate(data.date_from, "date_from");
      const dateTo = requiredDate(data.date_to, "date_to");
      await enforceRateLimit(sql, "refresh", 6, 3600, "Refresh is limited.");
      await seedReference(sql, settings);
      const runs = await refreshProviders(sql, settings, { dateFrom, dateTo, season: data.season ?? null, force: data.force });
      return {
        request_id: requestId,
        runs: (await ingestionLog(sql)).slice(0, runs.length),
        failed: runs.some((run) => run.status === "failed"),
      };
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "ingestion", "runs"],
    handler: async ({ sql }) => ({ runs: await ingestionLog(sql) }),
  },
  {
    method: "POST",
    pattern: ["api", "v1", "prediction-runs"],
    handler: async ({ sql, settings, request, requestId }) => {
      const key = request.headers.get("idempotency-key");
      if (!key || key.length < 8 || key.length > 80) {
        throw new ApiError(422, "invalid_idempotency_key", "Idempotency-Key must be between 8 and 80 characters.");
      }
      const data = predictionSchema.parse(await body(request));
      const scopeDate = requiredDate(data.scope_date, "scope_date");
      await enforceRateLimit(sql, "predict", 12, 3600, "Prediction generation is limited.");
      let batch: BatchRow;
      let created: boolean;
      try {
        ({ batch, created } = await createPredictionRun(sql, settings, {
          scopeDate,
          leagueId: data.league_id ?? null,
          idempotencyKey: key,
          refresh: data.refresh,
          timeBudgetSeconds: data.time_budget_seconds ?? null,
        }));
      } catch (error) {
        if (error instanceof PredictionRequestError) throw new ApiError(error.status, error.code, error.message);
        throw error;
      }
      if (batch.status === "failed") {
        const codes: Record<string, number> = { time_budget_exceeded: 504, ingestion_failed: 502, prediction_failed: 500 };
        throw new ApiError(codes[batch.error_code ?? ""] ?? 500, batch.error_code ?? "failed", batch.error_message ?? "Prediction run failed.");
      }
      return { ...batchSummary(batch), created, request_id: requestId };
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "prediction-runs", ":id"],
    handler: async ({ sql, params }) => {
      const [batch] = await sql<BatchRow[]>`SELECT * FROM prediction_batches WHERE public_id = ${params[0]}`;
      if (!batch) throw new ApiError(404, "not_found", "Prediction run not found.");
      return { ...batchSummary(batch), terminal: TERMINAL.has(batch.status) };
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "prediction-runs"],
    handler: async ({ sql }) => {
      const rows = await sql<BatchRow[]>`SELECT * FROM prediction_batches ORDER BY started_at DESC LIMIT 30`;
      return { runs: rows.map(batchSummary) };
    },
  },
  {
    method: "GET",
    pattern: ["api", "v1", "picks"],
    handler: async ({ sql, settings, url }) => dailyPicks(sql, settings, parseDate(url.searchParams.get("scope_date")) ?? todayUtc()),
  },
  {
    method: "GET",
    pattern: ["api", "v1", "performance"],
    handler: async ({ sql }) => performance(sql),
  },
  {
    method: "GET",
    pattern: ["api", "v1", "settings"],
    handler: async ({ sql, settings }) => {
      await seedReference(sql, settings);
      return coverage(sql, settings);
    },
  },
  {
    method: "PUT",
    pattern: ["api", "v1", "settings"],
    handler: async ({ sql, settings, request }) => {
      const data = settingsSchema.parse(await body(request));
      try {
        return { settings: await updateSettings(sql, settings, data.changes) };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(422, "invalid_settings", (error as Error).message);
      }
    },
  },
  {
    method: "POST",
    pattern: ["api", "v1", "imports", "fixtures"],
    handler: async ({ sql, settings, request }) => importFixturesCsv(sql, settings, await request.text()),
  },
  {
    method: "POST",
    pattern: ["api", "v1", "imports", "odds"],
    handler: async ({ sql, settings, request }) => importOddsCsv(sql, settings, await request.text()),
  },
  {
    method: "POST",
    pattern: ["api", "v1", "demo", "seed"],
    handler: async ({ sql, settings }) => {
      if (settings.environment === "production") throw new ApiError(403, "forbidden", "Synthetic demo data cannot be seeded in production.");
      return seedDemo(sql, settings);
    },
  },
  {
    method: "POST",
    pattern: ["api", "v1", "evaluation"],
    handler: async ({ sql, settings }) => evaluation(sql, settings),
  },
];

function match(route: Route, method: string, path: string[]): string[] | null {
  if (route.method !== method || route.pattern.length !== path.length) return null;
  const params: string[] = [];
  for (const [index, part] of route.pattern.entries()) {
    if (part.startsWith(":")) params.push(path[index]);
    else if (part !== path[index]) return null;
  }
  return params;
}

export async function dispatch(request: Request, path: string[], token: string | null): Promise<Response> {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  try {
    if (path.some((segment) => segment === ".." || segment.includes("\\") || segment.includes("/"))) {
      throw new ApiError(400, "bad_path", "That path is not allowed.");
    }
    let found: { route: Route; params: string[] } | null = null;
    let pathExists = false;
    for (const route of ROUTES) {
      const params = match(route, request.method, path);
      if (params) {
        found = { route, params };
        break;
      }
      if (match({ ...route, method: request.method }, request.method, path)) pathExists = true;
    }
    if (!found) {
      throw pathExists ? new ApiError(405, "method_not_allowed", "Method not allowed.") : new ApiError(404, "not_found", "Not found.");
    }
    const settings = getSettings();
    if (!found.route.public) {
      if (!token) throw new ApiError(401, "unauthorized", "Authentication is required.");
      let username: string;
      try {
        username = await decodeToken(settings, token);
      } catch {
        throw new ApiError(401, "unauthorized", "Authentication is required.");
      }
      if (!(await isActiveUser(getDb(), username))) throw new ApiError(401, "unauthorized", "Authentication is required.");
    }
    const payload = await found.route.handler({ request, url: new URL(request.url), params: found.params, sql: getDb(), settings, requestId });
    const response = json(payload);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    const mapped = error instanceof ImportErrorSet ? new ApiError(422, "invalid_import", error.errors.join("; ")) : error;
    const response = errorResponse(mapped, requestId);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}
