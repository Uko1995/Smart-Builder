"""Pure transforms from documented provider payloads into normalized records."""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation


class PayloadError(ValueError):
    pass


@dataclass(frozen=True)
class NormalizedFixture:
    provider_key: str
    external_id: str
    league_external_id: str
    league_name: str
    country: str | None
    season_name: str
    kickoff: datetime
    home_external_id: str
    home_name: str
    away_external_id: str
    away_name: str
    status: str
    home_goals: int | None
    away_goals: int | None
    ht_home_goals: int | None
    ht_away_goals: int | None
    data_origin: str = "provider"


@dataclass(frozen=True)
class NormalizedOdds:
    provider_key: str
    fixture_external_id: str
    home_name: str
    away_name: str
    kickoff: datetime
    bookmaker_key: str
    bookmaker_name: str
    provider_market_key: str
    market_key: str | None
    selection: str | None
    line: Decimal | None
    decimal_odds: Decimal
    captured_at: datetime
    mapping_status: str
    data_origin: str = "provider"


_API_FOOTBALL_STATUS = {
    "TBD": "scheduled",
    "NS": "scheduled",
    "FT": "completed",
    "AET": "completed",
    "PEN": "completed",
    "PST": "postponed",
    "SUSP": "postponed",
    "CANC": "cancelled",
    "ABD": "cancelled",
    "AWD": "completed",
    "WO": "completed",
}

_FOOTBALL_DATA_STATUS = {
    "SCHEDULED": "scheduled",
    "TIMED": "scheduled",
    "IN_PLAY": "scheduled",
    "PAUSED": "scheduled",
    "FINISHED": "completed",
    "AWARDED": "completed",
    "POSTPONED": "postponed",
    "SUSPENDED": "postponed",
    "CANCELLED": "cancelled",
}


