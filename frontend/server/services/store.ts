/** Idempotent writes for fixtures, teams and immutable odds snapshots. */

import type { Db } from "@/server/db/client";
import { nameSimilarity, normalizeTeamName } from "@/server/providers/names";
import type { NormalizedFixture, NormalizedOdds } from "@/server/providers/parsing";
import { getProviderId } from "@/server/services/reference";

export const MIN_NAME_SIMILARITY = 0.7;
export const MIN_MATCH_MARGIN = 0.15;

async function upsertTeam(db: Db, providerId: number, externalId: string, name: string, origin: string): Promise<number> {
  const [row] = await db<{ id: number }[]>`
    INSERT INTO teams (provider_id, external_id, name, normalized_name, data_origin)
    VALUES (${providerId}, ${externalId}, ${name}, ${normalizeTeamName(name)}, ${origin})
    ON CONFLICT ON CONSTRAINT uq_team_external DO UPDATE SET external_id = EXCLUDED.external_id
    RETURNING id`;
  return row.id;
}

export async function upsertNormalizedFixture(db: Db, item: NormalizedFixture): Promise<{ id: number; created: boolean }> {
  const providerId = await getProviderId(db, item.providerKey);
  const [league] = await db<{ id: number }[]>`
    INSERT INTO leagues (provider_id, external_id, name, country, data_origin)
    VALUES (${providerId}, ${item.leagueExternalId}, ${item.leagueName}, ${item.country}, ${item.dataOrigin})
    ON CONFLICT ON CONSTRAINT uq_league_external DO UPDATE SET external_id = EXCLUDED.external_id
    RETURNING id`;
  const [season] = await db<{ id: number }[]>`
    INSERT INTO seasons (league_id, name) VALUES (${league.id}, ${item.seasonName})
    ON CONFLICT ON CONSTRAINT uq_season_name DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  const home = await upsertTeam(db, providerId, item.homeExternalId, item.homeName, item.dataOrigin);
  const away = await upsertTeam(db, providerId, item.awayExternalId, item.awayName, item.dataOrigin);
  const [row] = await db<{ id: number; created: boolean }[]>`
    INSERT INTO fixtures (provider_id, external_id, league_id, season_id, home_team_id, away_team_id, kickoff_at, status,
                          home_goals, away_goals, ht_home_goals, ht_away_goals, data_origin, provenance)
    VALUES (${providerId}, ${item.externalId}, ${league.id}, ${season.id}, ${home}, ${away}, ${item.kickoff}, ${item.status},
            ${item.homeGoals}, ${item.awayGoals}, ${item.htHomeGoals}, ${item.htAwayGoals}, ${item.dataOrigin},
            ${db.json({ provider: item.providerKey, external_id: item.externalId })})
    ON CONFLICT ON CONSTRAINT uq_fixture_external DO UPDATE SET
      kickoff_at = EXCLUDED.kickoff_at,
      status = EXCLUDED.status,
      home_goals = COALESCE(EXCLUDED.home_goals, fixtures.home_goals),
      away_goals = COALESCE(EXCLUDED.away_goals, fixtures.away_goals),
      ht_home_goals = COALESCE(EXCLUDED.ht_home_goals, fixtures.ht_home_goals),
      ht_away_goals = COALESCE(EXCLUDED.ht_away_goals, fixtures.ht_away_goals),
      updated_at = now()
    RETURNING id, (xmax = 0) AS created`;
  return row;
}

type CandidateFixture = { id: number; home: string; away: string };

async function matchFixture(db: Db, item: NormalizedOdds): Promise<number | string> {
  const start = new Date(item.kickoff.getTime() - 90 * 60_000);
  const end = new Date(item.kickoff.getTime() + 90 * 60_000);
  const rows = await db<CandidateFixture[]>`
    SELECT f.id, h.name AS home, a.name AS away
    FROM fixtures f JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
    WHERE f.kickoff_at >= ${start} AND f.kickoff_at <= ${end}`;
  const scored: [number, number][] = [];
  for (const fixture of rows) {
    const score = Math.min(nameSimilarity(fixture.home, item.homeName), nameSimilarity(fixture.away, item.awayName));
    if (score >= MIN_NAME_SIMILARITY) scored.push([score, fixture.id]);
  }
  if (!scored.length) return "unmatched";
  scored.sort((left, right) => right[0] - left[0]);
  if (scored.length > 1 && scored[0][0] - scored[1][0] < MIN_MATCH_MARGIN) return "ambiguous";
  return scored[0][1];
}

const bookmakerIds = new Map<string, number | null>();

async function bookmakerId(db: Db, key: string): Promise<number | null> {
  if (bookmakerIds.has(key)) return bookmakerIds.get(key) as number | null;
  const [row] = await db<{ id: number }[]>`SELECT id FROM bookmakers WHERE key = ${key}`;
  const id = row?.id ?? null;
  if (id !== null) bookmakerIds.set(key, id);
  return id;
}

export async function insertSnapshot(db: Db, fixtureId: number, item: NormalizedOdds): Promise<string> {
  if (item.marketKey === null || item.selection === null) return "unmapped";
  const book = await bookmakerId(db, item.bookmakerKey);
  if (book === null) return "unknown_bookmaker";
  const providerId = await getProviderId(db, item.providerKey);
  const rows = await db`
    INSERT INTO odds_snapshots (fixture_id, bookmaker_id, provider_id, market_key, selection, line, decimal_odds, captured_at,
                                source_timestamp, mapping_status, data_origin)
    VALUES (${fixtureId}, ${book}, ${providerId}, ${item.marketKey}, ${item.selection}, ${item.line}, ${item.decimalOdds},
            ${item.capturedAt}, ${item.capturedAt}, ${item.mappingStatus}, ${item.dataOrigin})
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length ? "written" : "duplicate";
}

