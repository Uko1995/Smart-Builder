"""Settle stored predictions from recorded results. Missing stats stay unsettled."""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.engine.markets import count_predicate, goal_predicate
from app.models import Fixture, MatchStatistics, Prediction, Slip, SlipEvaluation, SlipSelection
from app.services.store import upsert_statistics
from app.services.timeutil import utcnow

GOAL_MARKETS = {
    "match_result",
    "double_chance",
    "draw_no_bet",
    "over_under_goals",
    "btts",
    "asian_handicap",
    "asian_handicap_integer",
    "correct_score",
    "team_total_home",
    "team_total_away",
}
HALF_MARKETS = {"first_half_result", "first_half_over_under"}
COUNT_MARKETS = {
    "match_corners",
    "team_corners_home",
    "team_corners_away",
    "match_cards",
    "team_cards_home",
    "team_cards_away",
}


def record_result(
    session: Session,
    fixture_id: int,
    *,
    home_goals: int,
    away_goals: int,
    ht_home_goals: int | None = None,
    ht_away_goals: int | None = None,
    home_corners: int | None = None,
    away_corners: int | None = None,
    home_cards: int | None = None,
    away_cards: int | None = None,
) -> dict:
    fixture = session.get(Fixture, fixture_id)
    if fixture is None:
        raise ValueError("fixture not found")
    fixture.home_goals = home_goals
    fixture.away_goals = away_goals
    fixture.ht_home_goals = ht_home_goals
    fixture.ht_away_goals = ht_away_goals
    fixture.status = "completed"
    if any(value is not None for value in (home_corners, away_corners, home_cards, away_cards)):
        upsert_statistics(
            session,
            fixture.id,
            home_corners=home_corners,
            away_corners=away_corners,
            home_cards=home_cards,
            away_cards=away_cards,
            source="recorded_result",
            captured_at=utcnow(),
        )
    stats = session.scalar(select(MatchStatistics).where(MatchStatistics.fixture_id == fixture.id))
    graded = 0
    predictions = session.scalars(select(Prediction).where(Prediction.fixture_id == fixture.id)).all()
    for prediction in predictions:
        outcome = _grade(prediction, fixture, stats)
        if outcome is None:
            continue
        prediction.outcome = outcome
        prediction.settled_at = utcnow()
        graded += 1
    slips = session.scalars(
        select(Slip).join(SlipSelection, SlipSelection.slip_id == Slip.id).join(Prediction, Prediction.id == SlipSelection.prediction_id).where(Prediction.fixture_id == fixture.id)
    ).all()
    for slip in {slip.id: slip for slip in slips}.values():
        _grade_slip(session, slip)
    session.commit()
    return {"fixture_id": fixture.id, "predictions_graded": graded}


def _grade(prediction: Prediction, fixture: Fixture, stats: MatchStatistics | None) -> str | None:
    if prediction.market_key in GOAL_MARKETS:
        return _grade_goals(prediction, fixture.home_goals, fixture.away_goals)
    if prediction.market_key in HALF_MARKETS:
        return _grade_goals(prediction, fixture.ht_home_goals, fixture.ht_away_goals)
    if prediction.market_key in COUNT_MARKETS:
        if stats is None:
            return None
        counts = {
            "match_corners": (stats.home_corners, stats.away_corners),
            "team_corners_home": (stats.home_corners, stats.away_corners),
            "team_corners_away": (stats.home_corners, stats.away_corners),
            "match_cards": (stats.home_cards, stats.away_cards),
            "team_cards_home": (stats.home_cards, stats.away_cards),
            "team_cards_away": (stats.home_cards, stats.away_cards),
        }[prediction.market_key]
        if counts[0] is None or counts[1] is None:
            return None
        predicate = count_predicate(prediction.market_key, prediction.selection, prediction.line)
        if predicate is None:
            return None
        return "won" if predicate(counts[0], counts[1]) else "lost"
    return None


def _grade_goals(prediction: Prediction, home: int | None, away: int | None) -> str | None:
    if home is None or away is None:
        return None
    if prediction.market_key == "draw_no_bet":
        if home == away:
            return "void"
        won = (prediction.selection == "home" and home > away) or (
            prediction.selection == "away" and away > home
        )
        return "won" if won else "lost"
    if prediction.market_key == "asian_handicap_integer" and prediction.line is not None:
        if prediction.selection == "home" and Decimal(home) + prediction.line == Decimal(away):
            return "void"
        if prediction.selection == "away" and Decimal(away) - prediction.line == Decimal(home):
            return "void"
    predicate = goal_predicate(prediction.market_key, prediction.selection, prediction.line)
    if predicate is None:
        return None
    return "won" if predicate(home, away) else "lost"


def _grade_slip(session: Session, slip: Slip) -> None:
    rows = session.scalars(select(SlipSelection).where(SlipSelection.slip_id == slip.id).order_by(SlipSelection.position)).all()
    outcomes = []
    prices = []
    for row in rows:
        prediction = session.get(Prediction, row.prediction_id)
        if prediction is None or prediction.outcome is None:
            outcome = "open"
        else:
            outcome = prediction.outcome
        outcomes.append(outcome)
        prices.append(row.decimal_odds)
    if any(item == "open" for item in outcomes):
        result = "open"
        profit = None
        note = "At least one leg is still unsettled."
    elif any(item == "lost" for item in outcomes):
        result = "lost"
        profit = Decimal("-1")
        note = "Simulated one-unit stake. A lost leg loses the stake."
    else:
        active_prices = [price for price, outcome in zip(prices, outcomes, strict=True) if outcome == "won"]
        if not active_prices:
            result = "void"
            profit = Decimal("0")
            note = "Every leg was void. Simulated profit is zero."
        else:
            combined = Decimal("1")
            for price in active_prices:
                combined *= price
            result = "won"
            profit = (combined - Decimal("1")).quantize(Decimal("0.0001"))
            note = "Simulated one-unit stake using the captured odds stored on the slip. Voids are removed."
    existing = session.scalar(select(SlipEvaluation).where(SlipEvaluation.slip_id == slip.id))
    if existing is None:
        session.add(
            SlipEvaluation(
                slip_id=slip.id,
                outcome=result,
                profit_units=profit,
                settled_at=None if result == "open" else datetime.now(UTC),
                notes=note,
            )
        )
    else:
        existing.outcome = result
        existing.profit_units = profit
        existing.settled_at = None if result == "open" else datetime.now(UTC)
        existing.notes = note
