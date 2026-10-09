"""Derive market probabilities from one shared count distribution."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Callable

import numpy as np

Predicate = Callable[[int, int], bool]

HALF_GOAL_LINES = (Decimal("0.5"), Decimal("1.5"), Decimal("2.5"), Decimal("3.5"), Decimal("4.5"))
HANDICAP_LINES = (
    Decimal("-2.5"),
    Decimal("-1.5"),
    Decimal("-0.5"),
    Decimal("0.5"),
    Decimal("1.5"),
    Decimal("2.5"),
)
INTEGER_HANDICAP_LINES = (Decimal("-2"), Decimal("-1"), Decimal("0"), Decimal("1"), Decimal("2"))
CORNER_LINES = (Decimal("7.5"), Decimal("8.5"), Decimal("9.5"), Decimal("10.5"), Decimal("11.5"))
TEAM_CORNER_LINES = (Decimal("3.5"), Decimal("4.5"), Decimal("5.5"))
CARD_LINES = (Decimal("2.5"), Decimal("3.5"), Decimal("4.5"), Decimal("5.5"))


def quantize_probability(value: float) -> Decimal:
    if value < 0 and value > -1e-10:
        value = 0.0
    if value < 0 or value > 1.0000001:
        raise ValueError(f"probability out of range: {value}")
    return Decimal(f"{value:.8f}")


def fair_odds(probability: Decimal) -> Decimal | None:
    if probability <= 0:
        return None
    return (Decimal("1") / probability).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def expected_value(probability: Decimal, decimal_odds: Decimal) -> Decimal:
    if decimal_odds <= 1:
        raise ValueError("decimal odds must be greater than 1")
    if probability < 0 or probability > 1:
        raise ValueError("probability must be between 0 and 1")
    return (probability * decimal_odds) - Decimal("1")


def combined_decimal_odds(prices: list[Decimal]) -> Decimal:
    total = Decimal("1")
    for price in prices:
        if price <= 1:
            raise ValueError("decimal odds must be greater than 1")
        total *= price
    return total.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _sum_where(matrix: np.ndarray, predicate: Predicate) -> float:
    total = 0.0
    rows, cols = matrix.shape
    for home in range(rows):
        for away in range(cols):
            if predicate(home, away):
                total += float(matrix[home, away])
    return total


def _partition(entries: list[dict]) -> list[dict]:
    total = sum((entry["probability"] for entry in entries), Decimal("0"))
    drift = Decimal("1.00000000") - total
    if abs(drift) > Decimal("0.0001"):
        raise ValueError(f"mutually exclusive outcomes drifted by {drift}")
    if entries:
        largest = max(entries, key=lambda entry: entry["probability"])
        largest["probability"] = (largest["probability"] + drift).quantize(Decimal("0.00000001"))
    return entries


def _entry(market_key: str, selection: str, line: Decimal | None, probability: float, **details) -> dict:
    quantized = quantize_probability(probability)
    return {
        "market_key": market_key,
        "selection": selection,
        "line": line,
        "probability": quantized,
        "fair_odds": fair_odds(quantized),
        "details": details,
    }


def goal_predicate(market_key: str, selection: str, line: Decimal | None) -> Predicate | None:
    """Return the full-time score predicate, or None if this is not a goal market."""
    if market_key == "match_result":
        return {"home": lambda h, a: h > a, "draw": lambda h, a: h == a, "away": lambda h, a: h < a}[selection]
    if market_key == "double_chance":
        return {
            "home_or_draw": lambda h, a: h >= a,
            "home_or_away": lambda h, a: h != a,
            "draw_or_away": lambda h, a: h <= a,
        }[selection]
    if market_key == "draw_no_bet":
        # Conditional on a decisive match. Callers that need the unconditional
        # event should use match_result instead.
        if selection == "home":
            return lambda h, a: h > a
        if selection == "away":
            return lambda h, a: h < a
        raise KeyError(selection)
    if market_key in {"over_under_goals", "first_half_over_under"}:
        if line is None:
            raise ValueError("line is required")
        threshold = line
        if selection == "over":
            return lambda h, a, threshold=threshold: Decimal(h + a) > threshold
        if selection == "under":
            return lambda h, a, threshold=threshold: Decimal(h + a) < threshold
        raise KeyError(selection)
    if market_key == "btts":
        return {"yes": lambda h, a: h >= 1 and a >= 1, "no": lambda h, a: h == 0 or a == 0}[selection]
    if market_key in {"asian_handicap", "asian_handicap_integer"}:
        if line is None:
            raise ValueError("line is required")
        if selection == "home":
            return lambda h, a, line=line: Decimal(h) + line > Decimal(a)
        if selection == "away":
            return lambda h, a, line=line: Decimal(a) - line > Decimal(h)
        raise KeyError(selection)
    if market_key == "correct_score":
        home_s, away_s = (int(part) for part in selection.split("-"))
        return lambda h, a, home_s=home_s, away_s=away_s: h == home_s and a == away_s
    if market_key == "team_total_home":
        if line is None:
            raise ValueError("line is required")
        if selection == "over":
            return lambda h, a, line=line: Decimal(h) > line
        if selection == "under":
            return lambda h, a, line=line: Decimal(h) < line
    if market_key == "team_total_away":
        if line is None:
            raise ValueError("line is required")
        if selection == "over":
            return lambda h, a, line=line: Decimal(a) > line
        if selection == "under":
            return lambda h, a, line=line: Decimal(a) < line
    if market_key == "first_half_result":
        return {"home": lambda h, a: h > a, "draw": lambda h, a: h == a, "away": lambda h, a: h < a}[selection]
    return None


def integer_push_predicate(selection: str, line: Decimal) -> Predicate:
    if selection == "home":
        return lambda h, a, line=line: Decimal(h) + line == Decimal(a)
    if selection == "away":
        return lambda h, a, line=line: Decimal(a) - line == Decimal(h)
    raise KeyError(selection)


def derive_goal_markets(matrix: np.ndarray, include_experimental: bool = True) -> list[dict]:
    derived: list[dict] = []
    derived.extend(
        _partition(
            [
                _entry("match_result", "home", None, _sum_where(matrix, lambda h, a: h > a)),
                _entry("match_result", "draw", None, _sum_where(matrix, lambda h, a: h == a)),
                _entry("match_result", "away", None, _sum_where(matrix, lambda h, a: h < a)),
            ]
        )
    )
    # The three double-chance selections overlap, so they are not a partition.
    # Each one is checked against the match-result probabilities instead.
    derived.extend(
        [
            _entry("double_chance", "home_or_draw", None, _sum_where(matrix, lambda h, a: h >= a)),
            _entry("double_chance", "home_or_away", None, _sum_where(matrix, lambda h, a: h != a)),
            _entry("double_chance", "draw_or_away", None, _sum_where(matrix, lambda h, a: h <= a)),
        ]
    )
    home_win = _sum_where(matrix, lambda h, a: h > a)
    away_win = _sum_where(matrix, lambda h, a: h < a)
    draw = _sum_where(matrix, lambda h, a: h == a)
    decisive = home_win + away_win
    if decisive > 0:
        derived.append(
            _entry(
                "draw_no_bet",
                "home",
                None,
                home_win / decisive,
                win_probability=quantize_probability(home_win),
                push_probability=quantize_probability(draw),
                interpretation="conditional_on_no_draw",
            )
        )
        derived.append(
            _entry(
                "draw_no_bet",
                "away",
                None,
                away_win / decisive,
                win_probability=quantize_probability(away_win),
                push_probability=quantize_probability(draw),
                interpretation="conditional_on_no_draw",
            )
        )
    for line in HALF_GOAL_LINES:
        derived.extend(
            _partition(
                [
                    _entry("over_under_goals", "over", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h + a) > line)),
                    _entry("over_under_goals", "under", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h + a) < line)),
                ]
            )
        )
        derived.extend(
            _partition(
                [
                    _entry("team_total_home", "over", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h) > line)),
                    _entry("team_total_home", "under", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h) < line)),
                ]
            )
        )
        derived.extend(
            _partition(
                [
                    _entry("team_total_away", "over", line, _sum_where(matrix, lambda h, a, line=line: Decimal(a) > line)),
                    _entry("team_total_away", "under", line, _sum_where(matrix, lambda h, a, line=line: Decimal(a) < line)),
                ]
            )
        )
    derived.extend(
        _partition(
            [
                _entry("btts", "yes", None, _sum_where(matrix, lambda h, a: h >= 1 and a >= 1)),
                _entry("btts", "no", None, _sum_where(matrix, lambda h, a: h == 0 or a == 0)),
            ]
        )
    )
    for line in HANDICAP_LINES:
        derived.extend(
            _partition(
                [
                    _entry("asian_handicap", "home", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h) + line > Decimal(a))),
                    _entry("asian_handicap", "away", line, _sum_where(matrix, lambda h, a, line=line: Decimal(a) - line > Decimal(h))),
                ]
            )
        )
    if include_experimental:
        for line in INTEGER_HANDICAP_LINES:
            for selection in ("home", "away"):
                win_pred = goal_predicate("asian_handicap_integer", selection, line)
                push_pred = integer_push_predicate(selection, line)
                assert win_pred is not None
                derived.append(
                    _entry(
                        "asian_handicap_integer",
                        selection,
                        line,
                        _sum_where(matrix, win_pred),
                        push_probability=quantize_probability(_sum_where(matrix, push_pred)),
                        implementation_status="experimental",
                    )
                )
    for home in range(min(5, matrix.shape[0])):
        for away in range(min(5, matrix.shape[1])):
            probability = float(matrix[home, away])
            if probability < 0.01:
                continue
            derived.append(_entry("correct_score", f"{home}-{away}", None, probability))
    return derived


def derive_total_markets(
    matrix: np.ndarray,
    market_key: str,
    lines: tuple[Decimal, ...],
    home_market_key: str | None = None,
    away_market_key: str | None = None,
    home_lines: tuple[Decimal, ...] = (),
    away_lines: tuple[Decimal, ...] = (),
) -> list[dict]:
    derived: list[dict] = []
    for line in lines:
        derived.extend(
            _partition(
                [
                    _entry(market_key, "over", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h + a) > line)),
                    _entry(market_key, "under", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h + a) < line)),
                ]
            )
        )
    if home_market_key:
        for line in home_lines:
            derived.extend(
                _partition(
                    [
                        _entry(home_market_key, "over", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h) > line)),
                        _entry(home_market_key, "under", line, _sum_where(matrix, lambda h, a, line=line: Decimal(h) < line)),
                    ]
                )
            )
    if away_market_key:
        for line in away_lines:
            derived.extend(
                _partition(
                    [
                        _entry(away_market_key, "over", line, _sum_where(matrix, lambda h, a, line=line: Decimal(a) > line)),
                        _entry(away_market_key, "under", line, _sum_where(matrix, lambda h, a, line=line: Decimal(a) < line)),
                    ]
                )
            )
    return derived


def count_predicate(market_key: str, selection: str, line: Decimal | None) -> Predicate | None:
    if line is None:
        return None
    side = {
        "match_corners": "total",
        "match_cards": "total",
        "team_corners_home": "home",
        "team_cards_home": "home",
        "team_corners_away": "away",
        "team_cards_away": "away",
    }.get(market_key)
    if side is None:
        return None

    def predicate(home: int, away: int, side=side, line=line, selection=selection) -> bool:
        value = {"total": home + away, "home": home, "away": away}[side]
        if selection == "over":
            return Decimal(value) > line
        if selection == "under":
            return Decimal(value) < line
        raise KeyError(selection)

    return predicate