/** Attach a price to one stored fixture. Ambiguous or unmatched events are not guessed or created. */
export async function attachOdds(db: Db, item: NormalizedOdds, cache: Map<string, number | string>): Promise<string> {
  if (item.marketKey === null || item.selection === null) return "unmapped";
  const key = `${item.providerKey}|${item.fixtureExternalId}`;
  if (!cache.has(key)) cache.set(key, await matchFixture(db, item));
  const result = cache.get(key) as number | string;
  if (typeof result === "string") return result;
  return insertSnapshot(db, result, item);
}

export async function attachOddsByExternalId(db: Db, externalId: string, item: NormalizedOdds): Promise<string> {
  const fixtures = await db<{ id: number }[]>`SELECT id FROM fixtures WHERE external_id = ${externalId}`;
  if (!fixtures.length) return "unmatched";
  if (fixtures.length > 1) return "ambiguous";
  return insertSnapshot(db, fixtures[0].id, item);
}

export async function upsertStatistics(
  db: Db,
  fixtureId: number,
  values: {
    home_corners?: number | null;
    away_corners?: number | null;
    home_cards?: number | null;
    away_cards?: number | null;
    home_xg?: string | null;
    away_xg?: string | null;
  },
  source: string,
): Promise<void> {
  const v = {
    home_corners: values.home_corners ?? null,
    away_corners: values.away_corners ?? null,
    home_cards: values.home_cards ?? null,
    away_cards: values.away_cards ?? null,
    home_xg: values.home_xg ?? null,
    away_xg: values.away_xg ?? null,
  };
  await db`
    INSERT INTO match_statistics (fixture_id, home_corners, away_corners, home_cards, away_cards, home_xg, away_xg, source, captured_at)
    VALUES (${fixtureId}, ${v.home_corners}, ${v.away_corners}, ${v.home_cards}, ${v.away_cards}, ${v.home_xg}, ${v.away_xg}, ${source}, now())
    ON CONFLICT (fixture_id) DO UPDATE SET
      home_corners = COALESCE(EXCLUDED.home_corners, match_statistics.home_corners),
      away_corners = COALESCE(EXCLUDED.away_corners, match_statistics.away_corners),
      home_cards = COALESCE(EXCLUDED.home_cards, match_statistics.home_cards),
      away_cards = COALESCE(EXCLUDED.away_cards, match_statistics.away_cards),
      home_xg = COALESCE(EXCLUDED.home_xg, match_statistics.home_xg),
      away_xg = COALESCE(EXCLUDED.away_xg, match_statistics.away_xg),
      source = EXCLUDED.source,
      captured_at = EXCLUDED.captured_at`;
}
