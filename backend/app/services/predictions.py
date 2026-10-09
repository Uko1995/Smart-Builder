"""Manual prediction runs. Status is persisted before the response is returned."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import numpy as np
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.engine.markets import (
    CARD_LINES,
    CORNER_LINES,
    TEAM_CORNER_LINES,
    derive_goal_markets,
    derive_total_markets,
    fair_odds,
)
from app.engine.scoreline import MAX_CORNERS, scoreline_matrix
from app.engine.strengths import HistoricalMatch, estimate_count_rates, estimate_goal_rates
from app.markets.registry import MARKET_BY_KEY, MODEL_VERSION_KEY
from app.models import (
    FeatureSnapshot,
    Fixture,
    League,
    MatchStatistics,
    ModelVersion,
    OddsSnapshot,
    Prediction,
    PredictionBatch,
    Slip,
    SlipSelection,
    Team,
)
from app.optimizer.slips import (
    STRATEGIES,
    CandidateSelection,
    OptimizerConfig,
    build_slips,
)
from app.services.ingestion import refresh_providers
from app.services.reference import effective_settings, seed_reference
from app.services.timeutil import utcnow

TERMINAL = {
    "succeeded",
    "succeeded_with_warnings",
    "failed",
    "insufficient_data",
    "no_qualifying_slips",
}


class PredictionRequestError(Exception):
    def __init__(self, status_code: int, code: str, message: str, batch: PredictionBatch | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.batch = batch


def create_prediction_run(
    session: Session,
    settings: Settings,
    *,
    scope_date: date,
    league_id: int | None,
    idempotency_key: str,
    refresh: bool,
    time_budget_seconds: int | None = None,
    now: datetime | None = None,
) -> tuple[PredictionBatch, bool]:
    seed_reference(session, settings)
    moment = now or utcnow()
    config = effective_settings(session, settings)
    payload = {
        "scope_date": scope_date.isoformat(),
        "league_id": league_id,
        "refresh": refresh,
    }
    existing = session.scalar(
        select(PredictionBatch).where(PredictionBatch.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if existing.request_payload != payload:
            raise PredictionRequestError(
                409,
                "idempotency_conflict",
                "This idempotency key was already used for a different request.",
                existing,
            )
        return existing, False

    _expire_stale_runs(session, moment)
    running = session.scalar(
        select(PredictionBatch).where(
            PredictionBatch.scope_date == scope_date,
            PredictionBatch.status == "running",
        )
    )
    if running is not None:
        raise PredictionRequestError(
            409,
            "run_in_progress",
            "A prediction run for this date is already in progress.",
            running,
        )

    budget = int(time_budget_seconds or config["prediction_time_budget_seconds"])
    budget = max(5, min(budget, settings.prediction_time_budget_cap_seconds))
    batch = PredictionBatch(
        public_id=str(uuid4()),
        scope_date=scope_date,
        league_id=league_id,
        status="running",
        idempotency_key=idempotency_key,
        request_payload=payload,
        warnings=[],
        diagnostics={},
        time_budget_seconds=budget,
        source_data_cutoff=moment,
        started_at=moment,
    )
    session.add(batch)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.scalar(
            select(PredictionBatch).where(PredictionBatch.idempotency_key == idempotency_key)
        )
        if existing is None:
            raise
        return existing, False

    started = time.monotonic()
    try:
        if refresh:
            date_from = (scope_date - timedelta(days=120)).isoformat()
            runs = refresh_providers(
                session,
                settings,
                date_from=date_from,
                date_to=scope_date.isoformat(),
                force=False,
            )
            failed = [run for run in runs if run.status == "failed"]
            if failed:
                _finish(
                    session,
                    batch,
                    "failed",
                    error_code="ingestion_failed",
                    error_message="A data refresh failed, so no prediction batch was produced.",
                    diagnostics={"ingestion_run_ids": [run.id for run in runs]},
                )
                raise PredictionRequestError(
                    502,
                    "ingestion_failed",
                    "A data refresh failed, so no prediction batch was produced.",
                    batch,
                )
        _generate(session, settings, batch, config, moment, started)
        session.commit()
        session.refresh(batch)
        return batch, True
    except PredictionRequestError:
        raise
    except Exception as exc:
        session.rollback()
        _finish(
            session,
            batch,
            "failed",
            error_code="prediction_failed",
            error_message="Prediction generation failed before a result could be stored.",
        )
        raise PredictionRequestError(
            500,
            "prediction_failed",
            "Prediction generation failed before a result could be stored.",
            batch,
        ) from exc


def _expire_stale_runs(session: Session, moment: datetime) -> None:
    running = session.scalars(select(PredictionBatch).where(PredictionBatch.status == "running")).all()
    for batch in running:
        deadline = batch.started_at + timedelta(seconds=batch.time_budget_seconds + 30)
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=UTC)
        if moment > deadline:
            batch.status = "failed"
            batch.error_code = "interrupted"
            batch.error_message = (
                "The run did not finish within its time budget and was marked failed so it can be retried."
            )
            batch.finished_at = moment
    session.flush()


def _finish(session, batch, status, error_code=None, error_message=None, warnings=None, diagnostics=None):
    persisted = session.get(PredictionBatch, batch.id)
    if persisted is None:
        return
    persisted.status = status
    persisted.error_code = error_code
    persisted.error_message = error_message
    if warnings is not None:
        persisted.warnings = warnings
    if diagnostics is not None:
        persisted.diagnostics = diagnostics
    persisted.finished_at = utcnow()
    session.commit()


def _generate(session, settings: Settings, batch: PredictionBatch, config: dict, moment: datetime, started: float) -> None:
    allow_synthetic = bool(config.get("allow_synthetic", settings.allow_synthetic))
    start = datetime.combine(batch.scope_date, datetime.min.time(), tzinfo=UTC)
    end = start + timedelta(days=1)
    query = select(Fixture).where(Fixture.kickoff_at >= start, Fixture.kickoff_at < end, Fixture.status == "scheduled")
    if batch.league_id is not None:
        query = query.where(Fixture.league_id == batch.league_id)
    fixtures = session.scalars(query).all()
    if not allow_synthetic:
        fixtures = [fixture for fixture in fixtures if fixture.data_origin != "synthetic_demo"]
    warnings: list[str] = []
    if not fixtures:
        _finish(
            session,
            batch,
            "insufficient_data",
            warnings=["No scheduled fixtures are stored for this date."],
            diagnostics={"fixtures": 0},
        )
        return

    model = session.scalar(select(ModelVersion).where(ModelVersion.version_key == MODEL_VERSION_KEY))
    if model is None:
        raise RuntimeError("model version is not seeded")
    batch.model_version_id = model.id
    history = _load_history(session, allow_synthetic)
    min_matches = int(config["min_team_matches"])
    rho_min = int(config["rho_min_matches"])
    predictions: list[Prediction] = []
    matrices: dict[str, np.ndarray] = {}
    synthetic_used = False

    for fixture in fixtures:
        if time.monotonic() - started > batch.time_budget_seconds:
            session.rollback()
            _finish(
                session,
                batch,
                "failed",
                error_code="time_budget_exceeded",
                error_message="The run exceeded its time budget. Use the local runner for a larger sample.",
                warnings=warnings,
            )
            raise PredictionRequestError(
                504,
                "time_budget_exceeded",
                "The run exceeded its time budget. Use the local runner for a larger sample.",
                batch,
            )
        if fixture.data_origin == "synthetic_demo":
            synthetic_used = True
        league_history = [match for match in history if match.league_id == str(fixture.league_id)]
        home = session.get(Team, fixture.home_team_id)
        away = session.get(Team, fixture.away_team_id)
        estimate = estimate_goal_rates(
            league_history,
            str(fixture.home_team_id),
            str(fixture.away_team_id),
            fixture.kickoff_at,
            min_matches,
            rho_min,
        )
        if estimate is None or home is None or away is None:
            warnings.append(
                f"{_names(session, fixture)} was skipped: fewer than {min_matches} completed matches for one or both teams."
            )
            continue
        matrix = scoreline_matrix(estimate.lambda_home, estimate.lambda_away, estimate.rho)
        matrices[str(fixture.id)] = matrix
        snapshot = FeatureSnapshot(
            model_version_id=model.id,
            fixture_id=fixture.id,
            training_cutoff=fixture.kickoff_at,
            payload={
                "lambda_home": estimate.lambda_home,
                "lambda_away": estimate.lambda_away,
                "rho": estimate.rho,
                "rho_source": estimate.rho_source,
                "home_matches": estimate.home_matches,
                "away_matches": estimate.away_matches,
                "league_matches": estimate.league_matches,
                "quality": estimate.quality,
                "clamped": estimate.clamped,
                "scoreline": matrix.round(8).tolist(),
                "data_origin": fixture.data_origin,
            },
        )
        session.add(snapshot)
        session.flush()
        quality = Decimal(f"{estimate.quality:.4f}")
        for item in derive_goal_markets(matrix):
            status = MARKET_BY_KEY[item["market_key"]].implementation_status
            predictions.append(
                _prediction(batch, fixture, model, snapshot, item, quality, estimate.league_matches, status)
            )
        missing = _maybe_side_markets(
            session,
            batch,
            fixture,
            model,
            snapshot,
            league_history,
            min_matches,
            quality,
            estimate.league_matches,
            predictions,
        )
        for kind in missing:
            label = {"corners": "Corner", "cards": "Card", "first_half": "First-half"}[kind]
            message = f"{label} markets are unavailable for {_names(session, fixture)} because the required history is incomplete."
            warnings.append(message)

    if synthetic_used:
        warnings.append("This run includes synthetic demonstration fixtures. They are not real results or prices.")
    if not predictions:
        _finish(
            session,
            batch,
            "insufficient_data",
            warnings=warnings or ["Historical samples were too small to estimate a scoreline."],
            diagnostics={"fixtures": len(fixtures), "predictions": 0},
        )
        return

    session.add_all(predictions)
    session.flush()
    odds_index = _latest_odds(session, [fixture.id for fixture in fixtures])
    candidates, linked = _candidates(session, predictions, odds_index, matrices)
    for prediction, snapshot_id in linked:
        prediction.odds_snapshot_id = snapshot_id

    optimizer_config = OptimizerConfig(
        now=moment,
        freshness=timedelta(minutes=int(config["odds_freshness_minutes"])),
        odds_min=Decimal(str(config["target_odds_min"])),
        odds_max=Decimal(str(config["target_odds_max"])),
        min_quality=Decimal(str(config["min_data_quality"])),
        max_legs=int(config["max_slip_legs"]),
        beam_width=int(config["beam_width"]),
        strategy_min_probability={
            "probability_led": Decimal(str(config["min_probability_a"])),
            "balanced_value": Decimal(str(config["min_probability_b"])),
            "higher_odds": Decimal(str(config["min_probability_c"])),
        },
    )
    result = build_slips(candidates, matrices, optimizer_config)
    slips = []
    prediction_by_key = {_prediction_key(prediction): prediction for prediction in predictions}
    for built in result.slips:
        preparation = _preparation(built.selections)
        slip = Slip(
            public_id=str(uuid4()),
            batch_id=batch.id,
            strategy=built.strategy,
            label=built.label,
            combined_odds=built.combined_odds,
            selection_count=len(built.selections),
            joint_probability=built.joint_probability,
            joint_probability_method=built.joint_method,
            expected_value=built.expected_value,
            ev_status="estimated",
            preparation_status=preparation,
            warnings=built.warnings,
            diagnostics=built.diagnostics,
        )
        session.add(slip)
        session.flush()
        for position, selection in enumerate(built.selections, start=1):
            prediction = prediction_by_key[selection.selection_id]
            if prediction.odds_snapshot_id is None:
                raise RuntimeError("slip selection is missing its odds snapshot")
            session.add(
                SlipSelection(
                    slip_id=slip.id,
                    prediction_id=prediction.id,
                    odds_snapshot_id=prediction.odds_snapshot_id,
                    decimal_odds=selection.decimal_odds,
                    rationale=_rationale(built.label, selection),
                    position=position,
                )
            )
        slips.append(slip)
    if warnings and slips:
        status = "succeeded_with_warnings"
    elif slips:
        status = "succeeded"
    elif warnings:
        status = "no_qualifying_slips"
    else:
        status = "no_qualifying_slips"
    batch.status = status
    batch.warnings = warnings
    batch.diagnostics = result.diagnostics
    batch.finished_at = utcnow()
    session.flush()


def _prediction(batch, fixture, model, snapshot, item, quality, sample_size, status) -> Prediction:
    return Prediction(
        batch_id=batch.id,
        fixture_id=fixture.id,
        market_key=item["market_key"],
        selection=item["selection"],
        line=item["line"],
        probability=item["probability"],
        fair_odds=item["fair_odds"] if item["fair_odds"] is not None else fair_odds(item["probability"]),
        model_version_id=model.id,
        feature_snapshot_id=snapshot.id,
        data_quality=quality,
        sample_size=sample_size,
        implementation_status=status,
        details=_jsonable(item.get("details") or {}),
    )


def _maybe_side_markets(session, batch, fixture, model, snapshot, history, min_matches, quality, sample_size, predictions) -> list[str]:
    missing: list[str] = []
    corner_rates = estimate_count_rates(
        history, str(fixture.home_team_id), str(fixture.away_team_id), fixture.kickoff_at, min_matches, "corners"
    )
    if corner_rates is None:
        missing.append("corners")
    else:
        matrix = scoreline_matrix(corner_rates.lambda_home, corner_rates.lambda_away, 0.0, MAX_CORNERS)
        for item in derive_total_markets(
            matrix,
            "match_corners",
            CORNER_LINES,
            "team_corners_home",
            "team_corners_away",
            TEAM_CORNER_LINES,
            TEAM_CORNER_LINES,
        ):
            status = MARKET_BY_KEY[item["market_key"]].implementation_status
            # Data is present, so the registry default of insufficient_data is raised to supported.
            predictions.append(
                _prediction(batch, fixture, model, snapshot, item, quality, corner_rates.league_matches, "supported" if status == "insufficient_data" else status)
            )
    card_rates = estimate_count_rates(
        history, str(fixture.home_team_id), str(fixture.away_team_id), fixture.kickoff_at, min_matches, "cards"
    )
    if card_rates is None:
        missing.append("cards")
    else:
        matrix = scoreline_matrix(card_rates.lambda_home, card_rates.lambda_away, 0.0, 12)
        for item in derive_total_markets(matrix, "match_cards", CARD_LINES, "team_cards_home", "team_cards_away", CARD_LINES, CARD_LINES):
            predictions.append(
                _prediction(batch, fixture, model, snapshot, item, quality, card_rates.league_matches, "supported")
            )
    half_rates = estimate_count_rates(
        history, str(fixture.home_team_id), str(fixture.away_team_id), fixture.kickoff_at, min_matches, "first_half"
    )
    if half_rates is None:
        missing.append("first_half")
    else:
        matrix = scoreline_matrix(half_rates.lambda_home, half_rates.lambda_away, 0.0)
        from app.engine.markets import _entry, _partition, _sum_where

        entries = _partition(
            [
                _entry("first_half_result", "home", None, _sum_where(matrix, lambda h, a: h > a)),
                _entry("first_half_result", "draw", None, _sum_where(matrix, lambda h, a: h == a)),
                _entry("first_half_result", "away", None, _sum_where(matrix, lambda h, a: h < a)),
            ]
        )
        for line in (Decimal("0.5"), Decimal("1.5"), Decimal("2.5")):
            entries.extend(
                _partition(
                    [
                        _entry("first_half_over_under", "over", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h + a) > line)),
                        _entry("first_half_over_under", "under", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h + a) < line)),
                    ]
                )
            )
        for item in entries:
            predictions.append(
                _prediction(batch, fixture, model, snapshot, item, quality, half_rates.league_matches, "supported")
            )
    return missing


def _load_history(session: Session, allow_synthetic: bool) -> list[HistoricalMatch]:
    rows = session.scalars(select(Fixture).where(Fixture.status == "completed")).all()
    history = []
    for fixture in rows:
        if fixture.home_goals is None or fixture.away_goals is None:
            continue
        if fixture.data_origin == "synthetic_demo" and not allow_synthetic:
            continue
        stats = session.scalar(select(MatchStatistics).where(MatchStatistics.fixture_id == fixture.id))
        history.append(
            HistoricalMatch(
                match_id=str(fixture.id),
                league_id=str(fixture.league_id),
                kickoff=fixture.kickoff_at,
                home_id=str(fixture.home_team_id),
                away_id=str(fixture.away_team_id),
                home_goals=fixture.home_goals,
                away_goals=fixture.away_goals,
                ht_home_goals=fixture.ht_home_goals,
                ht_away_goals=fixture.ht_away_goals,
                home_corners=None if stats is None else stats.home_corners,
                away_corners=None if stats is None else stats.away_corners,
                home_cards=None if stats is None else stats.home_cards,
                away_cards=None if stats is None else stats.away_cards,
            )
        )
    return history


def _latest_odds(session: Session, fixture_ids: list[int]) -> dict[tuple, OddsSnapshot]:
    if not fixture_ids:
        return {}
    rows = session.scalars(select(OddsSnapshot).where(OddsSnapshot.fixture_id.in_(fixture_ids))).all()
    grouped: dict[tuple, OddsSnapshot] = {}
    for row in rows:
        # Do not replace a fresher price with a different bookmaker.
        key = (row.fixture_id, row.market_key, row.selection, _normalize_line(row.line))
        current = grouped.get(key)
        if current is None or row.captured_at > current.captured_at:
            grouped[key] = row
    return grouped


def _candidates(session, predictions: list[Prediction], odds_index, matrices):
    candidates = []
    linked = []
    for prediction in predictions:
        if prediction.implementation_status != "supported":
            continue
        key = (
            prediction.fixture_id,
            prediction.market_key,
            prediction.selection,
            _normalize_line(prediction.line),
        )
        snapshot = odds_index.get(key)
        if snapshot is None:
            continue
        linked.append((prediction, snapshot.id))
        market = MARKET_BY_KEY.get(prediction.market_key)
        bookmaker_key, _origin = _bookmaker_meta(session, snapshot.bookmaker_id)
        candidates.append(
            CandidateSelection(
                selection_id=_prediction_key(prediction),
                fixture_id=str(prediction.fixture_id),
                market_key=prediction.market_key,
                selection=prediction.selection,
                line=prediction.line,
                decimal_odds=snapshot.decimal_odds,
                probability=prediction.probability,
                data_quality=prediction.data_quality,
                captured_at=snapshot.captured_at,
                mapping_status=snapshot.mapping_status,
                implementation_status=prediction.implementation_status,
                market_family=market.family if market else "unknown",
                bookmaker_key=bookmaker_key,
                data_origin=snapshot.data_origin,
            )
        )
    return candidates, linked


def _normalize_line(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(value).quantize(Decimal("0.01"))


def _prediction_key(prediction: Prediction) -> str:
    line = "" if prediction.line is None else format(prediction.line, "f")
    return f"{prediction.fixture_id}|{prediction.market_key}|{prediction.selection}|{line}"


def _bookmaker_meta(session: Session, bookmaker_id: int) -> tuple[str, str]:
    from app.models import Bookmaker

    bookmaker = session.get(Bookmaker, bookmaker_id)
    if bookmaker is None:
        return "unknown", "provider"
    origin = "synthetic_demo" if bookmaker.is_synthetic else "provider"
    return bookmaker.key, origin


def _preparation(selections: list[CandidateSelection]) -> str:
    if any(selection.data_origin == "synthetic_demo" or selection.bookmaker_key == "demo_book" for selection in selections):
        return "synthetic_demo"
    if any(selection.mapping_status == "manual" for selection in selections):
        return "manually_prepared"
    if all(selection.mapping_status == "verified" for selection in selections):
        return "ready_for_review"
    return "mapping_required"


def _rationale(label: str, selection: CandidateSelection) -> str:
    percent = (selection.probability * Decimal(100)).quantize(Decimal("0.1"))
    return (
        f"Included by the {label} strategy: model probability {percent}%, "
        f"captured decimal odds {selection.decimal_odds}, sample support {selection.data_quality}."
    )


def _names(session: Session, fixture: Fixture) -> str:
    home = session.get(Team, fixture.home_team_id)
    away = session.get(Team, fixture.away_team_id)
    league = session.get(League, fixture.league_id)
    home_name = home.name if home else "Home"
    away_name = away.name if away else "Away"
    league_name = league.name if league else "League"
    return f"{home_name} vs {away_name} ({league_name})"


def _jsonable(details: dict) -> dict:
    converted = {}
    for key, value in details.items():
        if isinstance(value, Decimal):
            converted[key] = format(value, "f")
        else:
            converted[key] = value
    return converted


def unused_strategies() -> tuple[str, ...]:
    return STRATEGIES
