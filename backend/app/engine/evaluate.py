"""Chronological evaluation. The final holdout is not used to choose rho."""

from __future__ import annotations

from decimal import Decimal
from math import log

import numpy as np

from app.engine.markets import derive_goal_markets
from app.engine.scoreline import scoreline_matrix
from app.engine.strengths import HistoricalMatch, estimate_goal_rates


def _binary_metrics(probabilities: list[float], outcomes: list[int]) -> dict:
    from sklearn.metrics import brier_score_loss, log_loss

    if len(outcomes) < 20 or len(set(outcomes)) < 2:
        return {"status": "insufficient_data", "observations": len(outcomes)}
    probs = np.clip(np.array(probabilities, dtype=float), 1e-6, 1 - 1e-6)
    ys = np.array(outcomes, dtype=int)
    return {
        "status": "estimated",
        "observations": int(len(outcomes)),
        "brier_score": float(brier_score_loss(ys, probs)),
        "log_loss": float(log_loss(ys, probs)),
    }


def _calibration(probabilities: list[float], outcomes: list[int]) -> dict:
    from sklearn.calibration import calibration_curve

    if len(outcomes) < 30 or sum(outcomes) < 5 or sum(outcomes) > len(outcomes) - 5:
        return {"status": "insufficient_data", "observations": len(outcomes)}
    fraction, mean_predicted = calibration_curve(
        outcomes, probabilities, n_bins=8, strategy="quantile"
    )
    return {
        "status": "estimated",
        "observations": len(outcomes),
        "mean_predicted": [float(value) for value in mean_predicted],
        "fraction_positive": [float(value) for value in fraction],
    }


def walk_forward_evaluate(
    matches: list[HistoricalMatch],
    min_matches: int = 5,
    rho_min_matches: int = 80,
    minimum_total: int = 40,
) -> dict:
    ordered = sorted(matches, key=lambda match: (match.kickoff, match.match_id))
    if len(ordered) < minimum_total:
        return {
            "status": "insufficient_data",
            "observations": len(ordered),
            "note": "The final holdout was not scored because the sample is too small.",
        }
    test_start = int(len(ordered) * 0.8)
    # Rho selection for the published test uses only the pre-holdout portion.
    pre_holdout = ordered[:test_start]
    rho_probe = estimate_goal_rates(
        pre_holdout,
        pre_holdout[-1].home_id,
        pre_holdout[-1].away_id,
        pre_holdout[-1].kickoff,
        min_matches=1,
        rho_min_matches=rho_min_matches,
    )
    frozen_rho = 0.0 if rho_probe is None or rho_probe.rho_source != "estimated" else rho_probe.rho
    home_probs: list[float] = []
    home_outcomes: list[int] = []
    btts_probs: list[float] = []
    btts_outcomes: list[int] = []
    over_probs: list[float] = []
    over_outcomes: list[int] = []
    score_log: list[float] = []
    skipped = 0
    for match in ordered[test_start:]:
        history = [item for item in ordered if item.kickoff < match.kickoff]
        estimate = estimate_goal_rates(
            history,
            match.home_id,
            match.away_id,
            match.kickoff,
            min_matches=min_matches,
            rho_min_matches=10**9,
        )
        if estimate is None:
            skipped += 1
            continue
        matrix = scoreline_matrix(estimate.lambda_home, estimate.lambda_away, frozen_rho)
        derived = { (item["market_key"], item["selection"], item["line"]): item for item in derive_goal_markets(matrix, include_experimental=False) }
        home = derived[("match_result", "home", None)]["probability"]
        btts = derived[("btts", "yes", None)]["probability"]
        over = derived[("over_under_goals", "over", Decimal("2.5"))]["probability"]
        home_probs.append(float(home))
        home_outcomes.append(1 if match.home_goals > match.away_goals else 0)
        btts_probs.append(float(btts))
        btts_outcomes.append(1 if match.home_goals >= 1 and match.away_goals >= 1 else 0)
        over_probs.append(float(over))
        over_outcomes.append(1 if match.home_goals + match.away_goals >= 3 else 0)
        if match.home_goals < matrix.shape[0] and match.away_goals < matrix.shape[1]:
            score_log.append(log(max(float(matrix[match.home_goals, match.away_goals]), 1e-12)))
    observations = len(home_probs)
    return {
        "status": "estimated" if observations >= 20 else "insufficient_data",
        "observations": observations,
        "skipped": skipped,
        "holdout_start_index": test_start,
        "frozen_rho": frozen_rho,
        "rho_note": "Rho was selected only on matches before the final holdout, then frozen.",
        "home_win": _binary_metrics(home_probs, home_outcomes),
        "btts_yes": _binary_metrics(btts_probs, btts_outcomes),
        "over_2_5": _binary_metrics(over_probs, over_outcomes),
        "home_win_calibration": _calibration(home_probs, home_outcomes),
        "mean_scoreline_log_score": (sum(score_log) / len(score_log)) if score_log else None,
        "disclaimer": "Historical scores do not estimate future profit. No odds were used in this probability check.",
    }


def simulate_unit_returns(rows: list[dict]) -> dict:
    """Simulate one-unit stakes. Each row needs odds and a settled won flag.

    Rows without a stored historical price are ignored rather than filled in.
    """
    from decimal import Decimal

    usable = [row for row in rows if row.get("decimal_odds") is not None and row.get("won") is not None]
    if len(usable) < 30:
        return {
            "status": "insufficient_data",
            "observations": len(usable),
            "note": "Fewer than 30 priced settlements. No return is reported.",
        }
    equity = Decimal("0")
    peak = Decimal("0")
    max_drawdown = Decimal("0")
    for row in usable:
        odds = Decimal(str(row["decimal_odds"]))
        profit = (odds - Decimal("1")) if row["won"] else Decimal("-1")
        equity += profit
        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, equity - peak)
    return {
        "status": "simulated",
        "observations": len(usable),
        "profit_units": format(equity, "f"),
        "max_drawdown_units": format(max_drawdown, "f"),
        "stake": "1 unit per settled selection",
        "disclaimer": "Simulated staking is not a betting record and is not evidence of future profit.",
    }
