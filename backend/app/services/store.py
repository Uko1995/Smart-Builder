"""Idempotent writes for fixtures, teams and immutable odds snapshots."""

from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Bookmaker,
    Fixture,
    League,
    MatchStatistics,
    OddsSnapshot,
    Provider,
    Season,
    Team,
)
from app.providers.names import normalize_team_name
from app.providers.parsing import NormalizedFixture, NormalizedOdds
from app.services.timeutil import utcnow


def get_provider(session: Session, key: str) -> Provider:
    provider = session.scalar(select(Provider).where(Provider.key == key))
    if provider is None:
        raise RuntimeError(f"provider {key} is not seeded")
    return provider


def upsert_normalized_fixture(session: Session, item: NormalizedFixture) -> tuple[Fixture, bool]:
    provider = get_provider(session, item.provider_key)
    league = session.scalar(
        select(League).where(League.provider_id == provider.id, League.external_id == item.league_external_id)
    )
    if league is None:
        league = League(
            provider_id=provider.id,
            external_id=item.league_external_id,
            name=item.league_name,
            country=item.country,
            data_origin=item.data_origin,
        )
        session.add(league)
        session.flush()
    season = session.scalar(select(Season).where(Season.league_id == league.id, Season.name == item.season_name))
    if season is None:
        season = Season(league_id=league.id, name=item.season_name)
        session.add(season)
        session.flush()
    home = _upsert_team(session, provider.id, item.home_external_id, item.home_name, item.data_origin)
    away = _upsert_team(session, provider.id, item.away_external_id, item.away_name, item.data_origin)
    fixture = session.scalar(
        select(Fixture).where(Fixture.provider_id == provider.id, Fixture.external_id == item.external_id)
    )
    created = fixture is None
    if fixture is None:
        fixture = Fixture(
            provider_id=provider.id,
            external_id=item.external_id,
            league_id=league.id,
            season_id=season.id,
            home_team_id=home.id,
            away_team_id=away.id,
            kickoff_at=item.kickoff,
            status=item.status,
            home_goals=item.home_goals,
            away_goals=item.away_goals,
            ht_home_goals=item.ht_home_goals,
            ht_away_goals=item.ht_away_goals,
            data_origin=item.data_origin,
            provenance={"provider": item.provider_key, "external_id": item.external_id},
        )
        session.add(fixture)
        session.flush()
        return fixture, created
    fixture.kickoff_at = item.kickoff
    fixture.status = item.status
    if item.home_goals is not None:
        fixture.home_goals = item.home_goals
    if item.away_goals is not None:
        fixture.away_goals = item.away_goals
    if item.ht_home_goals is not None:
        fixture.ht_home_goals = item.ht_home_goals
    if item.ht_away_goals is not None:
        fixture.ht_away_goals = item.ht_away_goals
    session.flush()
    return fixture, created


def _upsert_team(session: Session, provider_id: int, external_id: str, name: str, origin: str) -> Team:
    team = session.scalar(
        select(Team).where(Team.provider_id == provider_id, Team.external_id == external_id)
    )
    if team is None:
        team = Team(
            provider_id=provider_id,
            external_id=external_id,
            name=name,
            normalized_name=normalize_team_name(name),
            data_origin=origin,
        )
        session.add(team)
        session.flush()
    return team


def attach_odds(session: Session, item: NormalizedOdds) -> str:
    """Attach a price to one stored fixture. Ambiguous matches are not guessed."""
    if item.market_key is None or item.selection is None:
        return "unmapped"
    home_name = normalize_team_name(item.home_name)
    away_name = normalize_team_name(item.away_name)
    window_start = item.kickoff - timedelta(minutes=90)
    window_end = item.kickoff + timedelta(minutes=90)
    rows = session.scalars(
        select(Fixture).where(Fixture.kickoff_at >= window_start, Fixture.kickoff_at <= window_end)
    ).all()
    matches = []
    for fixture in rows:
        home = session.get(Team, fixture.home_team_id)
        away = session.get(Team, fixture.away_team_id)
        if home and away and home.normalized_name == home_name and away.normalized_name == away_name:
            matches.append(fixture)
    if len(matches) > 1:
        return "ambiguous"
    if len(matches) == 1:
        fixture = matches[0]
    else:
        fixture = _create_odds_fixture(session, item)
        if fixture is None:
            return "unmatched"
    return _insert_snapshot(session, fixture, item)


