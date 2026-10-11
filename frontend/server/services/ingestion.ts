/** Provider ingestion. A failed fetch is stored as a failed run and nothing else. */

import { createHash } from "node:crypto";
import { splitCsv, type Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import { addDays } from "@/server/http";
import {
  fetchApiFootballFixtures,
  fetchEventOdds,
  fetchFootballDataMatches,
  fetchOdds,
  listOddsEvents,
  type FetchMeta,
} from "@/server/providers/clients";
import { ProviderRequestError } from "@/server/providers/http";
import type { NormalizedFixture, NormalizedOdds } from "@/server/providers/parsing";
import { refreshRecent } from "@/server/services/history";
import { effectiveSettings, getProviderId } from "@/server/services/reference";
import { attachOdds, upsertNormalizedFixture } from "@/server/services/store";

export type IngestionRunRow = { id: number; status: string };
type Fetch = () => Promise<[NormalizedFixture[] | NormalizedOdds[], FetchMeta]>;

function fingerprint(payload: Record<string, unknown>): string {
  const ordered = Object.keys(payload)
    .sort()
    .map((key) => [key, payload[key]]);
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex").slice(0, 32);
}

async function openRun(db: Db, providerId: number, kind: string, digest: string): Promise<number> {
  const [row] = await db<{ id: number }[]>`
    INSERT INTO ingestion_runs (provider_id, kind, status, request_fingerprint, started_at, details)
    VALUES (${providerId}, ${kind}, 'running', ${digest}, now(), '{}'::jsonb) RETURNING id`;
  return row.id;
}

async function failRun(db: Db, runId: number, providerId: number, message: string): Promise<void> {
  const text = message.slice(0, 500);
  await db`UPDATE ingestion_runs SET status = 'failed', error_message = ${text}, finished_at = now() WHERE id = ${runId}`;
  await db`UPDATE providers SET health_status = 'error', last_error = ${text}, last_checked_at = now() WHERE id = ${providerId}`;
}

async function run(
  db: Db,
  providerKey: string,
  kind: "fixtures" | "odds",
  payload: Record<string, unknown>,
  freshnessMinutes: number,
  force: boolean,
  fetcher: Fetch,
): Promise<IngestionRunRow> {
  const providerId = await getProviderId(db, providerKey);
  const digest = fingerprint(payload);
  if (!force) {
    const [previous] = await db<{ finished_at: Date | null }[]>`
      SELECT finished_at FROM ingestion_runs
      WHERE provider_id = ${providerId} AND kind = ${kind} AND request_fingerprint = ${digest} AND status = 'succeeded'
      ORDER BY finished_at DESC NULLS LAST LIMIT 1`;
    if (previous?.finished_at && Date.now() - previous.finished_at.getTime() < freshnessMinutes * 60_000) {
      const [skipped] = await db<{ id: number }[]>`
        INSERT INTO ingestion_runs (provider_id, kind, status, request_fingerprint, started_at, finished_at, details)
        VALUES (${providerId}, ${kind}, 'skipped', ${digest}, now(), now(),
                ${db.json({ reason: "An identical request is still inside the refetch window." })})
        RETURNING id`;
      return { id: skipped.id, status: "skipped" };
    }
  }
  const runId = await openRun(db, providerId, kind, digest);
  let records: NormalizedFixture[] | NormalizedOdds[];
  let meta: FetchMeta;
  try {
    [records, meta] = await fetcher();
  } catch (error) {
    const message = error instanceof ProviderRequestError ? error.message : "The provider request failed.";
    if (!(error instanceof ProviderRequestError)) console.error("ingestion failed", error);
    await failRun(db, runId, providerId, message);
    return { id: runId, status: "failed" };
  }
  let written = Number(meta.written ?? 0);
  delete meta.written;
  let unmatched = 0;
  const cache = new Map<string, number | string>();
  for (const record of records) {
    if (kind === "fixtures") {
      const result = await upsertNormalizedFixture(db, record as NormalizedFixture);
      written += result.created ? 1 : 0;
    } else {
      const result = await attachOdds(db, record as NormalizedOdds, cache);
      if (result === "written") written += 1;
      else if (["unmatched", "ambiguous", "unknown_bookmaker", "unmapped"].includes(result)) unmatched += 1;
    }
  }
  await db`
    UPDATE ingestion_runs SET status = 'succeeded', records_written = ${written}, finished_at = now(),
      details = ${db.json({ unmatched_or_unmapped: unmatched, ...meta } as never)}
    WHERE id = ${runId}`;
  const quota = typeof meta.quota_remaining === "number" ? meta.quota_remaining : null;
  await db`
    UPDATE providers SET health_status = 'ok', last_checked_at = now(), last_error = NULL,
      quota_remaining = COALESCE(${quota}, quota_remaining)
    WHERE id = ${providerId}`;
  return { id: runId, status: "succeeded" };
}

/** Pick the earliest events in the window, capped so one refresh cannot drain the monthly quota. */
async function eventOdds(settings: Settings, dateFrom: string, dateTo: string, markets: string): Promise<[NormalizedOdds[], FetchMeta]> {
  const start = `${dateFrom}T00:00:00Z`;
  const end = `${addDays(dateTo, 1)}T00:00:00Z`;
  const events: [string, string, string][] = [];
  for (const sport of splitCsv(settings.oddsApiSports)) {
    for (const event of await listOddsEvents(settings, sport, start, end)) {
      if (event.id && event.commence_time) events.push([String(event.commence_time), sport, String(event.id)]);
    }
  }
  events.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const chosen = events.slice(0, settings.oddsApiMaxEvents).map(([, sport, id]) => [sport, id] as [string, string]);
  return fetchEventOdds(settings, chosen, markets);
}

export type RefreshScope = "all" | "fixtures" | "odds";

export async function refreshProviders(
  db: Db,
  settings: Settings,
  options: { dateFrom: string; dateTo: string; season?: string | null; force?: boolean; scope?: RefreshScope },
): Promise<IngestionRunRow[]> {
  const { dateFrom, dateTo } = options;
  const force = options.force ?? false;
  const scope = options.scope ?? "all";
  const config = await effectiveSettings(db, settings);
  const runs: IngestionRunRow[] = [];
  const season = options.season ?? String(new Date().getUTCFullYear());
  if (scope !== "odds") {
    if (settings.apiFootballKey) {
      for (const leagueId of splitCsv(settings.apiFootballLeagueIds)) {
        runs.push(
          await run(db, "api_football", "fixtures", { league: leagueId, season, from: dateFrom, to: dateTo }, config.fixture_refetch_minutes, force, () =>
            fetchApiFootballFixtures(settings, leagueId, season, dateFrom, dateTo),
          ),
        );
      }
    }
    if (settings.footballDataApiKey) {
      for (const competition of splitCsv(settings.footballDataCompetitions)) {
        runs.push(
          await run(db, "football_data_org", "fixtures", { competition, from: dateFrom, to: dateTo }, config.fixture_refetch_minutes, force, () =>
            fetchFootballDataMatches(settings, competition, dateFrom, dateTo),
          ),
        );
      }
    }
    if (settings.footballDataCoUkEnabled) {
      runs.push(
        await run(
          db,
          "football_data_co_uk",
          "fixtures",
          { from: dateFrom, leagues: settings.footballDataCoUkLeagues },
          config.fixture_refetch_minutes,
          force,
          async () => {
            const [written, meta] = await refreshRecent(db, settings, new Date(`${dateFrom}T00:00:00Z`));
            return [[], { written, ...meta }];
          },
        ),
      );
    }
  }
  if (scope !== "fixtures" && settings.oddsApiKey) {
    const markets = settings.oddsApiMarkets;
    for (const sport of splitCsv(settings.oddsApiSports)) {
      runs.push(
        await run(db, "the_odds_api", "odds", { sport, markets, bookmakers: settings.oddsApiBookmakers }, config.odds_refetch_minutes, force, () =>
          fetchOdds(settings, sport, markets),
        ),
      );
    }
    const eventMarkets = settings.oddsApiEventMarkets;
    if (eventMarkets && settings.oddsApiMaxEvents > 0) {
      runs.push(
        await run(
          db,
          "the_odds_api",
          "odds",
          { events_from: dateFrom, events_to: dateTo, markets: eventMarkets, max_events: settings.oddsApiMaxEvents },
          config.odds_refetch_minutes,
          force,
          () => eventOdds(settings, dateFrom, dateTo, eventMarkets),
        ),
      );
    }
  }
  if (!runs.length) {
    const providerId = await getProviderId(db, "manual");
    const [skipped] = await db<{ id: number }[]>`
      INSERT INTO ingestion_runs (provider_id, kind, status, request_fingerprint, started_at, finished_at, details)
      VALUES (${providerId}, 'refresh', 'skipped', ${fingerprint({ mode: "none" })}, now(), now(),
              ${db.json({ reason: "No data provider API key is configured." })})
      RETURNING id`;
    runs.push({ id: skipped.id, status: "skipped" });
  }
  return runs;
}
