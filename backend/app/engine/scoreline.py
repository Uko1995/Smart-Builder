"""Poisson scoreline grid with an optional Dixon-Coles adjustment.

Dixon and Coles (1997) multiply the independent Poisson probabilities of
0-0, 1-0, 0-1 and 1-1 by a small dependence factor tau. Rho is that
dependence parameter. Rho of zero leaves the independent Poisson model
unchanged. Tau is not allowed to become negative: rho is shrunk toward
zero until every low-score factor is positive.

The grid is goals 0..MAX_GOALS. Residual Poisson mass outside the grid is
removed by normalising each marginal. For ordinary football scoring rates
that residual is negligible. Tests check the pre-normalisation mass.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import poisson

MAX_GOALS = 12
MAX_CORNERS = 20


def tau(home_goals: int, away_goals: int, lam: float, mu: float, rho: float) -> float:
    if home_goals == 0 and away_goals == 0:
        return 1.0 - (lam * mu * rho)
    if home_goals == 0 and away_goals == 1:
        return 1.0 + (lam * rho)
    if home_goals == 1 and away_goals == 0:
        return 1.0 + (mu * rho)
    if home_goals == 1 and away_goals == 1:
        return 1.0 - rho
    return 1.0


def shrink_rho(lam: float, mu: float, rho: float) -> float:
    current = float(rho)
    for _ in range(24):
        factors = [
            tau(0, 0, lam, mu, current),
            tau(0, 1, lam, mu, current),
            tau(1, 0, lam, mu, current),
            tau(1, 1, lam, mu, current),
        ]
        if min(factors) > 1e-9:
            return current
        current *= 0.5
    return 0.0


def marginal_mass(rate: float, max_count: int) -> float:
    goals = np.arange(0, max_count + 1)
    return float(poisson.pmf(goals, rate).sum())


def scoreline_matrix(
    lambda_home: float,
    lambda_away: float,
    rho: float = 0.0,
    max_count: int = MAX_GOALS,
) -> np.ndarray:
    if lambda_home <= 0 or lambda_away <= 0:
        raise ValueError("scoring rates must be positive")
    if not np.isfinite([lambda_home, lambda_away, rho]).all():
        raise ValueError("scoring rates must be finite")
    counts = np.arange(0, max_count + 1)
    home = poisson.pmf(counts, lambda_home)
    away = poisson.pmf(counts, lambda_away)
    if float(home.sum()) <= 0 or float(away.sum()) <= 0:
        raise ValueError("poisson mass was zero")
    home = home / home.sum()
    away = away / away.sum()
    matrix = np.outer(home, away)
    rho_used = shrink_rho(lambda_home, lambda_away, rho)
    if rho_used != 0.0:
        for home_goals in (0, 1):
            for away_goals in (0, 1):
                matrix[home_goals, away_goals] *= tau(
                    home_goals, away_goals, lambda_home, lambda_away, rho_used
                )
        total = float(matrix.sum())
        if total <= 0:
            raise ValueError("scoreline mass collapsed after the Dixon-Coles adjustment")
        matrix = matrix / total
    return matrix


def distribution_error(matrix: np.ndarray) -> float:
    return abs(float(matrix.sum()) - 1.0)
