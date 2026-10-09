"""Documented HTTP calls. Missing keys are reported, not bypassed."""

from app.config import Settings
from app.providers.http import ProviderHttpClient, ProviderRequestError
from app.providers.parsing import (
    NormalizedFixture,
    NormalizedOdds,
    parse_api_football_fixtures,
    parse_football_data_matches,
    parse_odds_api_payload,
)

API_FOOTBALL_BASE = "https://v3.football.api-sports.io"
ODDS_API_BASE = "https://api.the-odds-api.com/v4"
FOOTBALL_DATA_BASE = "https://api.football-data.org/v4"


class ProviderNotConfigured(ProviderRequestError):
    def __init__(self, provider: str):
        super().__init__(f"{provider} is not configured", status_code=None, retryable=False)
        self.provider = provider


def fetch_api_football_fixtures(
    settings: Settings,
    client: ProviderHttpClient,
    league_id: str,
    season: str,
    date_from: str,
    date_to: str,
) -> tuple[list[NormalizedFixture], dict]:
    if not settings.api_football_key:
        raise ProviderNotConfigured("api_football")
    response = client.get(
        f"{API_FOOTBALL_BASE}/fixtures",
        headers={"x-apisports-key": settings.api_football_key},
        params={"league": league_id, "season": season, "from": date_from, "to": date_to},
    )
    remaining = response.headers.get("x-ratelimit-requests-remaining")
    if response.status_code in {401, 403}:
        raise ProviderRequestError("API-Football rejected the API key", response.status_code)
    if response.status_code >= 400:
        raise ProviderRequestError(f"API-Football returned {response.status_code}", response.status_code)
    return parse_api_football_fixtures(response.payload), {"quota_remaining": _int_or_none(remaining)}


def fetch_football_data_matches(
    settings: Settings,
    client: ProviderHttpClient,
    competition: str,
    date_from: str,
    date_to: str,
) -> tuple[list[NormalizedFixture], dict]:
    if not settings.football_data_api_key:
        raise ProviderNotConfigured("football_data_org")
    response = client.get(
        f"{FOOTBALL_DATA_BASE}/competitions/{competition}/matches",
        headers={"X-Auth-Token": settings.football_data_api_key},
        params={"dateFrom": date_from, "dateTo": date_to},
    )
    if response.status_code in {401, 403}:
        raise ProviderRequestError("football-data.org rejected the API token", response.status_code)
    if response.status_code >= 400:
        raise ProviderRequestError(
            f"football-data.org returned {response.status_code}", response.status_code
        )
    return parse_football_data_matches(response.payload), {}


def fetch_odds(
    settings: Settings,
    client: ProviderHttpClient,
    sport_key: str,
    markets: str = "h2h",
) -> tuple[list[NormalizedOdds], dict]:
    if not settings.odds_api_key:
        raise ProviderNotConfigured("the_odds_api")
    bookmakers = settings.odds_api_bookmakers
    response = client.get(
        f"{ODDS_API_BASE}/sports/{sport_key}/odds",
        params={
            "apiKey": settings.odds_api_key,
            "bookmakers": bookmakers,
            "markets": markets,
            "oddsFormat": "decimal",
        },
    )
    remaining = response.headers.get("x-requests-remaining")
    if response.status_code in {401, 403}:
        raise ProviderRequestError("The Odds API rejected the API key", response.status_code)
    if response.status_code == 429:
        raise ProviderRequestError("The Odds API quota is exhausted", 429, retryable=False)
    if response.status_code >= 400:
        raise ProviderRequestError(f"The Odds API returned {response.status_code}", response.status_code)
    allowed = set(settings.split_csv(bookmakers))
    return parse_odds_api_payload(response.payload, allowed), {
        "quota_remaining": _int_or_none(remaining),
        "sport_key": sport_key,
        "markets": markets,
    }


def _int_or_none(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None
