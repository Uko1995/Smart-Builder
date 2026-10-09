from datetime import UTC, datetime, timedelta
from decimal import Decimal

import numpy as np

from app.engine.evaluate import simulate_unit_returns, walk_forward_evaluate
from app.engine.markets import combined_decimal_odds, derive_goal_markets, expected_value, fair_odds
from app.engine.scoreline import distribution_error, marginal_mass, scoreline_matrix
from app.engine.strengths import HistoricalMatch, estimate_goal_rates


def test_scoreline_probabilities_sum_to_one():
    matrix = scoreline_matrix(1.45, 1.15, -0.08)
    assert distribution_error(matrix) < 1e-9
    assert np.all(matrix >= -1e-12)
    assert marginal_mass(1.45, 12) > 1 - 1e-8


def test_zero_rho_matches_independent_poisson_shape():
    matrix = scoreline_matrix(1.2, 0.9, 0)
    assert abs(float(matrix[0, 0]) - float(scoreline_matrix(1.2, 0.9, 0)[0, 0])) < 1e-12


def test_dixon_coles_changes_low_scores_only_after_renormalising():
    plain = scoreline_matrix(1.4, 1.1, 0)
    adjusted = scoreline_matrix(1.4, 1.1, -0.1)
    assert distribution_error(adjusted) < 1e-9
    assert abs(float(plain[0, 0]) - float(adjusted[0, 0])) > 1e-6


def test_match_result_and_totals_are_partitions():
    derived = derive_goal_markets(scoreline_matrix(1.5, 1.2, -0.05))
    grouped: dict[tuple, list] = {}
    for item in derived:
        if item["market_key"] in {"match_result", "btts", "over_under_goals", "asian_handicap"}:
            grouped.setdefault((item["market_key"], str(item["line"])), []).append(item["probability"])
    for key, probabilities in grouped.items():
        assert sum(probabilities, Decimal("0")) == Decimal("1.00000000"), key


def test_double_chance_matches_match_result():
    derived = derive_goal_markets(scoreline_matrix(1.3, 1.05, 0))
    by_key = {(item["market_key"], item["selection"], item["line"]): item["probability"] for item in derived}
    assert by_key[("double_chance", "home_or_draw", None)] == (
        by_key[("match_result", "home", None)] + by_key[("match_result", "draw", None)]
    )


def test_decimal_odds_and_expected_value():
    combined = combined_decimal_odds([Decimal("2.20"), Decimal("2.20"), Decimal("2.20")])
    assert combined == Decimal("10.6480")
    assert expected_value(Decimal("0.5"), Decimal("2.20")) == Decimal("0.100")
    assert fair_odds(Decimal("0.5")) == Decimal("2.0000")


def test_negative_rho_is_deterministic_and_ignores_future_matches():
    start = datetime(2026, 1, 1, tzinfo=UTC)
    history = []
    for index in range(12):
        history.append(
            HistoricalMatch(
                match_id=str(index),
                league_id="1",
                kickoff=start + timedelta(days=index),
                home_id="1" if index % 2 == 0 else "2",
                away_id="2" if index % 2 == 0 else "1",
                home_goals=1,
                away_goals=0,
            )
        )
    future = HistoricalMatch(
        match_id="future",
        league_id="1",
        kickoff=start + timedelta(days=30),
        home_id="1",
        away_id="2",
        home_goals=8,
        away_goals=8,
    )
    cutoff = start + timedelta(days=20)
    first = estimate_goal_rates(history + [future], "1", "2", cutoff, min_matches=2, rho_min_matches=100)
    second = estimate_goal_rates(history, "1", "2", cutoff, min_matches=2, rho_min_matches=100)
    assert first is not None and second is not None
    assert first.lambda_home == second.lambda_home
    assert first.rho_source == "withheld"


def test_walk_forward_refuses_a_small_sample():
    result = walk_forward_evaluate([], minimum_total=40)
    assert result["status"] == "insufficient_data"


def test_simulated_returns_need_a_real_sample():
    short = simulate_unit_returns([{"decimal_odds": "2.0", "won": True}])
    assert short["status"] == "insufficient_data"
    rows = [{"decimal_odds": "2.0", "won": index % 2 == 0} for index in range(30)]
    long = simulate_unit_returns(rows)
    assert long["status"] == "simulated"
    assert long["observations"] == 30
