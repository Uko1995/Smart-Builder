"""Provider ingestion. A failed fetch is stored as a failed run and nothing else."""

import hashlib
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import IngestionRun, Provider
from app.providers.clients import (
    fetch_api_football_fixtures,
    fetch_football_data_matches,
    fetch_odds,
)
from app.providers.http import ProviderHttpClient, ProviderRequestError
from app.services.reference import effective_settings
from app.services.store import attach_odds, get_provider, upsert_normalized_fixture
from app.services.timeutil import utcnow

logger = logging.getLogger(__name__)


class IngestionFailure(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def refresh_providers(
    session: Session,
    settings: Settings,
    *,
    date_from: str,
    date_to: str,
    season: str | None = None,
    client: ProviderHttpClient | None = None,
    force: bool = False,
) -> list[IngestionRun]:
    owns_client = client is None
    client = client or ProviderHttpClient()
    runs: list[IngestionRun] = []
    try:
        config = effective_settings(session, settings)
        if settings.api_football_key:
            for league_id in settings.split_csv(settings.api_football_league_ids):
                runs.append(
                    _run(
                        session,
                        "api_football",
                        "fixtures",
                        {"league": league_id, "season": season or str(utcnow().year), "from": date_from, "to": date_to},
                        timedelta(minutes=int(config["fixture_refetch_minutes"])),
                        force,
                        lambda league_id=league_id: fetch_api_football_fixtures(
                            settings,
                            client,
                            league_id,
                            season or str(utcnow().year),
                            date_from,
                            date_to,
                        ),
                    )
                )
        if settings.football_data_api_key:
            for competition in settings.split_csv(settings.football_data_competitions):
                runs.append(
                    _run(
                        session,
                        "football_data_org",
                        "fixtures",
                        {"competition": competition, "from": date_from, "to": date_to},
                        timedelta(minutes=int(config["fixture_refetch_minutes"])),
                        force,
                        lambda competition=competition: fetch_football_data_matches(
                            settings, client, competition, date_from, date_to
                        ),
                    )
                )
        if settings.odds_api_key:
            for sport in settings.split_csv(settings.odds_api_sports):
                runs.append(
                    _run(
                        session,
                        "the_odds_api",
                        "odds",
                        {"sport": sport, "markets": "h2h", "bookmakers": settings.odds_api_bookmakers},
                        timedelta(minutes=int(config["odds_refetch_minutes"])),
                        force,
                        lambda sport=sport: fetch_odds(settings, client, sport, "h2h"),
                    )
                )
        if not runs:
            provider = get_provider(session, "manual")
            run = _open_run(session, provider, "refresh", {"mode": "none"})
            run.status = "skipped"
            run.finished_at = utcnow()
            run.details = {"reason": "No data provider API key is configured."}
            session.flush()
            runs.append(run)
        session.commit()
        return runs
    finally:
        if owns_client:
            client.close()


def _run(session, provider_key, kind, fingerprint_payload, freshness, force, fetch) -> IngestionRun:
    provider = get_provider(session, provider_key)
    fingerprint = hashlib.sha256(repr(sorted(fingerprint_payload.items())).encode()).hexdigest()[:32]
    if not force:
        previous = session.scalar(
            select(IngestionRun)
            .where(
                IngestionRun.provider_id == provider.id,
                IngestionRun.kind == kind,
                IngestionRun.request_fingerprint == fingerprint,
                IngestionRun.status == "succeeded",
            )
            .order_by(IngestionRun.finished_at.desc())
        )
        if previous and previous.finished_at and utcnow() - previous.finished_at < freshness:
            skipped = _open_run(session, provider, kind, fingerprint_payload, fingerprint)
            skipped.status = "skipped"
            skipped.finished_at = utcnow()
            skipped.details = {"reason": "An identical request is still inside the refetch window."}
            session.commit()
            return skipped
    run = _open_run(session, provider, kind, fingerprint_payload, fingerprint)
    session.commit()
    try:
        records, meta = fetch()
    except ProviderRequestError as exc:
        _fail(session, run, provider, str(exc))
        failed = session.get(IngestionRun, run.id)
        return failed or run
    except Exception:
        logger.exception("ingestion failed")
        _fail(session, run, provider, "The provider request failed.")
        failed = session.get(IngestionRun, run.id)
        return failed or run
    written = 0
    unmatched = 0
    for record in records:
        if kind == "fixtures":
            _fixture, created = upsert_normalized_fixture(session, record)
            written += int(created)
        else:
            result = attach_odds(session, record)
            if result == "written":
                written += 1
            elif result in {"unmatched", "ambiguous", "unknown_bookmaker", "unmapped"}:
                unmatched += 1
    run.status = "succeeded"
    run.records_written = written
    run.finished_at = utcnow()
    run.details = {"unmatched_or_unmapped": unmatched, **meta}
    provider.health_status = "ok"
    provider.last_checked_at = utcnow()
    provider.last_error = None
    if meta.get("quota_remaining") is not None:
        provider.quota_remaining = meta["quota_remaining"]
    session.commit()
    return run


def _open_run(session, provider: Provider, kind: str, payload: dict, fingerprint: str | None = None) -> IngestionRun:
    digest = fingerprint or hashlib.sha256(repr(sorted(payload.items())).encode()).hexdigest()[:32]
    run = IngestionRun(
        provider_id=provider.id,
        kind=kind,
        status="running",
        request_fingerprint=digest,
        started_at=utcnow(),
        details={},
    )
    session.add(run)
    session.flush()
    return run


def _fail(session: Session, run: IngestionRun, provider: Provider, message: str) -> None:
    session.rollback()
    # The rollback closed the in-memory status of the committed running row.
    persisted = session.get(IngestionRun, run.id)
    if persisted is None:
        return
    persisted.status = "failed"
    persisted.error_message = message[:500]
    persisted.finished_at = utcnow()
    provider_row = session.get(Provider, provider.id)
    if provider_row is not None:
        provider_row.health_status = "error"
        provider_row.last_error = message[:500]
        provider_row.last_checked_at = utcnow()
    session.commit()
