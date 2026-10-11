/**
 * football-data.co.uk CSV files. Free, keyless, published per league and season.
 * Main leagues have one file per season with half-time scores, corners and cards.
 * Extra leagues have one file per country covering every season, with full-time
 * scores only. Kickoff times in these files are UK local time.
 */

import { createHash } from "node:crypto";
import Papa from "papaparse";
import { providerGet, ProviderRequestError } from "@/server/providers/http";
import { normalizeTeamName } from "@/server/providers/names";
import type { NormalizedFixture } from "@/server/providers/parsing";

export const BASE_URL = "https://football-data.co.uk";
export const PROVIDER_KEY = "football_data_co_uk";

export type LeagueInfo = { code: string; name: string; country: string };

export const MAIN_LEAGUES: LeagueInfo[] = [
  { code: "E0", name: "Premier League", country: "England" },
  { code: "E1", name: "Championship", country: "England" },
  { code: "E2", name: "League One", country: "England" },
  { code: "E3", name: "League Two", country: "England" },
  { code: "EC", name: "National League", country: "England" },
  { code: "SC0", name: "Premiership", country: "Scotland" },
  { code: "SC1", name: "Championship", country: "Scotland" },
  { code: "SC2", name: "League One", country: "Scotland" },
  { code: "SC3", name: "League Two", country: "Scotland" },
  { code: "D1", name: "Bundesliga", country: "Germany" },
  { code: "D2", name: "2. Bundesliga", country: "Germany" },
  { code: "I1", name: "Serie A", country: "Italy" },
  { code: "I2", name: "Serie B", country: "Italy" },
  { code: "SP1", name: "La Liga", country: "Spain" },
  { code: "SP2", name: "Segunda Division", country: "Spain" },
  { code: "F1", name: "Ligue 1", country: "France" },
  { code: "F2", name: "Ligue 2", country: "France" },
  { code: "N1", name: "Eredivisie", country: "Netherlands" },
  { code: "B1", name: "Pro League", country: "Belgium" },
  { code: "P1", name: "Primeira Liga", country: "Portugal" },
  { code: "T1", name: "Super Lig", country: "Turkey" },
  { code: "G1", name: "Super League", country: "Greece" },
];

export const EXTRA_LEAGUES: LeagueInfo[] = [
  { code: "ARG", name: "Liga Profesional", country: "Argentina" },
  { code: "AUT", name: "Bundesliga", country: "Austria" },
  { code: "BRA", name: "Serie A", country: "Brazil" },
  { code: "CHN", name: "Super League", country: "China" },
  { code: "DNK", name: "Superliga", country: "Denmark" },
  { code: "FIN", name: "Veikkausliiga", country: "Finland" },
  { code: "IRL", name: "Premier Division", country: "Ireland" },
  { code: "JPN", name: "J1 League", country: "Japan" },
  { code: "MEX", name: "Liga MX", country: "Mexico" },
  { code: "NOR", name: "Eliteserien", country: "Norway" },
  { code: "POL", name: "Ekstraklasa", country: "Poland" },
  { code: "ROU", name: "Liga 1", country: "Romania" },
  { code: "RUS", name: "Premier League", country: "Russia" },
  { code: "SWE", name: "Allsvenskan", country: "Sweden" },
  { code: "SWZ", name: "Super League", country: "Switzerland" },
  { code: "USA", name: "MLS", country: "USA" },
];

const LEAGUE_BY_CODE = new Map([...MAIN_LEAGUES, ...EXTRA_LEAGUES].map((item) => [item.code, item]));
const EXTRA_BY_COUNTRY = new Map(EXTRA_LEAGUES.map((item) => [item.country, item]));

export type MatchStats = {
  home_corners: number | null;
  away_corners: number | null;
  home_cards: number | null;
  away_cards: number | null;
  home_shots: number | null;
  away_shots: number | null;
  home_shots_on_target: number | null;
  away_shots_on_target: number | null;
};

export type CoukMatch = { fixture: NormalizedFixture; stats: MatchStats | null };
type Row = Record<string, string>;
type Day = { year: number; month: number; day: number };

