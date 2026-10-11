import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const PLACEHOLDERS = new Set([
  "replace-with-a-long-password",
  "change-me",
  "replace-with-32-plus-random-chars",
  "replace-me",
]);

let loaded = false;

/** Local development keeps one `.env` at the repository root; Vercel injects variables directly. */
function loadLocalEnv() {
  if (loaded) return;
  loaded = true;
  if (process.env.VERCEL) return;
  const cwd = process.cwd();
  // Earlier files win; variables already in the environment are never overridden.
  for (const file of [".env.local", ".env", "../.env.local", "../.env"]) {
    const full = path.resolve(cwd, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
}

const bool = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase())));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  DASHBOARD_USERNAME: z.string().optional(),
  DASHBOARD_PASSWORD: z.string().optional(),
  ENVIRONMENT: z.string().default("development"),
  ALLOW_SYNTHETIC: bool.default(false),
  CRON_SECRET: z.string().optional(),
  ODDS_FRESHNESS_MINUTES: z.coerce.number().int().default(180),
  FIXTURE_REFETCH_MINUTES: z.coerce.number().int().default(360),
  ODDS_REFETCH_MINUTES: z.coerce.number().int().default(60),
  PREDICTION_TIME_BUDGET_SECONDS: z.coerce.number().int().default(25),
  PREDICTION_TIME_BUDGET_CAP_SECONDS: z.coerce.number().int().default(240),
  MIN_PICK_PROBABILITY: z.coerce.number().default(0.5),
  MIN_DATA_QUALITY: z.coerce.number().default(0.25),
  MIN_TEAM_MATCHES: z.coerce.number().int().default(5),
  PREDICTION_HISTORY_DAYS: z.coerce.number().int().default(1100),
  RHO_MIN_MATCHES: z.coerce.number().int().default(80),
  PREDICTION_RETENTION_DAYS: z.coerce.number().int().default(21),
  API_FOOTBALL_KEY: z.string().optional(),
  ODDS_API_KEY: z.string().optional(),
  FOOTBALL_DATA_API_KEY: z.string().optional(),
  ODDS_API_SPORTS: z.string().default("soccer_epl"),
  ODDS_API_BOOKMAKERS: z.string().default("onexbet"),
  ODDS_API_MARKETS: z.string().default("h2h,totals"),
  ODDS_API_EVENT_MARKETS: z.string().default(""),
  ODDS_API_MAX_EVENTS: z.coerce.number().int().default(20),
  FOOTBALL_DATA_CO_UK_ENABLED: bool.default(true),
  FOOTBALL_DATA_CO_UK_LEAGUES: z.string().default(""),
  HISTORY_SEASONS: z.coerce.number().int().default(15),
  API_FOOTBALL_LEAGUE_IDS: z.string().default(""),
  FOOTBALL_DATA_COMPETITIONS: z.string().default("PL"),
  SESSION_HOURS: z.coerce.number().int().default(12),
});

export type Settings = {
  databaseUrl: string;
  authSecret: string;
  /** Optional. Only used to create the first account when the users table is empty. */
  dashboardUsername: string | null;
  dashboardPassword: string | null;
  environment: string;
  allowSynthetic: boolean;
  cronSecret: string | null;
  oddsFreshnessMinutes: number;
  fixtureRefetchMinutes: number;
  oddsRefetchMinutes: number;
  predictionTimeBudgetSeconds: number;
  predictionTimeBudgetCapSeconds: number;
  minPickProbability: number;
  minDataQuality: number;
  minTeamMatches: number;
  predictionHistoryDays: number;
  rhoMinMatches: number;
  predictionRetentionDays: number;
  apiFootballKey: string | null;
  oddsApiKey: string | null;
  footballDataApiKey: string | null;
  oddsApiSports: string;
  oddsApiBookmakers: string;
  oddsApiMarkets: string;
  oddsApiEventMarkets: string;
  oddsApiMaxEvents: number;
  footballDataCoUkEnabled: boolean;
  footballDataCoUkLeagues: string;
  historySeasons: number;
  apiFootballLeagueIds: string;
  footballDataCompetitions: string;
  sessionHours: number;
};

