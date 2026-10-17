/**
 * Bulk storage for football-data.co.uk matches. Rows are upserted on
 * (provider, external_id), so re-running an import or a refresh updates
 * scores and statistics instead of duplicating fixtures.
 */

import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import {
  AVERAGE_BOOK_KEY,
  currentSeasonStart,
  fetchHistory,
  fetchUpcoming,
  PROVIDER_KEY,
  selectedLeagues,
  toDay,
  type CoukFile,
  type CoukMatch,
} from "@/server/providers/couk";
import { normalizeTeamName } from "@/server/providers/names";
import { getProviderId, seedReference } from "@/server/services/reference";

const STALE_SCHEDULED_DAYS = 7;
const CHUNK = 1000;

export class CoukStore {
  private leagues = new Map<string, number>();
  private seasons = new Map<string, number>();
  private latestSeason = new Map<number, number>();
  private teams = new Map<string, number>();
  public pricesWritten = 0;

  private constructor(
    private db: Db,
    public providerId: number,
    private averageBookId: number | null,
  ) {}

  static async open(db: Db): Promise<CoukStore> {
    const [book] = await db<{ id: number }[]>`SELECT id FROM bookmakers WHERE key = ${AVERAGE_BOOK_KEY}`;
    const store = new CoukStore(db, await getProviderId(db, PROVIDER_KEY), book?.id ?? null);
    for (const row of await db<{ id: number; external_id: string }[]>`SELECT id, external_id FROM leagues WHERE provider_id = ${store.providerId}`) {
      store.leagues.set(row.external_id, row.id);
    }
    const leagueIds = [...store.leagues.values()];
    if (leagueIds.length) {
      for (const row of await db<{ id: number; league_id: number; name: string }[]>`
        SELECT id, league_id, name FROM seasons WHERE league_id IN ${db(leagueIds)}`) {
        store.seasons.set(`${row.league_id}|${row.name}`, row.id);
        if (row.id > (store.latestSeason.get(row.league_id) ?? 0)) store.latestSeason.set(row.league_id, row.id);
      }
    }
    for (const row of await db<{ id: number; external_id: string }[]>`SELECT id, external_id FROM teams WHERE provider_id = ${store.providerId}`) {
      store.teams.set(row.external_id, row.id);
    }
    return store;
  }

  private async league(match: CoukMatch): Promise<number> {
    const item = match.fixture;
    const existing = this.leagues.get(item.leagueExternalId);
    if (existing !== undefined) return existing;
    const [row] = await this.db<{ id: number }[]>`
      INSERT INTO leagues (provider_id, external_id, name, country, data_origin)
      VALUES (${this.providerId}, ${item.leagueExternalId}, ${item.leagueName}, ${item.country}, 'provider')
      ON CONFLICT ON CONSTRAINT uq_league_external DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    this.leagues.set(item.leagueExternalId, row.id);
    return row.id;
  }

  private async season(leagueId: number, rawName: string): Promise<number> {
    let name = rawName;
    if (!name) {
      const latest = this.latestSeason.get(leagueId);
      if (latest !== undefined) return latest;
      name = String(new Date().getUTCFullYear());
    }
    const key = `${leagueId}|${name}`;
    const existing = this.seasons.get(key);
    if (existing !== undefined) return existing;
    const [row] = await this.db<{ id: number }[]>`
      INSERT INTO seasons (league_id, name) VALUES (${leagueId}, ${name})
      ON CONFLICT ON CONSTRAINT uq_season_name DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    this.seasons.set(key, row.id);
    if (row.id > (this.latestSeason.get(leagueId) ?? 0)) this.latestSeason.set(leagueId, row.id);
    return row.id;
  }

  private async team(externalId: string, name: string): Promise<number> {
    const existing = this.teams.get(externalId);
    if (existing !== undefined) return existing;
    const [row] = await this.db<{ id: number }[]>`
      INSERT INTO teams (provider_id, external_id, name, normalized_name, data_origin)
      VALUES (${this.providerId}, ${externalId}, ${name}, ${normalizeTeamName(name)}, 'provider')
      ON CONFLICT ON CONSTRAINT uq_team_external DO UPDATE SET name = teams.name
      RETURNING id`;
    this.teams.set(externalId, row.id);
    return row.id;
  }