export function seasonCode(startYear: number): string {
  return `${String(startYear % 100).padStart(2, "0")}${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function currentSeasonStart(today: Date): number {
  return today.getUTCMonth() + 1 >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
}

export function selectedLeagues(raw: string): [LeagueInfo[], LeagueInfo[]] {
  const codes = new Set(
    raw
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
  if (!codes.size) return [[...MAIN_LEAGUES], [...EXTRA_LEAGUES]];
  const unknown = [...codes].filter((code) => !LEAGUE_BY_CODE.has(code)).sort();
  if (unknown.length) throw new Error(`unknown football-data.co.uk league codes: ${unknown.join(", ")}`);
  return [MAIN_LEAGUES.filter((item) => codes.has(item.code)), EXTRA_LEAGUES.filter((item) => codes.has(item.code))];
}

export function readCsv(text: string): Row[] {
  const parsed = Papa.parse<Row>(text.replace(/^\ufeff/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  return parsed.data;
}

/** Returns the parsed rows, or null when the site has no file for that path. */
export async function getCsv(path: string): Promise<Row[] | null> {
  const response = await providerGet(`${BASE_URL}/${path}`, { timeoutMs: 30_000, maxRetries: 2, json: false });
  if (response.status === 404) return null;
  if (response.status >= 400) throw new ProviderRequestError(`football-data.co.uk returned ${response.status} for ${path}`, response.status);
  const contentType = response.headers.get("content-type") ?? "";
  const text = response.text.replace(/^\ufeff/, "");
  if (!contentType.includes("csv") && !text.trimStart().startsWith("Div") && !text.trimStart().startsWith("Country")) return null;
  return readCsv(text);
}

function parseDay(value: string): Day | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value.trim());
  if (!match) return null;
  let year = Number(match[3]);
  // Python's %y maps 00-68 to 2000-2068 and 69-99 to 1969-1999.
  if (match[3].length === 2) year += year <= 68 ? 2000 : 1900;
  const day = { year, month: Number(match[2]), day: Number(match[1]) };
  const check = new Date(Date.UTC(day.year, day.month - 1, day.day));
  if (check.getUTCMonth() !== day.month - 1 || check.getUTCDate() !== day.day) return null;
  return day;
}

const londonFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function londonOffsetMs(instant: number): number {
  const parts = Object.fromEntries(londonFormat.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function ukLocalToUtc(day: Day, hour: number, minute: number): Date {
  const wall = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  let instant = wall - londonOffsetMs(wall);
  instant = wall - londonOffsetMs(instant);
  return new Date(instant);
}

function kickoff(day: Day, timeText: string): Date {
  let hour = 15;
  let minute = 0;
  const parts = timeText.trim().split(":");
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}/.test(parts[1])) {
    hour = Number(parts[0]);
    minute = Number(/^\d{1,2}/.exec(parts[1])?.[0]);
  }
  return ukLocalToUtc(day, hour, minute);
}

function int(row: Row, key: string): number | null {
  const value = String(row[key] ?? "").trim();
  if (!value) return null;
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return null;
  return number >= 0 && number <= 99 ? number : null;
}

function sum(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

export function teamKey(country: string, name: string): string {
  return `${country}:${normalizeTeamName(name)}`.slice(0, 80);
}

function compactDay(day: Day): string {
  return `${day.year}${String(day.month).padStart(2, "0")}${String(day.day).padStart(2, "0")}`;
}

export function fixtureKey(code: string, day: Day, home: string, away: string): string {
  const key = `${code}:${compactDay(day)}:${normalizeTeamName(home)}:${normalizeTeamName(away)}`;
  if (key.length <= 80) return key;
  return `${code}:${compactDay(day)}:${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

function before(day: Day, since: Day): boolean {
  return Date.UTC(day.year, day.month - 1, day.day) < Date.UTC(since.year, since.month - 1, since.day);
}

function buildMatch(
  league: LeagueInfo,
  seasonName: string,
  day: Day,
  timeText: string,
  home: string,
  away: string,
  homeGoals: number | null,
  awayGoals: number | null,
  htHome: number | null,
  htAway: number | null,
  stats: MatchStats | null,
): CoukMatch {
  const completed = homeGoals !== null && awayGoals !== null;
  return {
    fixture: {
      providerKey: PROVIDER_KEY,
      externalId: fixtureKey(league.code, day, home, away),
      leagueExternalId: league.code,
      leagueName: `${league.country} ${league.name}`,
      country: league.country,
      seasonName,
      kickoff: kickoff(day, timeText),
      homeExternalId: teamKey(league.country, home),
      homeName: home,
      awayExternalId: teamKey(league.country, away),
      awayName: away,
      status: completed ? "completed" : "scheduled",
      homeGoals: completed ? homeGoals : null,
      awayGoals: completed ? awayGoals : null,
      htHomeGoals: completed ? htHome : null,
      htAwayGoals: completed ? htAway : null,
      dataOrigin: "provider",
    },
    stats: completed ? stats : null,
  };
}

export function toDay(date: Date): Day {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function parseMainRows(rows: Row[], seasonName: string | null, since: Day | null = null): CoukMatch[] {
  const matches: CoukMatch[] = [];
  for (const row of rows) {
    const league = LEAGUE_BY_CODE.get(String(row.Div ?? "").trim());
    const day = parseDay(String(row.Date ?? ""));
    const home = String(row.HomeTeam ?? "").trim();
    const away = String(row.AwayTeam ?? "").trim();
    if (!league || !day || !home || !away) continue;
    if (since && before(day, since)) continue;
    const start = day.month >= 7 ? day.year : day.year - 1;
    const cornersHome = int(row, "HC");
    const cornersAway = int(row, "AC");
    const cardsHome = sum(int(row, "HY"), int(row, "HR"));
    const cardsAway = sum(int(row, "AY"), int(row, "AR"));
    const stats =
      [cornersHome, cornersAway, cardsHome, cardsAway].some((value) => value !== null)
        ? {
            home_corners: cornersHome,
            away_corners: cornersAway,
            home_cards: cardsHome,
            away_cards: cardsAway,
            home_shots: int(row, "HS"),
            away_shots: int(row, "AS"),
            home_shots_on_target: int(row, "HST"),
            away_shots_on_target: int(row, "AST"),
          }
        : null;
    matches.push(
      buildMatch(
        league,
        seasonName ?? `${start}/${start + 1}`,
        day,
        String(row.Time ?? ""),
        home,
        away,
        int(row, "FTHG"),
        int(row, "FTAG"),
        int(row, "HTHG"),
        int(row, "HTAG"),
        stats,
      ),
    );
  }
  return matches;
}

export function parseExtraRows(rows: Row[], league: LeagueInfo | null = null, since: Day | null = null): CoukMatch[] {
  const matches: CoukMatch[] = [];
  for (const row of rows) {
    const info = league ?? EXTRA_BY_COUNTRY.get(String(row.Country ?? "").trim());
    const day = parseDay(String(row.Date ?? ""));
    const home = String(row.Home ?? "").trim();
    const away = String(row.Away ?? "").trim();
    if (!info || !day || !home || !away) continue;
    if (since && before(day, since)) continue;
    // The upcoming-fixtures file has no season column; the store reuses the league's latest season.
    const season = String(row.Season ?? "").trim();
    matches.push(buildMatch(info, season, day, String(row.Time ?? ""), home, away, int(row, "HG"), int(row, "AG"), null, null, null));
  }
  return matches;
}

export type CoukFile = { label: string; matches: CoukMatch[] };

export async function* fetchHistory(
  main: LeagueInfo[],
  extra: LeagueInfo[],
  firstSeasonStart: number,
  lastSeasonStart: number,
  since: Day | null = null,
  progress?: (label: string, found: boolean) => void,
): AsyncGenerator<CoukFile> {
  for (const league of main) {
    for (let start = firstSeasonStart; start <= lastSeasonStart; start += 1) {
      const rows = await getCsv(`mmz4281/${seasonCode(start)}/${league.code}.csv`);
      const label = `${league.code} ${start}/${start + 1}`;
      progress?.(label, rows !== null);
      if (rows === null) continue;
      yield { label, matches: parseMainRows(rows, `${start}/${start + 1}`, since) };
    }
  }
  for (const league of extra) {
    const rows = await getCsv(`new/${league.code}.csv`);
    progress?.(league.code, rows !== null);
    if (rows === null) continue;
    // Extra leagues mostly play calendar-year seasons, so the window starts in January.
    yield { label: league.code, matches: parseExtraRows(rows, league, since ?? { year: firstSeasonStart, month: 1, day: 1 }) };
  }
}

export async function* fetchUpcoming(main: LeagueInfo[], extra: LeagueInfo[]): AsyncGenerator<CoukFile> {
  const mainCodes = new Set(main.map((item) => item.code));
  const extraCountries = new Set(extra.map((item) => item.country));
  if (mainCodes.size) {
    const rows = await getCsv("fixtures.csv");
    if (rows) yield { label: "fixtures.csv", matches: parseMainRows(rows.filter((row) => mainCodes.has(String(row.Div ?? "").trim())), null) };
  }
  if (extraCountries.size) {
    const rows = await getCsv("new_league_fixtures.csv");
    if (rows) {
      yield {
        label: "new_league_fixtures.csv",
        matches: parseExtraRows(rows.filter((row) => extraCountries.has(String(row.Country ?? "").trim()))),
      };
    }
  }
}