def parse_utc(value: str) -> datetime:
    text = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _goals(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise PayloadError(f"goal value is not an integer: {value}") from exc
    if number < 0 or number > 30:
        raise PayloadError("goal value is outside 0..30")
    return number


def parse_api_football_fixtures(payload: dict) -> list[NormalizedFixture]:
    if not isinstance(payload, dict) or not isinstance(payload.get("response"), list):
        raise PayloadError("API-Football payload did not contain a response list")
    fixtures = []
    for item in payload["response"]:
        try:
            fixture = item["fixture"]
            league = item["league"]
            teams = item["teams"]
            goals = item.get("goals") or {}
            score = (item.get("score") or {}).get("halftime") or {}
            status = _API_FOOTBALL_STATUS.get(fixture["status"]["short"], "unknown")
            fixtures.append(
                NormalizedFixture(
                    provider_key="api_football",
                    external_id=str(fixture["id"]),
                    league_external_id=str(league["id"]),
                    league_name=str(league["name"]),
                    country=league.get("country"),
                    season_name=str(league["season"]),
                    kickoff=parse_utc(fixture["date"]),
                    home_external_id=str(teams["home"]["id"]),
                    home_name=str(teams["home"]["name"]),
                    away_external_id=str(teams["away"]["id"]),
                    away_name=str(teams["away"]["name"]),
                    status=status,
                    home_goals=_goals(goals.get("home")),
                    away_goals=_goals(goals.get("away")),
                    ht_home_goals=_goals(score.get("home")),
                    ht_away_goals=_goals(score.get("away")),
                )
            )
        except (KeyError, TypeError, PayloadError) as exc:
            raise PayloadError(f"API-Football fixture was incomplete: {exc}") from exc
    return fixtures


def parse_football_data_matches(payload: dict) -> list[NormalizedFixture]:
    matches = payload.get("matches") if isinstance(payload, dict) else None
    if not isinstance(matches, list):
        raise PayloadError("football-data.org payload did not contain matches")
    fixtures = []
    for item in matches:
        try:
            competition = item["competition"]
            season = item.get("season") or {}
            score = item.get("score") or {}
            full_time = score.get("fullTime") or {}
            half_time = score.get("halfTime") or {}
            season_name = str(season.get("startDate", "unknown"))[:4]
            fixtures.append(
                NormalizedFixture(
                    provider_key="football_data_org",
                    external_id=str(item["id"]),
                    league_external_id=str(competition.get("code") or competition["id"]),
                    league_name=str(competition["name"]),
                    country=None,
                    season_name=season_name,
                    kickoff=parse_utc(item["utcDate"]),
                    home_external_id=str(item["homeTeam"]["id"]),
                    home_name=str(item["homeTeam"]["name"]),
                    away_external_id=str(item["awayTeam"]["id"]),
                    away_name=str(item["awayTeam"]["name"]),
                    status=_FOOTBALL_DATA_STATUS.get(item.get("status"), "unknown"),
                    home_goals=_goals(full_time.get("home")),
                    away_goals=_goals(full_time.get("away")),
                    ht_home_goals=_goals(half_time.get("home")),
                    ht_away_goals=_goals(half_time.get("away")),
                )
            )
        except (KeyError, TypeError, PayloadError) as exc:
            raise PayloadError(f"football-data.org match was incomplete: {exc}") from exc
    return fixtures


def _canonical_h2h(name: str, home: str, away: str) -> str | None:
    lowered = name.strip().lower()
    if lowered == "draw":
        return "draw"
    if name == home:
        return "home"
    if name == away:
        return "away"
    return None


def _decimal_odds(value) -> Decimal:
    try:
        odds = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise PayloadError(f"odds value is not decimal: {value}") from exc
    if odds <= 1:
        raise PayloadError("decimal odds must be greater than 1")
    return odds.quantize(Decimal("0.0001"))


def parse_odds_api_payload(payload: list, bookmaker_filter: set[str] | None = None) -> list[NormalizedOdds]:
    if not isinstance(payload, list):
        raise PayloadError("The Odds API payload was not a list")
    rows: list[NormalizedOdds] = []
    for event in payload:
        try:
            home = str(event["home_team"])
            away = str(event["away_team"])
            kickoff = parse_utc(event["commence_time"])
            event_id = str(event["id"])
        except (KeyError, TypeError) as exc:
            raise PayloadError(f"The Odds API event was incomplete: {exc}") from exc
        for book in event.get("bookmakers") or []:
            book_key = str(book.get("key", ""))
            if bookmaker_filter and book_key not in bookmaker_filter:
                continue
            for market in book.get("markets") or []:
                market_key = str(market.get("key", ""))
                updated = market.get("last_update") or book.get("last_update")
                if not updated:
                    continue
                captured = parse_utc(updated)
                for outcome in market.get("outcomes") or []:
                    try:
                        price = _decimal_odds(outcome["price"])
                    except (KeyError, PayloadError):
                        continue
                    selection, canonical, line, mapping = _map_odds_outcome(
                        market_key, outcome, home, away
                    )
                    if selection is None:
                        rows.append(
                            NormalizedOdds(
                                provider_key="the_odds_api",
                                fixture_external_id=event_id,
                                home_name=home,
                                away_name=away,
                                kickoff=kickoff,
                                bookmaker_key=book_key,
                                bookmaker_name=str(book.get("title") or book_key),
                                provider_market_key=market_key,
                                market_key=None,
                                selection=None,
                                line=line,
                                decimal_odds=price,
                                captured_at=captured,
                                mapping_status="mapping_required",
                            )
                        )
                        continue
                    rows.append(
                        NormalizedOdds(
                            provider_key="the_odds_api",
                            fixture_external_id=event_id,
                            home_name=home,
                            away_name=away,
                            kickoff=kickoff,
                            bookmaker_key=book_key,
                            bookmaker_name=str(book.get("title") or book_key),
                            provider_market_key=market_key,
                            market_key=canonical,
                            selection=selection,
                            line=line,
                            decimal_odds=price,
                            captured_at=captured,
                            mapping_status=mapping,
                        )
                    )
    return rows


def _map_odds_outcome(market_key: str, outcome: dict, home: str, away: str):
    name = str(outcome.get("name", ""))
    point = outcome.get("point")
    line = None
    if point is not None:
        line = Decimal(str(point)).quantize(Decimal("0.01"))
    if market_key == "h2h":
        selection = _canonical_h2h(name, home, away)
        if selection is None:
            return None, None, line, "mapping_required"
        return selection, "match_result", None, "verified"
    if market_key == "totals":
        lowered = name.lower()
        if lowered not in {"over", "under"} or line is None:
            return None, None, line, "mapping_required"
        if line % 1 != Decimal("0.5") and line % 1 != Decimal("-0.5"):
            # Quarter and integer totals are not given the verified half-line mapping.
            return None, None, line, "mapping_required"
        return lowered, "over_under_goals", line, "verified"
    if market_key == "spreads":
        return None, None, line, "mapping_required"
    return None, None, line, "mapping_required"
