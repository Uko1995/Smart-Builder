/** Documented HTTP calls. Missing keys are reported, not bypassed. */

import { splitCsv, type Settings } from "@/server/config";
import { providerGet, ProviderRequestError } from "@/server/providers/http";
import {
  parseApiFootballFixtures,
  parseFootballDataMatches,
  parseOddsApiPayload,
  type NormalizedFixture,
  type NormalizedOdds,
} from "@/server/providers/parsing";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";

export type FetchMeta = Record<string, unknown> & { quota_remaining?: number | null; written?: number };

function intOrNull(value: string | null): number | null {
  if (value === null || value === "") return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function notConfigured(provider: string): never {
  throw new ProviderRequestError(`${provider} is not configured`);
}

export async function fetchApiFootballFixtures(
  settings: Settings,
  leagueId: string,
  season: string,
  dateFrom: string,
  dateTo: string,
): Promise<[NormalizedFixture[], FetchMeta]> {
  if (!settings.apiFootballKey) notConfigured("api_football");
  const response = await providerGet(`${API_FOOTBALL_BASE}/fixtures`, {
    headers: { "x-apisports-key": settings.apiFootballKey as string },
    params: { league: leagueId, season, from: dateFrom, to: dateTo },
  });
  if (response.status === 401 || response.status === 403) throw new ProviderRequestError("API-Football rejected the API key", response.status);
  if (response.status >= 400) throw new ProviderRequestError(`API-Football returned ${response.status}`, response.status);
  return [parseApiFootballFixtures(response.payload), { quota_remaining: intOrNull(response.headers.get("x-ratelimit-requests-remaining")) }];
}

export async function fetchFootballDataMatches(
  settings: Settings,
  competition: string,
  dateFrom: string,
  dateTo: string,
): Promise<[NormalizedFixture[], FetchMeta]> {
  if (!settings.footballDataApiKey) notConfigured("football_data_org");
  const response = await providerGet(`${FOOTBALL_DATA_BASE}/competitions/${encodeURIComponent(competition)}/matches`, {
    headers: { "X-Auth-Token": settings.footballDataApiKey as string },
    params: { dateFrom, dateTo },
  });
  if (response.status === 401 || response.status === 403) throw new ProviderRequestError("football-data.org rejected the API token", response.status);
  if (response.status >= 400) throw new ProviderRequestError(`football-data.org returned ${response.status}`, response.status);
  return [parseFootballDataMatches(response.payload), {}];
}

export async function fetchOdds(settings: Settings, sportKey: string, markets = "h2h"): Promise<[NormalizedOdds[], FetchMeta]> {
  if (!settings.oddsApiKey) notConfigured("the_odds_api");
  const bookmakers = settings.oddsApiBookmakers;
  const response = await providerGet(`${ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/odds`, {
    params: { apiKey: settings.oddsApiKey as string, bookmakers, markets, oddsFormat: "decimal" },
  });
  if (response.status === 401 || response.status === 403) throw new ProviderRequestError("The Odds API rejected the API key", response.status);
  if (response.status === 429) throw new ProviderRequestError("The Odds API quota is exhausted", 429);
  if (response.status >= 400) throw new ProviderRequestError(`The Odds API returned ${response.status}`, response.status);
  return [
    parseOddsApiPayload(response.payload, new Set(splitCsv(bookmakers))),
    { quota_remaining: intOrNull(response.headers.get("x-requests-remaining")), sport_key: sportKey, markets },
  ];
}

/** The events endpoint does not use quota. */
export async function listOddsEvents(settings: Settings, sportKey: string, from: string, to: string): Promise<Record<string, unknown>[]> {
  if (!settings.oddsApiKey) notConfigured("the_odds_api");
  const response = await providerGet(`${ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/events`, {
    params: { apiKey: settings.oddsApiKey as string, commenceTimeFrom: from, commenceTimeTo: to },
  });
  if (response.status === 401 || response.status === 403) throw new ProviderRequestError("The Odds API rejected the API key", response.status);
  if (response.status >= 400) throw new ProviderRequestError(`The Odds API returned ${response.status}`, response.status);
  return Array.isArray(response.payload) ? (response.payload as Record<string, unknown>[]) : [];
}

/** Per-event markets. Each event costs one credit per market returned. */
export async function fetchEventOdds(settings: Settings, events: [string, string][], markets: string): Promise<[NormalizedOdds[], FetchMeta]> {
  if (!settings.oddsApiKey) notConfigured("the_odds_api");
  const bookmakers = settings.oddsApiBookmakers;
  const allowed = new Set(splitCsv(bookmakers));
  const rows: NormalizedOdds[] = [];
  let remaining: string | null = null;
  for (const [sportKey, eventId] of events) {
    const response = await providerGet(`${ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds`, {
      params: { apiKey: settings.oddsApiKey as string, bookmakers, markets, oddsFormat: "decimal" },
    });
    remaining = response.headers.get("x-requests-remaining") ?? remaining;
    if (response.status === 404) continue;
    if (response.status === 401 || response.status === 403) throw new ProviderRequestError("The Odds API rejected the API key", response.status);
    if (response.status === 429) throw new ProviderRequestError("The Odds API quota is exhausted", 429);
    if (response.status >= 400) throw new ProviderRequestError(`The Odds API returned ${response.status}`, response.status);
    rows.push(...parseOddsApiPayload([response.payload], allowed));
  }
  return [rows, { quota_remaining: intOrNull(remaining), events: events.length, markets }];
}
