/** Pure transforms from documented provider payloads into normalized records. */

export class PayloadError extends Error {}

export type NormalizedFixture = {
  providerKey: string;
  externalId: string;
  leagueExternalId: string;
  leagueName: string;
  country: string | null;
  seasonName: string;
  kickoff: Date;
  homeExternalId: string;
  homeName: string;
  awayExternalId: string;
  awayName: string;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
  htHomeGoals: number | null;
  htAwayGoals: number | null;
  dataOrigin: string;
};

export type NormalizedOdds = {
  providerKey: string;
  fixtureExternalId: string;
  homeName: string;
  awayName: string;
  kickoff: Date;
  bookmakerKey: string;
  bookmakerName: string;
  providerMarketKey: string;
  marketKey: string | null;
  selection: string | null;
  /** Two-decimal string, as stored in numeric(8,2). */
  line: string | null;
  /** Four-decimal string, as stored in numeric(12,4). */
  decimalOdds: string;
  capturedAt: Date;
  mappingStatus: string;
  dataOrigin: string;
};

const API_FOOTBALL_STATUS: Record<string, string> = {
  TBD: "scheduled",
  NS: "scheduled",
  FT: "completed",
  AET: "completed",
  PEN: "completed",
  PST: "postponed",
  SUSP: "postponed",
  CANC: "cancelled",
  ABD: "cancelled",
  AWD: "completed",
  WO: "completed",
};

const FOOTBALL_DATA_STATUS: Record<string, string> = {
  SCHEDULED: "scheduled",
  TIMED: "scheduled",
  IN_PLAY: "scheduled",
  PAUSED: "scheduled",
  FINISHED: "completed",
  AWARDED: "completed",
  POSTPONED: "postponed",
  SUSPENDED: "postponed",
  CANCELLED: "cancelled",
};

export function parseUtc(value: string): Date {
  const text = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new PayloadError(`not a timestamp: ${value}`);
  return parsed;
}

