"""Time-weighted attack and defence ratios.

This is a transparent baseline, not a fully maximised Dixon-Coles likelihood.
Attack and defence are ratios of a team's time-weighted scoring rate to the
competition average. The decay constant xi is fixed at 0.005 per day
(half-life about 139 days). It is not tuned on the final holdout.

Only matches kicked off before the prediction cutoff are used.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import exp

XI_PER_DAY = 0.005
MIN_RATE = 0.05
MAX_RATE = 6.0
RHO_GRID = [round(-0.14 + index * 0.01, 2) for index in range(16)]


@dataclass(frozen=True)
class HistoricalMatch:
    match_id: str
    league_id: str
    kickoff: datetime
    home_id: str
    away_id: str
    home_goals: int
    away_goals: int
    ht_home_goals: int | None = None
    ht_away_goals: int | None = None
    home_corners: int | None = None
    away_corners: int | None = None
    home_cards: int | None = None
    away_cards: int | None = None


@dataclass(frozen=True)
class RateEstimate:
    lambda_home: float
    lambda_away: float
    rho: float
    rho_source: str
    home_matches: int
    away_matches: int
    league_matches: int
    quality: float
    clamped: bool


def _days_before(cutoff: datetime, kickoff: datetime) -> float:
    return max(0.0, (cutoff - kickoff).total_seconds() / 86400)


def _weight(cutoff: datetime, kickoff: datetime) -> float:
    return exp(-XI_PER_DAY * _days_before(cutoff, kickoff))


def sample_quality(matches: int, full_sample: int = 30) -> float:
    if matches <= 0:
        return 0.0
    return min(1.0, matches / full_sample)


def _rates_from_history(
    history: list[HistoricalMatch],
    home_id: str,
    away_id: str,
    cutoff: datetime,
    *,
    home_value,
    away_value,
    min_matches: int,
    rho: float,
    rho_source: str,
) -> RateEstimate | None:
    league_home_weight = 0.0
    league_home_goals = 0.0
    league_away_weight = 0.0
    league_away_goals = 0.0
    usable = []
    for match in history:
        if match.kickoff >= cutoff:
            continue
        scored_home = home_value(match)
        scored_away = away_value(match)
        if scored_home is None or scored_away is None:
            continue
        weight = _weight(cutoff, match.kickoff)
        usable.append((match, weight, scored_home, scored_away))
        league_home_weight += weight
        league_away_weight += weight
        league_home_goals += weight * scored_home
        league_away_goals += weight * scored_away
    if league_home_weight == 0 or league_away_weight == 0:
        return None
    league_home_avg = max(league_home_goals / league_home_weight, 0.2)
    league_away_avg = max(league_away_goals / league_away_weight, 0.2)

    def side_rates(team_id: str, at_home: bool) -> tuple[float, float, int] | None:
        weight_sum = 0.0
        scored = 0.0
        conceded = 0.0
        count = 0
        for match, weight, home_goals, away_goals in usable:
            if at_home and match.home_id == team_id:
                weight_sum += weight
                scored += weight * home_goals
                conceded += weight * away_goals
                count += 1
            elif not at_home and match.away_id == team_id:
                weight_sum += weight
                scored += weight * away_goals
                conceded += weight * home_goals
                count += 1
        if count < min_matches or weight_sum == 0:
            return None
        return scored / weight_sum, conceded / weight_sum, count

    home_side = side_rates(home_id, True)
    away_side = side_rates(away_id, False)
    if home_side is None or away_side is None:
        return None
    home_scored, home_conceded, home_n = home_side
    away_scored, away_conceded, away_n = away_side
    attack_home = home_scored / league_home_avg
    defence_home = home_conceded / league_away_avg
    attack_away = away_scored / league_away_avg
    defence_away = away_conceded / league_home_avg
    lambda_home = league_home_avg * attack_home * defence_away
    lambda_away = league_away_avg * attack_away * defence_home
    clamped = False
    if lambda_home < MIN_RATE or lambda_home > MAX_RATE or lambda_away < MIN_RATE or lambda_away > MAX_RATE:
        clamped = True
    lambda_home = min(MAX_RATE, max(MIN_RATE, lambda_home))
    lambda_away = min(MAX_RATE, max(MIN_RATE, lambda_away))
    quality = sample_quality(min(home_n, away_n))
    return RateEstimate(
        lambda_home=lambda_home,
        lambda_away=lambda_away,
        rho=rho,
        rho_source=rho_source,
        home_matches=home_n,
        away_matches=away_n,
        league_matches=len(usable),
        quality=quality,
        clamped=clamped,
    )


def estimate_goal_rates(
    history: list[HistoricalMatch],
    home_id: str,
    away_id: str,
    cutoff: datetime,
    min_matches: int,
    rho_min_matches: int,
) -> RateEstimate | None:
    base = _rates_from_history(
        history,
        home_id,
        away_id,
        cutoff,
        home_value=lambda match: match.home_goals,
        away_value=lambda match: match.away_goals,
        min_matches=min_matches,
        rho=0.0,
        rho_source="withheld",
    )
    if base is None:
        return None
    if base.league_matches < rho_min_matches:
        return base
    rho = _select_rho(history, cutoff)
    return RateEstimate(
        lambda_home=base.lambda_home,
        lambda_away=base.lambda_away,
        rho=rho,
        rho_source="estimated",
        home_matches=base.home_matches,
        away_matches=base.away_matches,
        league_matches=base.league_matches,
        quality=base.quality,
        clamped=base.clamped,
    )


def _select_rho(history: list[HistoricalMatch], cutoff: datetime) -> float:
    """Pick rho by chronological validation inside the pre-cutoff sample.

    The last 20 percent of pre-cutoff matches is a local validation slice.
    Rho is chosen there and is not taken from a future match. This is separate
    from the evaluation command's final holdout.
    """
    from app.engine.scoreline import scoreline_matrix

    prior = [match for match in history if match.kickoff < cutoff]
    prior.sort(key=lambda match: (match.kickoff, match.match_id))
    if len(prior) < 20:
        return 0.0
    split = int(len(prior) * 0.8)
    validation = prior[split:]
    train = prior[:split]
    if not validation or not train:
        return 0.0
    best_rho = 0.0
    best_score = None
    for rho in RHO_GRID:
        score = 0.0
        used = 0
        for match in validation:
            estimate = _rates_from_history(
                train,
                match.home_id,
                match.away_id,
                match.kickoff,
                home_value=lambda item: item.home_goals,
                away_value=lambda item: item.away_goals,
                min_matches=1,
                rho=rho,
                rho_source="candidate",
            )
            if estimate is None:
                continue
            matrix = scoreline_matrix(estimate.lambda_home, estimate.lambda_away, rho)
            if match.home_goals >= matrix.shape[0] or match.away_goals >= matrix.shape[1]:
                continue
            probability = float(matrix[match.home_goals, match.away_goals])
            score += _log(probability)
            used += 1
        if used == 0:
            continue
        mean_score = score / used
        if best_score is None or mean_score > best_score + 1e-12:
            best_score = mean_score
            best_rho = rho
        elif best_score is not None and abs(mean_score - best_score) <= 1e-12:
            if abs(rho) < abs(best_rho) or (abs(rho) == abs(best_rho) and rho < best_rho):
                best_rho = rho
    return best_rho


def _log(probability: float) -> float:
    from math import log

    return log(max(probability, 1e-12))


def estimate_count_rates(
    history: list[HistoricalMatch],
    home_id: str,
    away_id: str,
    cutoff: datetime,
    min_matches: int,
    kind: str,
) -> RateEstimate | None:
    readers = {
        "corners": (lambda match: match.home_corners, lambda match: match.away_corners),
        "cards": (lambda match: match.home_cards, lambda match: match.away_cards),
        "first_half": (lambda match: match.ht_home_goals, lambda match: match.ht_away_goals),
    }
    if kind not in readers:
        raise ValueError(kind)
    home_value, away_value = readers[kind]
    return _rates_from_history(
        history,
        home_id,
        away_id,
        cutoff,
        home_value=home_value,
        away_value=away_value,
        min_matches=min_matches,
        rho=0.0,
        rho_source="not_used",
    )
