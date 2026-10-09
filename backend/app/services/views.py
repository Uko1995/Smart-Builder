"""Read models for the dashboard. Empty results stay empty."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.engine.evaluate import simulate_unit_returns
from app.markets.registry import MARKET_BY_KEY, MARKETS
from app.models import (
    Bookmaker,
    BookmakerMarketMapping,
    EvaluationRun,
    Fixture,
    IngestionRun,
    League,
    MarketDefinition,
    MatchStatistics,
    ModelVersion,
    OddsSnapshot,
    Prediction,
    PredictionBatch,
    Provider,
    Slip,
    SlipSelection,
    Team,
)
from app.services.reference import effective_settings, market_catalog


def _dec(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat()


def overview(session: Session, settings: Settings, scope: date) -> dict:
    start = datetime.combine(scope, datetime.min.time(), tzinfo=UTC)
    end = start + timedelta(days=1)
    fixtures = session.scalars(
        select(Fixture).where(Fixture.kickoff_at >= start, Fixture.kickoff_at < end).order_by(Fixture.kickoff_at)
    ).all()
    latest_odds = session.scalar(select(func.max(OddsSnapshot.captured_at)))
    latest_run = session.scalar(select(PredictionBatch).order_by(PredictionBatch.started_at.desc()))
    slips = []
    if latest_run is not None:
        slips = [
            slip_payload(session, slip)
            for slip in session.scalars(select(Slip).where(Slip.batch_id == latest_run.id)).all()
        ]
    settled = session.scalar(select(func.count()).select_from(Prediction).where(Prediction.outcome.is_not(None))) or 0
    return {
        "timezone": "UTC",
        "scope_date": scope.isoformat(),
        "generated_at": datetime.now(UTC).isoformat(),
        "providers": provider_rows(session),
        "fixture_counts": {
            "scheduled": sum(1 for fixture in fixtures if fixture.status == "scheduled"),
            "completed": sum(1 for fixture in fixtures if fixture.status == "completed"),
            "synthetic": sum(1 for fixture in fixtures if fixture.data_origin == "synthetic_demo"),
        },
        "fixtures": [fixture_summary(session, fixture) for fixture in fixtures],
        "latest_odds_captured_at": _iso(latest_odds),
        "latest_run": None if latest_run is None else batch_summary(latest_run),
        "slips": slips,
        "warnings": [] if latest_run is None else latest_run.warnings,
        "recent_performance": {
            "settled_predictions": int(settled),
            "note": "No return is shown until priced settlements exist. Sample size is reported with every metric.",
        },
        "settings": {
            "allow_synthetic": effective_settings(session, settings)["allow_synthetic"],
            "odds_freshness_minutes": effective_settings(session, settings)["odds_freshness_minutes"],
        },
    }


def provider_rows(session: Session) -> list[dict]:
    rows = []
    for provider in session.scalars(select(Provider).order_by(Provider.key)).all():
        rows.append(
            {
                "key": provider.key,
                "name": provider.name,
                "kind": provider.kind,
                "configured": provider.configured,
                "health_status": provider.health_status,
                "last_checked_at": _iso(provider.last_checked_at),
                "last_error": provider.last_error,
                "quota_remaining": provider.quota_remaining,
            }
        )
    return rows


def fixture_summary(session: Session, fixture: Fixture) -> dict:
    home = session.get(Team, fixture.home_team_id)
    away = session.get(Team, fixture.away_team_id)
    league = session.get(League, fixture.league_id)
    return {
        "id": fixture.id,
        "kickoff_at": _iso(fixture.kickoff_at),
        "status": fixture.status,
        "league": None if league is None else league.name,
        "home": None if home is None else home.name,
        "away": None if away is None else away.name,
        "home_goals": fixture.home_goals,
        "away_goals": fixture.away_goals,
        "data_origin": fixture.data_origin,
    }


def batch_summary(batch: PredictionBatch) -> dict:
    return {
        "public_id": batch.public_id,
        "scope_date": batch.scope_date.isoformat(),
        "status": batch.status,
        "warnings": batch.warnings,
        "diagnostics": batch.diagnostics,
        "error_code": batch.error_code,
        "error_message": batch.error_message,
        "started_at": _iso(batch.started_at),
        "finished_at": _iso(batch.finished_at),
        "source_data_cutoff": _iso(batch.source_data_cutoff),
        "time_budget_seconds": batch.time_budget_seconds,
    }


def slip_payload(session: Session, slip: Slip) -> dict:
    selections = []
    changed = False
    for row in session.scalars(select(SlipSelection).where(SlipSelection.slip_id == slip.id).order_by(SlipSelection.position)).all():
        prediction = session.get(Prediction, row.prediction_id)
        snapshot = session.get(OddsSnapshot, row.odds_snapshot_id)
        fixture = session.get(Fixture, prediction.fixture_id) if prediction else None
        bookmaker = session.get(Bookmaker, snapshot.bookmaker_id) if snapshot else None
        latest = _latest_for_selection(session, snapshot) if snapshot else None
        odds_changed = latest is not None and latest.decimal_odds != row.decimal_odds
        changed = changed or odds_changed
        home = session.get(Team, fixture.home_team_id) if fixture else None
        away = session.get(Team, fixture.away_team_id) if fixture else None
        market = MARKET_BY_KEY.get(prediction.market_key) if prediction else None
        selections.append(
            {
                "position": row.position,
                "fixture_id": None if fixture is None else fixture.id,
                "match": None if home is None or away is None else f"{home.name} vs {away.name}",
                "kickoff_at": None if fixture is None else _iso(fixture.kickoff_at),
                "market_key": None if prediction is None else prediction.market_key,
                "market_name": None if market is None else market.display_name,
                "selection": None if prediction is None else prediction.selection,
                "line": None if prediction is None else _dec(prediction.line),
                "probability": None if prediction is None else _dec(prediction.probability),
                "fair_odds": None if prediction is None else _dec(prediction.fair_odds),
                "decimal_odds": _dec(row.decimal_odds),
                "captured_at": None if snapshot is None else _iso(snapshot.captured_at),
                "bookmaker_key": None if bookmaker is None else bookmaker.key,
                "bookmaker_name": None if bookmaker is None else bookmaker.name,
                "mapping_status": None if snapshot is None else snapshot.mapping_status,
                "data_origin": None if snapshot is None else snapshot.data_origin,
                "rationale": row.rationale,
                "odds_changed": odds_changed,
                "latest_decimal_odds": None if latest is None else _dec(latest.decimal_odds),
            }
        )
    preparation = slip.preparation_status
    if changed and preparation == "ready_for_review":
        preparation = "odds_changed"
    return {
        "public_id": slip.public_id,
        "strategy": slip.strategy,
        "label": slip.label,
        "combined_odds": _dec(slip.combined_odds),
        "selection_count": slip.selection_count,
        "joint_probability": _dec(slip.joint_probability),
        "joint_probability_method": slip.joint_probability_method,
        "expected_value": _dec(slip.expected_value),
        "ev_status": slip.ev_status,
        "preparation_status": preparation,
        "review_status": slip.review_status,
        "review_note": slip.review_note,
        "booking_code": slip.booking_code,
        "booking_bookmaker": slip.booking_bookmaker,
        "warnings": slip.warnings,
        "diagnostics": slip.diagnostics,
        "selections": selections,
        "disclaimer": "Verify every selection and price on the bookmaker. This application does not place bets.",
    }


def _latest_for_selection(session: Session, snapshot: OddsSnapshot) -> OddsSnapshot | None:
    rows = session.scalars(
        select(OddsSnapshot).where(
            OddsSnapshot.fixture_id == snapshot.fixture_id,
            OddsSnapshot.bookmaker_id == snapshot.bookmaker_id,
            OddsSnapshot.market_key == snapshot.market_key,
            OddsSnapshot.selection == snapshot.selection,
        )
    ).all()
    same_line = [row for row in rows if row.line == snapshot.line]
    if not same_line:
        return snapshot
    return max(same_line, key=lambda row: row.captured_at)


def fixture_detail(session: Session, fixture_id: int) -> dict | None:
    fixture = session.get(Fixture, fixture_id)
    if fixture is None:
        return None
    home = session.get(Team, fixture.home_team_id)
    away = session.get(Team, fixture.away_team_id)
    league = session.get(League, fixture.league_id)
    stats = session.scalar(select(MatchStatistics).where(MatchStatistics.fixture_id == fixture.id))
    completed = session.scalars(
        select(Fixture).where(
            Fixture.league_id == fixture.league_id,
            Fixture.status == "completed",
            Fixture.kickoff_at < fixture.kickoff_at,
        )
    ).all()
    latest_prediction = session.scalar(
        select(Prediction)
        .where(Prediction.fixture_id == fixture.id, Prediction.market_key == "match_result")
        .order_by(Prediction.id.desc())
    )
    predictions = []
    scoreline = None
    model_version = None
    if latest_prediction is not None:
        from app.models import FeatureSnapshot

        snapshot = session.get(FeatureSnapshot, latest_prediction.feature_snapshot_id)
        version = session.get(ModelVersion, latest_prediction.model_version_id)
        model_version = None if version is None else version.version_key
        scoreline = None if snapshot is None else snapshot.payload.get("scoreline")
        rows = session.scalars(select(Prediction).where(Prediction.feature_snapshot_id == latest_prediction.feature_snapshot_id)).all()
        predictions = [
            {
                "market_key": row.market_key,
                "selection": row.selection,
                "line": _dec(row.line),
                "probability": _dec(row.probability),
                "fair_odds": _dec(row.fair_odds),
                "implementation_status": row.implementation_status,
                "data_quality": _dec(row.data_quality),
                "sample_size": row.sample_size,
            }
            for row in rows
        ]
    return {
        "fixture": fixture_summary(session, fixture),
        "league_id": None if league is None else league.id,
        "measured": {
            "home_form": _form(completed, home.id if home else None),
            "away_form": _form(completed, away.id if away else None),
            "home_record": _split(completed, home.id if home else None, True),
            "away_record": _split(completed, away.id if away else None, False),
            "match_statistics": None
            if stats is None
            else {
                "home_corners": stats.home_corners,
                "away_corners": stats.away_corners,
                "home_cards": stats.home_cards,
                "away_cards": stats.away_cards,
                "home_xg": _dec(stats.home_xg),
                "away_xg": _dec(stats.away_xg),
                "source": stats.source,
            },
        },
        "model": {
            "available": bool(predictions),
            "model_version": model_version,
            "scoreline": scoreline,
            "predictions": predictions,
            "note": "Scoreline cells are model estimates. Form and goals tables are measured historical results.",
        },
        "unavailable_markets": [
            {
                "key": market.key,
                "display_name": market.display_name,
                "implementation_status": market.implementation_status,
                "required_data": market.required_data,
            }
            for market in MARKETS
            if market.implementation_status in {"insufficient_data", "unsupported", "experimental", "mapping_required"}
        ],
    }


def _form(completed: list[Fixture], team_id: int | None) -> list[str]:
    if team_id is None:
        return []
    played = [
        fixture
        for fixture in completed
        if fixture.home_team_id == team_id or fixture.away_team_id == team_id
    ]
    played.sort(key=lambda fixture: fixture.kickoff_at, reverse=True)
    letters = []
    for fixture in played[:5]:
        if fixture.home_goals is None or fixture.away_goals is None:
            continue
        if fixture.home_team_id == team_id:
            scored, conceded = fixture.home_goals, fixture.away_goals
        else:
            scored, conceded = fixture.away_goals, fixture.home_goals
        letters.append("W" if scored > conceded else "D" if scored == conceded else "L")
    return letters


def _split(completed: list[Fixture], team_id: int | None, at_home: bool) -> dict:
    if team_id is None:
        return {"matches": 0, "goals_for": 0, "goals_against": 0}
    rows = []
    for fixture in completed:
        if at_home and fixture.home_team_id == team_id and fixture.home_goals is not None:
            rows.append((fixture.home_goals, fixture.away_goals))
        if not at_home and fixture.away_team_id == team_id and fixture.away_goals is not None:
            rows.append((fixture.away_goals, fixture.home_goals))
    return {
        "matches": len(rows),
        "goals_for": sum(item[0] for item in rows),
        "goals_against": sum(item[1] or 0 for item in rows),
    }


def explorer(session: Session, filters: dict) -> list[dict]:
    query = select(Prediction).order_by(Prediction.id.desc()).limit(300)
    if filters.get("market_key"):
        query = query.where(Prediction.market_key == filters["market_key"])
    rows = session.scalars(query).all()
    payload = []
    for prediction in rows:
        fixture = session.get(Fixture, prediction.fixture_id)
        if fixture is None:
            continue
        if filters.get("date") and fixture.kickoff_at.date().isoformat() != filters["date"]:
            continue
        if filters.get("league_id") and fixture.league_id != filters["league_id"]:
            continue
        if filters.get("fixture_id") and fixture.id != filters["fixture_id"]:
            continue
        market = MARKET_BY_KEY.get(prediction.market_key)
        if filters.get("family") and (market is None or market.family != filters["family"]):
            continue
        if filters.get("status") and prediction.implementation_status != filters["status"]:
            continue
        snapshot = session.get(OddsSnapshot, prediction.odds_snapshot_id) if prediction.odds_snapshot_id else None
        bookmaker = session.get(Bookmaker, snapshot.bookmaker_id) if snapshot else None
        if filters.get("bookmaker") and (bookmaker is None or bookmaker.key != filters["bookmaker"]):
            continue
        probability = float(prediction.probability)
        if filters.get("min_probability") is not None and probability < filters["min_probability"]:
            continue
        if snapshot and filters.get("min_odds") is not None and float(snapshot.decimal_odds) < filters["min_odds"]:
            continue
        if snapshot and filters.get("max_odds") is not None and float(snapshot.decimal_odds) > filters["max_odds"]:
            continue
        version = session.get(ModelVersion, prediction.model_version_id)
        ev = None
        if snapshot is not None:
            ev = _dec((prediction.probability * snapshot.decimal_odds) - Decimal("1"))
        payload.append(
            {
                **fixture_summary(session, fixture),
                "fixture_id": fixture.id,
                "market_key": prediction.market_key,
                "market_name": None if market is None else market.display_name,
                "family": None if market is None else market.family,
                "selection": prediction.selection,
                "line": _dec(prediction.line),
                "probability": _dec(prediction.probability),
                "fair_odds": _dec(prediction.fair_odds),
                "decimal_odds": None if snapshot is None else _dec(snapshot.decimal_odds),
                "captured_at": None if snapshot is None else _iso(snapshot.captured_at),
                "bookmaker": None if bookmaker is None else bookmaker.name,
                "data_origin": fixture.data_origin if snapshot is None else snapshot.data_origin,
                "implementation_status": prediction.implementation_status,
                "data_quality": _dec(prediction.data_quality),
                "model_version": None if version is None else version.version_key,
                "estimated_value": ev,
            }
        )
    return payload


def performance(session: Session) -> dict:
    rows = session.scalars(select(Prediction).where(Prediction.outcome.in_(["won", "lost"]))).all()
    real = []
    synthetic = []
    for prediction in rows:
        fixture = session.get(Fixture, prediction.fixture_id)
        target = synthetic if fixture and fixture.data_origin == "synthetic_demo" else real
        target.append(prediction)
    evaluations = session.scalars(select(EvaluationRun).order_by(EvaluationRun.id.desc())).all()
    return {
        "settled_real": _score_group(session, real),
        "settled_synthetic": _score_group(session, synthetic),
        "evaluation_runs": [
            {
                "id": run.id,
                "status": run.status,
                "metrics": run.metrics,
                "sample_sizes": run.sample_sizes,
                "notes": run.notes,
                "started_at": _iso(run.started_at),
                "finished_at": _iso(run.finished_at),
            }
            for run in evaluations
        ],
        "simulated_returns": _simulated(session, real),
        "disclaimer": "Simulated results are not a betting history and do not imply future profit.",
    }


def _score_group(session: Session, predictions: list[Prediction]) -> dict:
    if len(predictions) < 20:
        return {"status": "insufficient_data", "observations": len(predictions)}
    by_market: dict[str, list[Prediction]] = {}
    for prediction in predictions:
        by_market.setdefault(prediction.market_key, []).append(prediction)
    markets = {}
    for key, group in by_market.items():
        if len(group) < 20:
            markets[key] = {"status": "insufficient_data", "observations": len(group)}
            continue
        probabilities = [float(item.probability) for item in group]
        outcomes = [1 if item.outcome == "won" else 0 for item in group]
        if len(set(outcomes)) < 2:
            markets[key] = {"status": "insufficient_data", "observations": len(group)}
            continue
        from sklearn.metrics import brier_score_loss, log_loss

        markets[key] = {
            "status": "estimated",
            "observations": len(group),
            "brier_score": float(brier_score_loss(outcomes, probabilities)),
            "log_loss": float(log_loss(outcomes, probabilities)),
        }
    return {"status": "estimated", "observations": len(predictions), "by_market": markets}


def _simulated(session: Session, predictions: list[Prediction]) -> dict:
    priced = []
    for prediction in predictions:
        if prediction.odds_snapshot_id is None:
            continue
        snapshot = session.get(OddsSnapshot, prediction.odds_snapshot_id)
        if snapshot is None or snapshot.data_origin == "synthetic_demo":
            continue
        priced.append({"decimal_odds": snapshot.decimal_odds, "won": prediction.outcome == "won"})
    return simulate_unit_returns(priced)


def coverage(session: Session, settings: Settings) -> dict:
    leagues = session.scalars(select(League).order_by(League.name)).all()
    mappings = []
    for mapping in session.scalars(select(BookmakerMarketMapping)).all():
        bookmaker = session.get(Bookmaker, mapping.bookmaker_id)
        market = session.get(MarketDefinition, mapping.market_definition_id)
        mappings.append(
            {
                "bookmaker": None if bookmaker is None else bookmaker.key,
                "market_key": None if market is None else market.key,
                "provider_market_key": mapping.provider_market_key,
                "status": mapping.status,
                "notes": mapping.notes,
            }
        )
    return {
        "providers": provider_rows(session),
        "leagues": [
            {"id": league.id, "name": league.name, "data_origin": league.data_origin}
            for league in leagues
        ],
        "markets": market_catalog(),
        "mappings": mappings,
        "settings": effective_settings(session, settings),
        "secrets": {
            "api_football_configured": bool(settings.api_football_key),
            "odds_api_configured": bool(settings.odds_api_key),
            "football_data_configured": bool(settings.football_data_api_key),
        },
    }


def ingestion_log(session: Session) -> list[dict]:
    rows = session.scalars(select(IngestionRun).order_by(IngestionRun.id.desc()).limit(50)).all()
    payload = []
    for run in rows:
        provider = session.get(Provider, run.provider_id) if run.provider_id else None
        payload.append(
            {
                "id": run.id,
                "provider": None if provider is None else provider.key,
                "kind": run.kind,
                "status": run.status,
                "records_written": run.records_written,
                "error_message": run.error_message,
                "details": run.details,
                "started_at": _iso(run.started_at),
                "finished_at": _iso(run.finished_at),
            }
        )
    return payload


def slip_export_text(session: Session, slip: Slip) -> str:
    payload = slip_payload(session, slip)
    lines = [
        f"{payload['label']} ({payload['preparation_status']})",
        "Research slip. Verify every price on the bookmaker before staking. Nothing here is a guaranteed outcome.",
        f"Combined captured odds: {payload['combined_odds']}",
        f"Estimated joint probability: {payload['joint_probability']} ({payload['joint_probability_method']})",
        f"Estimated value per unit: {payload['expected_value']} ({payload['ev_status']})",
        "",
    ]
    for selection in payload["selections"]:
        line = selection["line"] or "-"
        lines.append(
            f"{selection['match']} | {selection['market_name']} | {selection['selection']} | line {line} | "
            f"odds {selection['decimal_odds']} @ {selection['captured_at']} | {selection['bookmaker_name']}"
        )
        lines.append(f"  {selection['rationale']}")
    if payload["booking_code"]:
        lines.append("")
        lines.append(
            f"Booking code for {payload['booking_bookmaker']}: {payload['booking_code']} (not valid on other bookmakers)"
        )
    lines.append("")
    lines.append(payload["disclaimer"])
    return "\n".join(lines)
