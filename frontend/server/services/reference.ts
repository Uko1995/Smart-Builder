import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import {
  BOOKMAKERS,
  FEATURE_VERSION,
  MAPPINGS,
  MARKETS,
  MODEL_DESCRIPTION,
  MODEL_VERSION_KEY,
  PROVIDERS,
} from "@/server/markets/registry";

export type EffectiveSettings = {
  odds_freshness_minutes: number;
  reference_odds_freshness_hours: number;
  min_pick_probability: number;
  min_data_quality: number;
  min_team_matches: number;
  rho_min_matches: number;
  prediction_time_budget_seconds: number;
  allow_synthetic: boolean;
  fixture_refetch_minutes: number;
  odds_refetch_minutes: number;
  prediction_history_days: number;
};

export function settingsPayload(settings: Settings): EffectiveSettings {
  return {
    odds_freshness_minutes: settings.oddsFreshnessMinutes,
    reference_odds_freshness_hours: settings.referenceOddsFreshnessHours,
    min_pick_probability: settings.minPickProbability,
    min_data_quality: settings.minDataQuality,
    min_team_matches: settings.minTeamMatches,
    rho_min_matches: settings.rhoMinMatches,
    prediction_time_budget_seconds: settings.predictionTimeBudgetSeconds,
    allow_synthetic: settings.allowSynthetic,
    fixture_refetch_minutes: settings.fixtureRefetchMinutes,
    odds_refetch_minutes: settings.oddsRefetchMinutes,
    prediction_history_days: settings.predictionHistoryDays,
  };
}

export async function effectiveSettings(db: Db, settings: Settings): Promise<EffectiveSettings> {
  const defaults = settingsPayload(settings);
  const [row] = await db<{ payload: Record<string, unknown> }[]>`SELECT payload FROM app_settings WHERE id = 1`;
  if (!row) {
    await db`INSERT INTO app_settings (id, payload) VALUES (1, ${db.json(defaults as never)}) ON CONFLICT (id) DO NOTHING`;
    return defaults;
  }
  const stored = Object.fromEntries(Object.entries(row.payload ?? {}).filter(([key]) => key in defaults));
  return { ...defaults, ...stored } as EffectiveSettings;
}

const BOUNDS: Record<string, [number, number, "float" | "int"]> = {
  odds_freshness_minutes: [15, 7 * 24 * 60, "int"],
  reference_odds_freshness_hours: [6, 14 * 24, "int"],
  min_pick_probability: [0.5, 0.95, "float"],
  min_data_quality: [0, 1, "float"],
  min_team_matches: [3, 50, "int"],
  rho_min_matches: [20, 5000, "int"],
  prediction_time_budget_seconds: [5, 240, "int"],
  fixture_refetch_minutes: [30, 7 * 24 * 60, "int"],
  odds_refetch_minutes: [15, 24 * 60, "int"],
  prediction_history_days: [30, 4000, "int"],
};

export async function updateSettings(db: Db, settings: Settings, changes: Record<string, unknown>): Promise<EffectiveSettings> {
  const current = (await effectiveSettings(db, settings)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (key === "allow_synthetic") {
      current[key] = Boolean(value);
      continue;
    }
    const bound = BOUNDS[key];
    if (!bound) throw new Error(`unknown setting: ${key}`);
    const [low, high, kind] = bound;
    const number = kind === "float" ? Number(value) : Math.trunc(Number(value));
    if (!Number.isFinite(number)) throw new Error(`${key} must be a number`);
    if (number < low || number > high) throw new Error(`${key} is outside ${low}..${high}`);
    current[key] = number;
  }
  await db`UPDATE app_settings SET payload = ${db.json(current as never)}, updated_at = now() WHERE id = 1`;
  return current as EffectiveSettings;
}

const seeded = new WeakSet<object>();

/** Idempotent. Runs once per warm instance; later calls only refresh provider configuration flags. */
export async function seedReference(db: Db, settings: Settings): Promise<void> {
  if (!seeded.has(settings)) {
    for (const item of PROVIDERS) {
      await db`
        INSERT INTO providers (key, name, kind, health_status) VALUES (${item.key}, ${item.name}, ${item.kind}, 'not_configured')
        ON CONFLICT (key) DO NOTHING`;
    }
    for (const item of BOOKMAKERS) {
      await db`
        INSERT INTO bookmakers (key, name, is_synthetic, notes) VALUES (${item.key}, ${item.name}, ${item.isSynthetic}, ${item.notes})
        ON CONFLICT (key) DO NOTHING`;
    }
    for (const item of MARKETS) {
      await db`
        INSERT INTO market_definitions (key, display_name, family, period, line_required, selections, settlement, required_data, implementation_status, enabled)
        VALUES (${item.key}, ${item.displayName}, ${item.family}, ${item.period}, ${item.lineRequired}, ${db.json(item.selections)},
                ${item.settlement}, ${item.requiredData}, ${item.implementationStatus}, ${item.enabled})
        ON CONFLICT (key) DO UPDATE SET display_name = EXCLUDED.display_name, implementation_status = EXCLUDED.implementation_status,
          settlement = EXCLUDED.settlement, required_data = EXCLUDED.required_data`;
    }
    for (const item of MAPPINGS) {
      await db`
        INSERT INTO bookmaker_market_mappings (bookmaker_id, market_definition_id, provider_market_key, status, notes)
        SELECT b.id, m.id, ${item.providerMarketKey}, ${item.status}, ${item.notes}
        FROM bookmakers b, market_definitions m WHERE b.key = ${item.bookmakerKey} AND m.key = ${item.marketKey}
        ON CONFLICT ON CONSTRAINT uq_bookmaker_market_map DO NOTHING`;
    }
    await db`
      INSERT INTO model_versions (version_key, feature_version, description)
      VALUES (${MODEL_VERSION_KEY}, ${FEATURE_VERSION}, ${MODEL_DESCRIPTION})
      ON CONFLICT (version_key) DO NOTHING`;
    seeded.add(settings);
  }
  const configured: Record<string, boolean> = {
    api_football: Boolean(settings.apiFootballKey),
    the_odds_api: Boolean(settings.oddsApiKey),
    football_data_org: Boolean(settings.footballDataApiKey),
    football_data_co_uk: settings.footballDataCoUkEnabled,
  };
  for (const [providerKey, isConfigured] of Object.entries(configured)) {
    await db`
      UPDATE providers SET configured = ${isConfigured},
        health_status = CASE WHEN ${isConfigured} = false THEN 'not_configured'
                             WHEN health_status = 'not_configured' THEN 'unknown'
                             ELSE health_status END
      WHERE key = ${providerKey}`;
  }
  await db`UPDATE providers SET configured = true, health_status = 'ok' WHERE key = 'manual'`;
  await db`UPDATE providers SET configured = true, health_status = 'synthetic' WHERE key = 'synthetic_demo'`;
  await effectiveSettings(db, settings);
}

export async function getProviderId(db: Db, key: string): Promise<number> {
  const [row] = await db<{ id: number }[]>`SELECT id FROM providers WHERE key = ${key}`;
  if (!row) throw new Error(`provider ${key} is not seeded`);
  return row.id;
}