function goals(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new PayloadError(`goal value is not an integer: ${String(value)}`);
  if (number < 0 || number > 30) throw new PayloadError("goal value is outside 0..30");
  return number;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function parseApiFootballFixtures(payload: unknown): NormalizedFixture[] {
  const body = payload as Json;
  if (!body || !Array.isArray(body.response)) throw new PayloadError("API-Football payload did not contain a response list");
  return body.response.map((item: Json) => {
    try {
      const fixture = item.fixture;
      const league = item.league;
      const teams = item.teams;
      const score = item.score?.halftime ?? {};
      return {
        providerKey: "api_football",
        externalId: String(fixture.id),
        leagueExternalId: String(league.id),
        leagueName: String(league.name),
        country: league.country ?? null,
        seasonName: String(league.season),
        kickoff: parseUtc(fixture.date),
        homeExternalId: String(teams.home.id),
        homeName: String(teams.home.name),
        awayExternalId: String(teams.away.id),
        awayName: String(teams.away.name),
        status: API_FOOTBALL_STATUS[fixture.status.short] ?? "unknown",
        homeGoals: goals(item.goals?.home),
        awayGoals: goals(item.goals?.away),
        htHomeGoals: goals(score.home),
        htAwayGoals: goals(score.away),
        dataOrigin: "provider",
      } satisfies NormalizedFixture;
    } catch (error) {
      throw new PayloadError(`API-Football fixture was incomplete: ${(error as Error).message}`);
    }
  });
}

export function parseFootballDataMatches(payload: unknown): NormalizedFixture[] {
  const matches = (payload as Json)?.matches;
  if (!Array.isArray(matches)) throw new PayloadError("football-data.org payload did not contain matches");
  return matches.map((item: Json) => {
    try {
      const competition = item.competition;
      const fullTime = item.score?.fullTime ?? {};
      const halfTime = item.score?.halfTime ?? {};
      return {
        providerKey: "football_data_org",
        externalId: String(item.id),
        leagueExternalId: String(competition.code ?? competition.id),
        leagueName: String(competition.name),
        country: null,
        seasonName: String(item.season?.startDate ?? "unknown").slice(0, 4),
        kickoff: parseUtc(item.utcDate),
        homeExternalId: String(item.homeTeam.id),
        homeName: String(item.homeTeam.name),
        awayExternalId: String(item.awayTeam.id),
        awayName: String(item.awayTeam.name),
        status: FOOTBALL_DATA_STATUS[item.status] ?? "unknown",
        homeGoals: goals(fullTime.home),
        awayGoals: goals(fullTime.away),
        htHomeGoals: goals(halfTime.home),
        htAwayGoals: goals(halfTime.away),
        dataOrigin: "provider",
      } satisfies NormalizedFixture;
    } catch (error) {
      throw new PayloadError(`football-data.org match was incomplete: ${(error as Error).message}`);
    }
  });
}

function decimalOdds(value: unknown): string {
  const odds = Number(value);
  if (!Number.isFinite(odds)) throw new PayloadError(`odds value is not decimal: ${String(value)}`);
  if (odds <= 1) throw new PayloadError("decimal odds must be greater than 1");
  return odds.toFixed(4);
}

function mapOutcome(marketKey: string, outcome: Json, home: string, away: string) {
  const name = String(outcome.name ?? "");
  const point = outcome.point;
  const lineNumber = point === null || point === undefined ? null : Number(point);
  const line = lineNumber === null || !Number.isFinite(lineNumber) ? null : lineNumber.toFixed(2);
  const unmapped = { selection: null, canonical: null, line, mapping: "mapping_required" };
  if (marketKey === "h2h") {
    const lowered = name.trim().toLowerCase();
    const selection = lowered === "draw" ? "draw" : name === home ? "home" : name === away ? "away" : null;
    if (selection === null) return unmapped;
    return { selection, canonical: "match_result", line: null, mapping: "verified" };
  }
  if (marketKey === "btts") {
    const lowered = name.toLowerCase();
    if (lowered !== "yes" && lowered !== "no") return unmapped;
    return { selection: lowered, canonical: "btts", line: null, mapping: "verified" };
  }
  if (marketKey === "totals" || marketKey === "alternate_totals") {
    const lowered = name.toLowerCase();
    if ((lowered !== "over" && lowered !== "under") || lineNumber === null) return unmapped;
    // Quarter and integer totals are not given the verified half-line mapping.
    if (Math.abs(lineNumber % 1) !== 0.5) return unmapped;
    return { selection: lowered, canonical: "over_under_goals", line, mapping: "verified" };
  }
  return unmapped;
}

export function parseOddsApiPayload(payload: unknown, bookmakerFilter?: Set<string>): NormalizedOdds[] {
  if (!Array.isArray(payload)) throw new PayloadError("The Odds API payload was not a list");
  const rows: NormalizedOdds[] = [];
  for (const event of payload as Json[]) {
    let home: string;
    let away: string;
    let kickoff: Date;
    let eventId: string;
    try {
      home = String(event.home_team);
      away = String(event.away_team);
      kickoff = parseUtc(event.commence_time);
      eventId = String(event.id);
      if (event.home_team === undefined || event.away_team === undefined || event.id === undefined) throw new Error("missing field");
    } catch (error) {
      throw new PayloadError(`The Odds API event was incomplete: ${(error as Error).message}`);
    }
    for (const book of (event.bookmakers ?? []) as Json[]) {
      const bookKey = String(book.key ?? "");
      if (bookmakerFilter && bookmakerFilter.size && !bookmakerFilter.has(bookKey)) continue;
      for (const market of (book.markets ?? []) as Json[]) {
        const marketKey = String(market.key ?? "");
        const updated = market.last_update ?? book.last_update;
        if (!updated) continue;
        const captured = parseUtc(updated);
        for (const outcome of (market.outcomes ?? []) as Json[]) {
          let price: string;
          try {
            price = decimalOdds(outcome.price);
          } catch {
            continue;
          }
          const mapped = mapOutcome(marketKey, outcome, home, away);
          rows.push({
            providerKey: "the_odds_api",
            fixtureExternalId: eventId,
            homeName: home,
            awayName: away,
            kickoff,
            bookmakerKey: bookKey,
            bookmakerName: String(book.title ?? bookKey),
            providerMarketKey: marketKey,
            marketKey: mapped.canonical,
            selection: mapped.selection,
            line: mapped.line,
            decimalOdds: price,
            capturedAt: captured,
            mappingStatus: mapped.mapping,
            dataOrigin: "provider",
          });
        }
      }
    }
  }
  return rows;
}
