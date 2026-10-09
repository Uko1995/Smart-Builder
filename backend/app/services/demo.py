"""Clearly labelled synthetic fixtures. These are not real matches or prices."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import numpy as np
from sqlalchemy.orm import Session

from app.config import Settings
from app.providers.parsing import NormalizedFixture, NormalizedOdds
from app.services.reference import seed_reference
from app.services.store import attach_odds, upsert_normalized_fixture
from app.services.timeutil import utcnow

TEAMS = (
    ("harbor", "Harbor City", 1.30, 0.82),
    ("lantern", "Red Lantern", 1.15, 0.90),
    ("quarry", "North Quarry", 1.05, 0.98),
    ("eastmill", "Eastmill", 0.95, 1.05),
    ("dock", "Silver Dock", 0.88, 1.12),
    ("lowfield", "Lowfield United", 0.78, 1.22),
)


def seed_demo(session: Session, settings: Settings, today: date | None = None) -> dict:
    seed_reference(session, settings)
    anchor = today or datetime.now(UTC).date()
    rng = np.random.default_rng(20261009)
    written = 0
    match_no = 0
    kickoff = datetime.combine(anchor - timedelta(days=80), datetime.min.time(), tzinfo=UTC).replace(hour=15)
    for round_index in range(2):
        for home_index, home in enumerate(TEAMS):
            for away_index, away in enumerate(TEAMS):
                if home_index == away_index:
                    continue
                match_no += 1
                lam_home = max(0.2, 1.35 * home[2] * away[3])
                lam_away = max(0.2, 1.10 * away[2] * home[3])
                fixture = NormalizedFixture(
                    provider_key="synthetic_demo",
                    external_id=f"demo-r{round_index}-{match_no}",
                    league_external_id="spl-demo",
                    league_name="SPL Demo League (synthetic)",
                    country="Demo",
                    season_name=f"{anchor.year}-demo",
                    kickoff=kickoff,
                    home_external_id=home[0],
                    home_name=home[1],
                    away_external_id=away[0],
                    away_name=away[1],
                    status="completed",
                    home_goals=int(rng.poisson(lam_home)),
                    away_goals=int(rng.poisson(lam_away)),
                    ht_home_goals=None,
                    ht_away_goals=None,
                    data_origin="synthetic_demo",
                )
                upsert_normalized_fixture(session, fixture)
                written += 1
                kickoff += timedelta(days=1)
                if kickoff.date() >= anchor:
                    kickoff = datetime.combine(anchor - timedelta(days=2), datetime.min.time(), tzinfo=UTC).replace(hour=15)

    upcoming_pairs = ((0, 5), (1, 4), (2, 3), (0, 4))
    upcoming_ids = []
    for offset, (home_index, away_index) in enumerate(upcoming_pairs):
        home = TEAMS[home_index]
        away = TEAMS[away_index]
        external_id = f"demo-upcoming-{offset}"
        kickoff = datetime.combine(anchor + timedelta(days=1), datetime.min.time(), tzinfo=UTC).replace(hour=15 + offset)
        upsert_normalized_fixture(
            session,
            NormalizedFixture(
                provider_key="synthetic_demo",
                external_id=external_id,
                league_external_id="spl-demo",
                league_name="SPL Demo League (synthetic)",
                country="Demo",
                season_name=f"{anchor.year}-demo",
                kickoff=kickoff,
                home_external_id=home[0],
                home_name=home[1],
                away_external_id=away[0],
                away_name=away[1],
                status="scheduled",
                home_goals=None,
                away_goals=None,
                ht_home_goals=None,
                ht_away_goals=None,
                data_origin="synthetic_demo",
            ),
        )
        upcoming_ids.append(external_id)
        captured = utcnow()
        for selection, price in (("home", "2.20"), ("draw", "3.40"), ("away", "4.10")):
            attach_odds(
                session,
                NormalizedOdds(
                    provider_key="synthetic_demo",
                    fixture_external_id=external_id,
                    home_name=home[1],
                    away_name=away[1],
                    kickoff=kickoff,
                    bookmaker_key="demo_book",
                    bookmaker_name="Demo Book (synthetic)",
                    provider_market_key="synthetic_h2h",
                    market_key="match_result",
                    selection=selection,
                    line=None,
                    decimal_odds=Decimal(price),
                    captured_at=captured,
                    mapping_status="verified",
                    data_origin="synthetic_demo",
                ),
            )
    session.commit()
    return {
        "label": "synthetic demonstration data",
        "completed_matches": written,
        "upcoming_external_ids": upcoming_ids,
        "scope_date": (anchor + timedelta(days=1)).isoformat(),
    }
