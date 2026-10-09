"""HTTP API. Mutating routes require the dashboard session token."""

from datetime import date

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth import create_token, decode_token, secrets_match
from app.config import Settings, get_settings
from app.db import get_db
from app.models import Slip
from app.rate_limit import limiter
from app.services.demo import seed_demo
from app.services.imports import ImportErrorSet, import_fixtures_csv, import_odds_csv
from app.services.ingestion import refresh_providers
from app.services.predictions import TERMINAL, PredictionRequestError, create_prediction_run
from app.services.reference import seed_reference, update_settings
from app.services.settlement import record_result
from app.services.timeutil import utcnow
from app.services.views import (
    batch_summary,
    coverage,
    explorer,
    fixture_detail,
    ingestion_log,
    overview,
    performance,
    slip_export_text,
    slip_payload,
)

router = APIRouter()


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class PredictionCreate(BaseModel):
    scope_date: date
    league_id: int | None = None
    refresh: bool = False
    time_budget_seconds: int | None = Field(default=None, ge=5, le=60)


class DecisionRequest(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    note: str | None = Field(default=None, max_length=500)


class BookingCodeRequest(BaseModel):
    bookmaker_key: str = Field(pattern="^(bet9ja|sportybet|onexbet)$")
    booking_code: str = Field(min_length=1, max_length=64)


class ResultRequest(BaseModel):
    home_goals: int = Field(ge=0, le=30)
    away_goals: int = Field(ge=0, le=30)
    ht_home_goals: int | None = Field(default=None, ge=0, le=30)
    ht_away_goals: int | None = Field(default=None, ge=0, le=30)
    home_corners: int | None = Field(default=None, ge=0, le=40)
    away_corners: int | None = Field(default=None, ge=0, le=40)
    home_cards: int | None = Field(default=None, ge=0, le=30)
    away_cards: int | None = Field(default=None, ge=0, le=30)


class SettingsUpdate(BaseModel):
    changes: dict


class RefreshRequest(BaseModel):
    date_from: date
    date_to: date
    season: str | None = None
    force: bool = False


def get_request_settings() -> Settings:
    return get_settings()


def require_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_request_settings),
) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise APIError(401, "unauthorized", "Authentication is required.")
    try:
        return decode_token(settings, authorization.split(" ", 1)[1].strip())
    except PermissionError as exc:
        raise APIError(401, "unauthorized", "Authentication is required.") from exc


@router.get("/health")
def health(settings: Settings = Depends(get_request_settings)) -> dict:
    return {"status": "ok", "service": "soccer-prediction-lab", "environment": settings.environment}


@router.get("/ready")
def ready(session: Session = Depends(get_db)) -> dict:
    try:
        session.execute(text("SELECT 1"))
    except Exception as exc:
        raise APIError(503, "not_ready", "Database is not reachable.") from exc
    return {"status": "ready", "database": "ok"}


@router.post("/api/v1/auth/login")
def login(
    body: LoginRequest,
    request: Request,
    settings: Settings = Depends(get_request_settings),
) -> dict:
    allowed, retry_after = limiter.allow(f"login:{request.client.host if request.client else 'local'}", 8, 60)
    if not allowed:
        raise APIError(429, "rate_limited", f"Too many login attempts. Retry in {int(retry_after) + 1} seconds.")
    username_ok = secrets_match(body.username, settings.dashboard_username)
    password_ok = secrets_match(body.password, settings.dashboard_password)
    if not (username_ok and password_ok):
        raise APIError(401, "invalid_credentials", "Invalid username or password.")
    token = create_token(settings, settings.dashboard_username)
    return {"access_token": token, "token_type": "bearer", "expires_in": settings.session_hours * 3600}