  async store(matches: CoukMatch[], source: string): Promise<number> {
    if (!matches.length) return 0;
    const rows: Record<string, unknown>[] = [];
    const statsByKey = new Map<string, NonNullable<CoukMatch["stats"]>>();
    const seen = new Set<string>();
    for (const match of matches) {
      const item = match.fixture;
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      const leagueId = await this.league(match);
      rows.push({
        provider_id: this.providerId,
        external_id: item.externalId,
        league_id: leagueId,
        season_id: await this.season(leagueId, item.seasonName),
        home_team_id: await this.team(item.homeExternalId, item.homeName),
        away_team_id: await this.team(item.awayExternalId, item.awayName),
        kickoff_at: item.kickoff,
        status: item.status,
        home_goals: item.homeGoals,
        away_goals: item.awayGoals,
        ht_home_goals: item.htHomeGoals,
        ht_away_goals: item.htAwayGoals,
        data_origin: "provider",
        provenance: JSON.stringify({ provider: PROVIDER_KEY, file: source }),
      });
      if (match.stats) statsByKey.set(item.externalId, match.stats);
    }
    const ids = new Map<string, number>();
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const returned = await this.db<{ id: number; external_id: string }[]>`
        INSERT INTO fixtures ${this.db(chunk as never)}
        ON CONFLICT ON CONSTRAINT uq_fixture_external DO UPDATE SET
          kickoff_at = EXCLUDED.kickoff_at,
          -- A completed result is never turned back into a scheduled fixture.
          status = CASE WHEN fixtures.status = 'completed' AND EXCLUDED.status = 'scheduled' THEN fixtures.status ELSE EXCLUDED.status END,
          home_goals = COALESCE(EXCLUDED.home_goals, fixtures.home_goals),
          away_goals = COALESCE(EXCLUDED.away_goals, fixtures.away_goals),
          ht_home_goals = COALESCE(EXCLUDED.ht_home_goals, fixtures.ht_home_goals),
          ht_away_goals = COALESCE(EXCLUDED.ht_away_goals, fixtures.ht_away_goals),
          updated_at = now()
        RETURNING id, external_id`;
      for (const row of returned) ids.set(row.external_id, row.id);
    }
    const statsRows = [...statsByKey]
      .filter(([key]) => ids.has(key))
      .map(([key, values]) => ({ fixture_id: ids.get(key) as number, source: PROVIDER_KEY, captured_at: new Date(), ...values }));
    for (let start = 0; start < statsRows.length; start += CHUNK) {
      const chunk = statsRows.slice(start, start + CHUNK);
      await this.db`
        INSERT INTO match_statistics ${this.db(chunk as never)}
        ON CONFLICT (fixture_id) DO UPDATE SET
          home_corners = EXCLUDED.home_corners, away_corners = EXCLUDED.away_corners,
          home_cards = EXCLUDED.home_cards, away_cards = EXCLUDED.away_cards,
          home_shots = EXCLUDED.home_shots, away_shots = EXCLUDED.away_shots,
          home_shots_on_target = EXCLUDED.home_shots_on_target, away_shots_on_target = EXCLUDED.away_shots_on_target,
          source = EXCLUDED.source, captured_at = EXCLUDED.captured_at`;
    }
    await this.storePrices(matches, ids);
    await this.storeQuotes(matches, ids);
    return rows.length;
  }

  public quotesWritten = 0;

  /**
   * Historical quotes have deterministic timestamps, so re-imports are no-ops.
   * Quotes from the upcoming-fixtures files are stamped with the fetch time and
   * skipped when they match the latest stored early quote for that bookmaker.
   */
  private async storeQuotes(matches: CoukMatch[], ids: Map<string, number>): Promise<void> {
    const withQuotes = matches.filter((match) => match.quotes.length && ids.has(match.fixture.externalId));
    if (!withQuotes.length) return;
    const fetchedIds = withQuotes.filter((match) => match.quotes.some((quote) => quote.capturedAt === null)).map((match) => ids.get(match.fixture.externalId) as number);
    const latestEarly = new Map<string, string>();
    if (fetchedIds.length) {
      for (const row of await this.db<{ fixture_id: number; bookmaker: string; signature: string }[]>`
        SELECT DISTINCT ON (fixture_id, bookmaker) fixture_id, bookmaker,
               concat_ws('|', home, draw, away, over_2_5, under_2_5) AS signature
        FROM market_prices WHERE phase = 'early' AND fixture_id IN ${this.db(fetchedIds)}
        ORDER BY fixture_id, bookmaker, captured_at DESC`) {
        latestEarly.set(`${row.fixture_id}|${row.bookmaker}`, row.signature);
      }
    }
    const now = new Date();
    const fixed = (value: number | null) => (value === null ? null : value.toFixed(3));
    const inserts: Record<string, unknown>[] = [];
    for (const match of withQuotes) {
      const fixtureId = ids.get(match.fixture.externalId) as number;
      for (const quote of match.quotes) {
        const values = { home: fixed(quote.home), draw: fixed(quote.draw), away: fixed(quote.away), over_2_5: fixed(quote.over), under_2_5: fixed(quote.under) };
        if (quote.capturedAt === null) {
          const signature = [values.home, values.draw, values.away, values.over_2_5, values.under_2_5].filter((value) => value !== null).join("|");
          if (latestEarly.get(`${fixtureId}|${quote.book}`) === signature) continue;
        }
        inserts.push({
          fixture_id: fixtureId,
          bookmaker: quote.book,
          phase: quote.phase,
          captured_at: quote.capturedAt ?? now,
          captured_at_estimated: quote.estimated,
          ...values,
        });
      }
    }
    for (let start = 0; start < inserts.length; start += CHUNK) {
      const result = await this.db`INSERT INTO market_prices ${this.db(inserts.slice(start, start + CHUNK) as never)} ON CONFLICT DO NOTHING`;
      this.quotesWritten += result.count;
    }
  }

  /**
   * The files carry no timestamp, so captured_at is when a price was first seen.
   * Unchanged prices are not stored again; that keeps the age honest and the table small.
   */
  private async storePrices(matches: CoukMatch[], ids: Map<string, number>): Promise<void> {
    if (this.averageBookId === null) return;
    const priced = matches.filter((match) => match.prices.length && ids.has(match.fixture.externalId));
    if (!priced.length) return;
    const fixtureIds = priced.map((match) => ids.get(match.fixture.externalId) as number);
    const latest = new Map<string, string>();
    for (const row of await this.db<{ fixture_id: number; market_key: string; selection: string; line: string | null; decimal_odds: string }[]>`
      SELECT DISTINCT ON (fixture_id, market_key, selection, line) fixture_id, market_key, selection, line, decimal_odds
      FROM odds_snapshots WHERE bookmaker_id = ${this.averageBookId} AND fixture_id IN ${this.db(fixtureIds)}
      ORDER BY fixture_id, market_key, selection, line, captured_at DESC`) {
      latest.set(`${row.fixture_id}|${row.market_key}|${row.selection}|${row.line ?? ""}`, Number(row.decimal_odds).toFixed(4));
    }
    const now = new Date();
    const inserts: Record<string, unknown>[] = [];
    for (const match of priced) {
      const fixtureId = ids.get(match.fixture.externalId) as number;
      for (const item of match.prices) {
        const key = `${fixtureId}|${item.marketKey}|${item.selection}|${item.line === null ? "" : Number(item.line).toFixed(2)}`;
        if (latest.get(key) === item.decimalOdds) continue;
        inserts.push({
          fixture_id: fixtureId,
          bookmaker_id: this.averageBookId,
          provider_id: this.providerId,
          market_key: item.marketKey,
          selection: item.selection,
          line: item.line,
          decimal_odds: item.decimalOdds,
          captured_at: now,
          source_timestamp: now,
          mapping_status: "verified",
          data_origin: "provider",
        });
      }
    }
    for (let start = 0; start < inserts.length; start += CHUNK) {
      const result = await this.db`INSERT INTO odds_snapshots ${this.db(inserts.slice(start, start + CHUNK) as never)} ON CONFLICT DO NOTHING`;
      this.pricesWritten += result.count;
    }
  }
}