let cached: Settings | null = null;

function blankToNull(value: string | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

/** SQLAlchemy URLs carry a driver suffix that libpq clients reject. */
export function normalizeDatabaseUrl(url: string): string {
  return url.replace(/^postgres(ql)?\+[a-z0-9]+:\/\//i, "postgresql://");
}

export function getSettings(): Settings {
  if (cached) return cached;
  loadLocalEnv();
  const parsed = schema.safeParse({ ...process.env, DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    const where = process.env.VERCEL
      ? "Add them in Vercel → Project → Settings → Environment Variables, then redeploy."
      : "Add them to the .env file in the repository root.";
    throw new Error(`Missing or invalid environment variables: ${missing}. ${where}`);
  }
  const env = parsed.data;
  cached = {
    databaseUrl: normalizeDatabaseUrl(env.DATABASE_URL),
    authSecret: env.AUTH_SECRET,
    dashboardUsername: blankToNull(env.DASHBOARD_USERNAME),
    dashboardPassword: env.DASHBOARD_PASSWORD ? env.DASHBOARD_PASSWORD : null,
    environment: env.ENVIRONMENT,
    allowSynthetic: env.ALLOW_SYNTHETIC,
    cronSecret: blankToNull(env.CRON_SECRET),
    oddsFreshnessMinutes: env.ODDS_FRESHNESS_MINUTES,
    fixtureRefetchMinutes: env.FIXTURE_REFETCH_MINUTES,
    oddsRefetchMinutes: env.ODDS_REFETCH_MINUTES,
    predictionTimeBudgetSeconds: env.PREDICTION_TIME_BUDGET_SECONDS,
    predictionTimeBudgetCapSeconds: env.PREDICTION_TIME_BUDGET_CAP_SECONDS,
    minPickProbability: env.MIN_PICK_PROBABILITY,
    minDataQuality: env.MIN_DATA_QUALITY,
    minTeamMatches: env.MIN_TEAM_MATCHES,
    predictionHistoryDays: env.PREDICTION_HISTORY_DAYS,
    rhoMinMatches: env.RHO_MIN_MATCHES,
    predictionRetentionDays: env.PREDICTION_RETENTION_DAYS,
    apiFootballKey: blankToNull(env.API_FOOTBALL_KEY),
    oddsApiKey: blankToNull(env.ODDS_API_KEY),
    footballDataApiKey: blankToNull(env.FOOTBALL_DATA_API_KEY),
    oddsApiSports: env.ODDS_API_SPORTS,
    oddsApiBookmakers: env.ODDS_API_BOOKMAKERS,
    oddsApiMarkets: env.ODDS_API_MARKETS,
    oddsApiEventMarkets: env.ODDS_API_EVENT_MARKETS,
    oddsApiMaxEvents: env.ODDS_API_MAX_EVENTS,
    footballDataCoUkEnabled: env.FOOTBALL_DATA_CO_UK_ENABLED,
    footballDataCoUkLeagues: env.FOOTBALL_DATA_CO_UK_LEAGUES,
    historySeasons: env.HISTORY_SEASONS,
    apiFootballLeagueIds: env.API_FOOTBALL_LEAGUE_IDS,
    footballDataCompetitions: env.FOOTBALL_DATA_COMPETITIONS,
    sessionHours: env.SESSION_HOURS,
  };
  return cached;
}

export function splitCsv(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Refuse to serve a non-test deployment that still uses placeholder secrets. */
export function assertRuntimeSecrets(settings: Settings): void {
  if (settings.environment === "test") return;
  const problems: string[] = [];
  if (settings.authSecret.length < 32 || PLACEHOLDERS.has(settings.authSecret)) {
    problems.push("AUTH_SECRET must be at least 32 characters and not a placeholder");
  }
  if (settings.dashboardPassword !== null && (settings.dashboardPassword.length < 12 || PLACEHOLDERS.has(settings.dashboardPassword))) {
    problems.push("DASHBOARD_PASSWORD must be at least 12 characters and not a placeholder");
  }
  if (problems.length) throw new Error(problems.join("; "));
}

export function resetSettingsForTests(): void {
  cached = null;
}