def _create_odds_fixture(session: Session, item: NormalizedOdds) -> Fixture | None:
    """Store an upcoming event that the odds feed reported and no other fixture matched."""
    provider = get_provider(session, item.provider_key)
    existing = session.scalar(
        select(Fixture).where(
            Fixture.provider_id == provider.id, Fixture.external_id == item.fixture_external_id
        )
    )
    if existing is not None:
        return existing
    normalized = NormalizedFixture(
        provider_key=item.provider_key,
        external_id=item.fixture_external_id,
        league_external_id="odds-unscoped",
        league_name="Odds feed (competition not matched)",
        country=None,
        season_name=str(item.kickoff.year),
        kickoff=item.kickoff,
        home_external_id=normalize_team_name(item.home_name) or item.home_name,
        home_name=item.home_name,
        away_external_id=normalize_team_name(item.away_name) or item.away_name,
        away_name=item.away_name,
        status="scheduled",
        home_goals=None,
        away_goals=None,
        ht_home_goals=None,
        ht_away_goals=None,
        data_origin=item.data_origin,
    )
    fixture, _created = upsert_normalized_fixture(session, normalized)
    return fixture


def attach_odds_by_external_id(session: Session, external_id: str, item: NormalizedOdds) -> str:
    fixtures = session.scalars(select(Fixture).where(Fixture.external_id == external_id)).all()
    if not fixtures:
        return "unmatched"
    if len(fixtures) > 1:
        return "ambiguous"
    return _insert_snapshot(session, fixtures[0], item)


def _insert_snapshot(session: Session, fixture: Fixture, item: NormalizedOdds) -> str:
    if item.market_key is None or item.selection is None:
        return "unmapped"
    bookmaker = session.scalar(select(Bookmaker).where(Bookmaker.key == item.bookmaker_key))
    if bookmaker is None:
        return "unknown_bookmaker"
    provider = get_provider(session, item.provider_key)
    line_clause = OddsSnapshot.line.is_(None) if item.line is None else OddsSnapshot.line == item.line
    existing = session.scalar(
        select(OddsSnapshot).where(
            OddsSnapshot.fixture_id == fixture.id,
            OddsSnapshot.bookmaker_id == bookmaker.id,
            OddsSnapshot.market_key == item.market_key,
            OddsSnapshot.selection == item.selection,
            line_clause,
            OddsSnapshot.captured_at == item.captured_at,
        )
    )
    if existing is not None:
        return "duplicate"
    session.add(
        OddsSnapshot(
            fixture_id=fixture.id,
            bookmaker_id=bookmaker.id,
            provider_id=provider.id,
            market_key=item.market_key,
            selection=item.selection,
            line=item.line,
            decimal_odds=item.decimal_odds,
            captured_at=item.captured_at,
            source_timestamp=item.captured_at,
            mapping_status=item.mapping_status,
            data_origin=item.data_origin,
        )
    )
    session.flush()
    return "written"


def upsert_statistics(
    session: Session,
    fixture_id: int,
    *,
    home_corners: int | None = None,
    away_corners: int | None = None,
    home_cards: int | None = None,
    away_cards: int | None = None,
    home_xg: Decimal | None = None,
    away_xg: Decimal | None = None,
    source: str,
    captured_at: datetime | None = None,
) -> None:
    row = session.scalar(select(MatchStatistics).where(MatchStatistics.fixture_id == fixture_id))
    captured = captured_at or utcnow()
    if row is None:
        session.add(
            MatchStatistics(
                fixture_id=fixture_id,
                home_corners=home_corners,
                away_corners=away_corners,
                home_cards=home_cards,
                away_cards=away_cards,
                home_xg=home_xg,
                away_xg=away_xg,
                source=source,
                captured_at=captured,
            )
        )
    else:
        if home_corners is not None:
            row.home_corners = home_corners
        if away_corners is not None:
            row.away_corners = away_corners
        if home_cards is not None:
            row.home_cards = home_cards
        if away_cards is not None:
            row.away_cards = away_cards
        if home_xg is not None:
            row.home_xg = home_xg
        if away_xg is not None:
            row.away_xg = away_xg
        row.source = source
        row.captured_at = captured
    session.flush()