async function storeFiles(files: AsyncGenerator<CoukFile>, store: CoukStore): Promise<number> {
  let written = 0;
  for await (const file of files) written += await store.store(file.matches, file.label);
  return written;
}

async function expireStale(db: Db, providerId: number): Promise<number> {
  const result = await db`
    UPDATE fixtures SET status = 'unknown', updated_at = now()
    WHERE provider_id = ${providerId} AND status = 'scheduled'
      AND kickoff_at < now() - make_interval(days => ${STALE_SCHEDULED_DAYS})`;
  return result.count;
}

export async function importHistory(db: Db, settings: Settings, seasons: number, progress?: (label: string, found: boolean) => void) {
  await seedReference(db, settings);
  const [main, extra] = selectedLeagues(settings.footballDataCoUkLeagues);
  const last = currentSeasonStart(new Date());
  const first = last - Math.max(1, seasons) + 1;
  const store = await CoukStore.open(db);
  let written = await storeFiles(fetchHistory(main, extra, first, last, null, progress), store);
  written += await storeFiles(fetchUpcoming(main, extra), store);
  const expired = await expireStale(db, store.providerId);
  return { rows: written, prices: store.pricesWritten, quotes: store.quotesWritten, first_season: `${first}/${first + 1}`, leagues: main.length + extra.length, expired };
}

/** Fetch the current season and upcoming fixtures. */
export async function refreshRecent(db: Db, settings: Settings, since: Date): Promise<[number, Record<string, unknown>]> {
  const [main, extra] = selectedLeagues(settings.footballDataCoUkLeagues);
  const season = currentSeasonStart(new Date());
  const first = Math.min(season, currentSeasonStart(since));
  const store = await CoukStore.open(db);
  let written = await storeFiles(fetchHistory(main, extra, first, season, toDay(since)), store);
  written += await storeFiles(fetchUpcoming(main, extra), store);
  const expired = await expireStale(db, store.providerId);
  return [written, { expired_scheduled: expired, prices_written: store.pricesWritten, quotes_written: store.quotesWritten, leagues: main.length + extra.length }];
}