@router.get("/api/v1/overview")
def get_overview(
    scope_date: date | None = None,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    seed_reference(session, settings)
    session.commit()
    return overview(session, settings, scope_date or utcnow().date())


@router.get("/api/v1/coverage")
def get_coverage(
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    seed_reference(session, settings)
    session.commit()
    return coverage(session, settings)


@router.get("/api/v1/fixtures")
def list_fixtures(
    scope_date: date,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    payload = overview(session, settings, scope_date)
    return {"scope_date": scope_date.isoformat(), "fixtures": payload["fixtures"]}


@router.get("/api/v1/fixtures/{fixture_id}")
def get_fixture(
    fixture_id: int,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
) -> dict:
    payload = fixture_detail(session, fixture_id)
    if payload is None:
        raise APIError(404, "not_found", "Fixture not found.")
    return payload


@router.get("/api/v1/markets")
def list_markets(_user: str = Depends(require_user), session: Session = Depends(get_db), settings: Settings = Depends(get_request_settings)) -> dict:
    seed_reference(session, settings)
    session.commit()
    return coverage(session, settings)


@router.get("/api/v1/odds")
def list_odds(
    scope_date: date | None = None,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
) -> dict:
    filters = {"date": scope_date.isoformat()} if scope_date else {}
    rows = [row for row in explorer(session, filters) if row["decimal_odds"] is not None]
    return {"odds": rows}


@router.get("/api/v1/explorer")
def get_explorer(
    scope_date: date | None = None,
    league_id: int | None = None,
    fixture_id: int | None = None,
    market_key: str | None = None,
    family: str | None = None,
    bookmaker: str | None = None,
    status: str | None = None,
    min_probability: float | None = None,
    min_odds: float | None = None,
    max_odds: float | None = None,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
) -> dict:
    return {
        "rows": explorer(
            session,
            {
                "date": None if scope_date is None else scope_date.isoformat(),
                "league_id": league_id,
                "fixture_id": fixture_id,
                "market_key": market_key,
                "family": family,
                "bookmaker": bookmaker,
                "status": status,
                "min_probability": min_probability,
                "min_odds": min_odds,
                "max_odds": max_odds,
            },
        )
    }


@router.post("/api/v1/ingestion/refresh")
def refresh(
    body: RefreshRequest,
    request: Request,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    allowed, retry_after = limiter.allow("refresh", 6, 3600)
    if not allowed:
        raise APIError(429, "rate_limited", f"Refresh is limited. Retry in {int(retry_after) + 1} seconds.")
    seed_reference(session, settings)
    session.commit()
    runs = refresh_providers(
        session,
        settings,
        date_from=body.date_from.isoformat(),
        date_to=body.date_to.isoformat(),
        season=body.season,
        force=body.force,
    )
    failed = [run for run in runs if run.status == "failed"]
    return {
        "request_id": getattr(request.state, "request_id", None),
        "runs": ingestion_log(session)[: len(runs)],
        "failed": len(failed) > 0,
    }


@router.get("/api/v1/ingestion/runs")
def get_ingestion(_user: str = Depends(require_user), session: Session = Depends(get_db)) -> dict:
    return {"runs": ingestion_log(session)}


@router.post("/api/v1/prediction-runs")
def create_run(
    body: PredictionCreate,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    if not idempotency_key or len(idempotency_key) < 8 or len(idempotency_key) > 80:
        raise APIError(422, "invalid_idempotency_key", "Idempotency-Key must be between 8 and 80 characters.")
    allowed, retry_after = limiter.allow("predict", 12, 3600)
    if not allowed:
        raise APIError(429, "rate_limited", f"Prediction generation is limited. Retry in {int(retry_after) + 1} seconds.")
    try:
        batch, created = create_prediction_run(
            session,
            settings,
            scope_date=body.scope_date,
            league_id=body.league_id,
            idempotency_key=idempotency_key,
            refresh=body.refresh,
            time_budget_seconds=body.time_budget_seconds,
        )
    except PredictionRequestError as exc:
        raise APIError(exc.status_code, exc.code, exc.message) from exc
    payload = batch_summary(batch)
    payload["created"] = created
    payload["request_id"] = getattr(request.state, "request_id", None)
    if batch.status == "failed":
        status_codes = {"time_budget_exceeded": 504, "ingestion_failed": 502, "prediction_failed": 500}
        raise APIError(
            status_codes.get(batch.error_code or "", 500),
            batch.error_code or "failed",
            batch.error_message or "Prediction run failed.",
        )
    return payload


@router.get("/api/v1/prediction-runs/{public_id}")
def get_run(public_id: str, _user: str = Depends(require_user), session: Session = Depends(get_db)) -> dict:
    from app.models import PredictionBatch

    batch = session.scalar(select(PredictionBatch).where(PredictionBatch.public_id == public_id))
    if batch is None:
        raise APIError(404, "not_found", "Prediction run not found.")
    payload = batch_summary(batch)
    payload["terminal"] = batch.status in TERMINAL
    payload["slips"] = [
        slip_payload(session, slip)
        for slip in session.scalars(select(Slip).where(Slip.batch_id == batch.id)).all()
    ]
    return payload


@router.get("/api/v1/prediction-runs")
def list_runs(_user: str = Depends(require_user), session: Session = Depends(get_db)) -> dict:
    from app.models import PredictionBatch

    rows = session.scalars(select(PredictionBatch).order_by(PredictionBatch.started_at.desc()).limit(30)).all()
    return {"runs": [batch_summary(row) for row in rows]}


@router.get("/api/v1/slips")
def list_slips(_user: str = Depends(require_user), session: Session = Depends(get_db)) -> dict:
    rows = session.scalars(select(Slip).order_by(Slip.id.desc()).limit(30)).all()
    return {"slips": [slip_payload(session, row) for row in rows]}


@router.post("/api/v1/slips/{public_id}/decision")
def decide_slip(
    public_id: str,
    body: DecisionRequest,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
) -> dict:
    slip = session.scalar(select(Slip).where(Slip.public_id == public_id))
    if slip is None:
        raise APIError(404, "not_found", "Slip not found.")
    if body.action == "approve" and slip.preparation_status not in {"ready_for_review", "manually_prepared"}:
        raise APIError(
            409,
            "not_approvable",
            "Only a reviewed mapping with a current price, or a manually prepared slip, can be approved.",
        )
    slip.review_status = "approved" if body.action == "approve" else "rejected"
    slip.review_note = body.note
    slip.reviewed_at = utcnow()
    session.commit()
    return slip_payload(session, slip)


@router.post("/api/v1/slips/{public_id}/booking-code")
def save_booking_code(
    public_id: str,
    body: BookingCodeRequest,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
) -> dict:
    slip = session.scalar(select(Slip).where(Slip.public_id == public_id))
    if slip is None:
        raise APIError(404, "not_found", "Slip not found.")
    slip.booking_code = body.booking_code
    slip.booking_bookmaker = body.bookmaker_key
    session.commit()
    return slip_payload(session, slip)


@router.get("/api/v1/slips/{public_id}/export")
def export_slip(
    public_id: str,
    export_format: str = "json",
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
) -> dict:
    slip = session.scalar(select(Slip).where(Slip.public_id == public_id))
    if slip is None:
        raise APIError(404, "not_found", "Slip not found.")
    payload = slip_payload(session, slip)
    if export_format == "text":
        return {"format": "text", "body": slip_export_text(session, slip)}
    return {"format": "json", "body": payload}


@router.get("/api/v1/performance")
def get_performance(_user: str = Depends(require_user), session: Session = Depends(get_db)) -> dict:
    return performance(session)


@router.get("/api/v1/settings")
def get_settings_route(
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    seed_reference(session, settings)
    session.commit()
    return coverage(session, settings)


@router.put("/api/v1/settings")
def put_settings(
    body: SettingsUpdate,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    try:
        payload = update_settings(session, settings, body.changes)
    except ValueError as exc:
        raise APIError(422, "invalid_settings", str(exc)) from exc
    session.commit()
    return {"settings": payload}


@router.post("/api/v1/imports/fixtures")
async def import_fixtures(
    request: Request,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    raw = await request.body()
    try:
        return import_fixtures_csv(session, settings, raw)
    except ImportErrorSet as exc:
        raise APIError(422, "invalid_import", "; ".join(exc.errors)) from exc


@router.post("/api/v1/imports/odds")
async def import_odds(
    request: Request,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    raw = await request.body()
    try:
        return import_odds_csv(session, settings, raw)
    except ImportErrorSet as exc:
        raise APIError(422, "invalid_import", "; ".join(exc.errors)) from exc


@router.post("/api/v1/fixtures/{fixture_id}/result")
def post_result(
    fixture_id: int,
    body: ResultRequest,
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return record_result(session, fixture_id, **body.model_dump())
    except ValueError as exc:
        raise APIError(404, "not_found", str(exc)) from exc


@router.post("/api/v1/demo/seed")
def post_demo(
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    if settings.environment == "production":
        raise APIError(403, "forbidden", "Synthetic demo data cannot be seeded in production.")
    return seed_demo(session, settings)


@router.post("/api/v1/evaluation")
def run_evaluation(
    _user: str = Depends(require_user),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_request_settings),
) -> dict:
    from app.engine.evaluate import walk_forward_evaluate
    from app.engine.strengths import HistoricalMatch
    from app.markets.registry import MODEL_VERSION_KEY
    from app.models import EvaluationRun, Fixture, ModelVersion

    rows = session.scalars(select(Fixture).where(Fixture.status == "completed")).all()
    matches = []
    for fixture in rows:
        if fixture.home_goals is None or fixture.away_goals is None:
            continue
        if fixture.data_origin == "synthetic_demo":
            continue
        matches.append(
            HistoricalMatch(
                match_id=str(fixture.id),
                league_id=str(fixture.league_id),
                kickoff=fixture.kickoff_at,
                home_id=str(fixture.home_team_id),
                away_id=str(fixture.away_team_id),
                home_goals=fixture.home_goals,
                away_goals=fixture.away_goals,
            )
        )
    metrics = walk_forward_evaluate(matches)
    model = session.scalar(select(ModelVersion).where(ModelVersion.version_key == MODEL_VERSION_KEY))
    run = EvaluationRun(
        model_version_id=None if model is None else model.id,
        status=metrics["status"],
        metrics=metrics,
        sample_sizes={"observations": metrics.get("observations", 0)},
        notes="Final holdout metrics are descriptive. They were not used to choose slip thresholds.",
        started_at=utcnow(),
        finished_at=utcnow(),
    )
    session.add(run)
    session.commit()
    return {"evaluation": metrics}
