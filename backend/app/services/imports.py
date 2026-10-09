"""Manual CSV import. Rows are validated and labelled with their declared origin."""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

import pandas as pd
from sqlalchemy.orm import Session

from app.config import Settings
from app.providers.parsing import NormalizedFixture, NormalizedOdds, parse_utc
from app.services.reference import seed_reference
from app.services.store import (
    attach_odds_by_external_id,
    upsert_normalized_fixture,
    upsert_statistics,
)

FIXTURE_COLUMNS = {
    "external_id",
    "league",
    "season",
    "kickoff_utc",
    "home_team",
    "away_team",
    "status",
    "data_origin",
}
ODDS_COLUMNS = {
    "fixture_external_id",
    "bookmaker_key",
    "market_key",
    "selection",
    "decimal_odds",
    "captured_at_utc",
    "data_origin",
}
ALLOWED_ORIGINS = {"manual", "synthetic_demo"}
ALLOWED_BOOKS = {"bet9ja", "sportybet", "onexbet", "demo_book"}


class ImportErrorSet(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def import_fixtures_csv(session: Session, settings: Settings, raw: bytes) -> dict:
    seed_reference(session, settings)
    frame = _read_frame(raw, FIXTURE_COLUMNS)
    errors: list[str] = []
    written = 0
    for index, row in frame.iterrows():
        line_no = int(index) + 2
        try:
            origin = str(row["data_origin"]).strip()
            if origin not in ALLOWED_ORIGINS:
                raise ValueError("data_origin must be manual or synthetic_demo")
            status = str(row["status"]).strip()
            if status not in {"scheduled", "completed", "postponed", "cancelled", "unknown"}:
                raise ValueError("status is not recognised")
            fixture, _created = upsert_normalized_fixture(
                session,
                NormalizedFixture(
                    provider_key="manual" if origin == "manual" else "synthetic_demo",
                    external_id=str(row["external_id"]).strip(),
                    league_external_id=str(row["league"]).strip(),
                    league_name=str(row["league"]).strip(),
                    country=None,
                    season_name=str(row["season"]).strip(),
                    kickoff=parse_utc(str(row["kickoff_utc"]).strip()),
                    home_external_id=str(row["home_team"]).strip(),
                    home_name=str(row["home_team"]).strip(),
                    away_external_id=str(row["away_team"]).strip(),
                    away_name=str(row["away_team"]).strip(),
                    status=status,
                    home_goals=_optional_int(row.get("home_goals")),
                    away_goals=_optional_int(row.get("away_goals")),
                    ht_home_goals=_optional_int(row.get("ht_home_goals")),
                    ht_away_goals=_optional_int(row.get("ht_away_goals")),
                    data_origin=origin,
                ),
            )
            if any(_present(row.get(name)) for name in ("home_corners", "away_corners", "home_cards", "away_cards", "home_xg", "away_xg")):
                upsert_statistics(
                    session,
                    fixture.id,
                    home_corners=_optional_int(row.get("home_corners")),
                    away_corners=_optional_int(row.get("away_corners")),
                    home_cards=_optional_int(row.get("home_cards")),
                    away_cards=_optional_int(row.get("away_cards")),
                    home_xg=_optional_decimal(row.get("home_xg")),
                    away_xg=_optional_decimal(row.get("away_xg")),
                    source="manual_import",
                    captured_at=datetime.now(UTC),
                )
            written += 1
        except Exception as exc:
            errors.append(f"row {line_no}: {exc}")
    if errors:
        session.rollback()
        raise ImportErrorSet(errors)
    session.commit()
    return {"written": written, "label": "imported rows keep the data_origin from the file"}


def import_odds_csv(session: Session, settings: Settings, raw: bytes) -> dict:
    seed_reference(session, settings)
    frame = _read_frame(raw, ODDS_COLUMNS)
    errors = []
    written = 0
    for index, row in frame.iterrows():
        line_no = int(index) + 2
        try:
            origin = str(row["data_origin"]).strip()
            book = str(row["bookmaker_key"]).strip()
            if origin not in ALLOWED_ORIGINS:
                raise ValueError("data_origin must be manual or synthetic_demo")
            if book not in ALLOWED_BOOKS:
                raise ValueError("bookmaker_key is not one of the supported books")
            if book == "demo_book" and origin != "synthetic_demo":
                raise ValueError("demo_book only accepts synthetic_demo rows")
            line = _optional_decimal(row.get("line"))
            result = attach_odds_by_external_id(
                session,
                str(row["fixture_external_id"]).strip(),
                NormalizedOdds(
                    provider_key="manual" if origin == "manual" else "synthetic_demo",
                    fixture_external_id=str(row["fixture_external_id"]).strip(),
                    home_name="",
                    away_name="",
                    kickoff=datetime.now(UTC),
                    bookmaker_key=book,
                    bookmaker_name=book,
                    provider_market_key="manual",
                    market_key=str(row["market_key"]).strip(),
                    selection=str(row["selection"]).strip(),
                    line=line,
                    decimal_odds=Decimal(str(row["decimal_odds"])),
                    captured_at=parse_utc(str(row["captured_at_utc"]).strip()),
                    mapping_status="manual" if origin == "manual" else "verified",
                    data_origin=origin,
                ),
            )
            if result not in {"written", "duplicate"}:
                raise ValueError(f"odds were not attached ({result}). Import the fixture first.")
            written += 1
        except Exception as exc:
            errors.append(f"row {line_no}: {exc}")
    if errors:
        session.rollback()
        raise ImportErrorSet(errors)
    session.commit()
    return {"written": written}


def _read_frame(raw: bytes, required: set[str]) -> pd.DataFrame:
    try:
        frame = pd.read_csv(pd.io.common.BytesIO(raw))
    except Exception as exc:
        raise ImportErrorSet([f"CSV could not be read: {exc}"]) from exc
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ImportErrorSet([f"missing columns: {', '.join(missing)}"])
    if frame.empty:
        raise ImportErrorSet(["the file has no data rows"])
    return frame


def _present(value) -> bool:
    return not (value is None or (isinstance(value, float) and pd.isna(value)) or value == "")


def _optional_int(value) -> int | None:
    if not _present(value):
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"expected an integer, got {value}") from exc


def _optional_decimal(value) -> Decimal | None:
    if not _present(value):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"expected a decimal, got {value}") from exc
