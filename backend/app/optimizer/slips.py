"""Deterministic beam search for up to three slip strategies.

Cross-match selections are multiplied only after each match has a single
defensible probability. Two goal-market legs from the same match use the
shared scoreline grid. Combinations whose dependence cannot be evaluated
are rejected. The search does not invent a fourth slip to fill the dashboard.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

import numpy as np

from app.engine.markets import (
    combined_decimal_odds,
    expected_value,
    goal_predicate,
    quantize_probability,
)
from app.markets.registry import SLIP_EXCLUDED_MARKETS

STRATEGY_PROBABILITY = "probability_led"
STRATEGY_BALANCED = "balanced_value"
STRATEGY_HIGHER_ODDS = "higher_odds"
STRATEGIES = (STRATEGY_PROBABILITY, STRATEGY_BALANCED, STRATEGY_HIGHER_ODDS)
STRATEGY_LABELS = {
    STRATEGY_PROBABILITY: "Probability-led",
    STRATEGY_BALANCED: "Balanced value",
    STRATEGY_HIGHER_ODDS: "Higher odds",
}


@dataclass(frozen=True)
class CandidateSelection:
    selection_id: str
    fixture_id: str
    market_key: str
    selection: str
    line: Decimal | None
    decimal_odds: Decimal
    probability: Decimal
    data_quality: Decimal
    captured_at: datetime
    mapping_status: str
    implementation_status: str
    market_family: str
    bookmaker_key: str
    data_origin: str


@dataclass(frozen=True)
class OptimizerConfig:
    now: datetime
    freshness: timedelta
    odds_min: Decimal
    odds_max: Decimal
    min_quality: Decimal
    max_legs: int
    beam_width: int
    strategy_min_probability: dict[str, Decimal]
    max_same_match: int = 2
    max_overlap: Decimal = Decimal("0.5")


@dataclass
class BuiltSlip:
    strategy: str
    label: str
    selections: list[CandidateSelection]
    combined_odds: Decimal
    joint_probability: Decimal
    joint_method: str
    expected_value: Decimal
    warnings: list[str]
    diagnostics: dict


@dataclass
class OptimizerResult:
    slips: list[BuiltSlip]
    diagnostics: dict
    rejections: dict[str, int] = field(default_factory=dict)


def _line_key(line: Decimal | None) -> str:
    if line is None:
        return ""
    return format(line.quantize(Decimal("0.01")), "f")


def _signature(selection: CandidateSelection) -> str:
    return "|".join(
        [
            selection.fixture_id,
            selection.market_key,
            selection.selection,
            _line_key(selection.line),
        ]
    )


def _hard_reject(selection: CandidateSelection, config: OptimizerConfig) -> str | None:
    if selection.implementation_status != "supported":
        return "unsupported_or_experimental"
    if selection.market_key in SLIP_EXCLUDED_MARKETS:
        return "voidable_or_excluded_market"
    if selection.mapping_status not in {"verified", "manual"}:
        return "mapping_required"
    if selection.decimal_odds <= 1:
        return "invalid_odds"
    if config.now - selection.captured_at > config.freshness:
        return "stale_price"
    if selection.data_quality < config.min_quality:
        return "poor_data_quality"
    if selection.probability <= 0 or selection.probability > 1:
        return "invalid_probability"
    return None


def _marginal(matrix: np.ndarray, selection: CandidateSelection) -> Decimal | None:
    predicate = goal_predicate(selection.market_key, selection.selection, selection.line)
    if predicate is None:
        return None
    total = 0.0
    rows, cols = matrix.shape
    for home in range(rows):
        for away in range(cols):
            if predicate(home, away):
                total += float(matrix[home, away])
    return quantize_probability(total)


def _joint_for_legs(
    legs: list[CandidateSelection],
    scorelines: dict[str, np.ndarray],
) -> tuple[Decimal | None, str]:
    grouped: dict[str, list[CandidateSelection]] = defaultdict(list)
    for leg in legs:
        grouped[leg.fixture_id].append(leg)
    parts: list[Decimal] = []
    methods: list[str] = []
    for fixture_id, group in grouped.items():
        families = {leg.market_family for leg in group}
        if len(group) > 1 and families != {"goals"}:
            return None, "dependence_unavailable"
        if len(group) == 1:
            parts.append(group[0].probability)
            methods.append("marginal")
            continue
        matrix = scorelines.get(fixture_id)
        if matrix is None:
            return None, "dependence_unavailable"
        total = 0.0
        rows, cols = matrix.shape
        predicates = []
        for leg in group:
            predicate = goal_predicate(leg.market_key, leg.selection, leg.line)
            if predicate is None:
                return None, "dependence_unavailable"
            marginal = _marginal(matrix, leg)
            if marginal is None or abs(marginal - leg.probability) > Decimal("0.02"):
                return None, "inconsistent_probability"
            predicates.append(predicate)
        for home in range(rows):
            for away in range(cols):
                if all(predicate(home, away) for predicate in predicates):
                    total += float(matrix[home, away])
        if total <= 0:
            return Decimal("0"), "contradictory"
        parts.append(quantize_probability(total))
        methods.append("scoreline")
    joint = Decimal("1")
    for part in parts:
        joint *= part
    joint = joint.quantize(Decimal("0.00000001"))
    if joint < 0:
        joint = Decimal("0")
    if joint > 1:
        joint = Decimal("1")
    if len(grouped) == 1 and "scoreline" in methods:
        method = "scoreline_joint"
    elif len(grouped) > 1 and "scoreline" in methods:
        method = "mixed_scoreline_and_cross_match"
    elif len(grouped) > 1:
        method = "independent_cross_match"
    else:
        method = "single_selection"
    return joint, method


@dataclass
class _Verdict:
    reject: str | None
    odds: Decimal
    joint: Decimal | None
    method: str


def _evaluate_legs(
    legs: list[CandidateSelection],
    scorelines: dict[str, np.ndarray],
    config: OptimizerConfig,
) -> _Verdict:
    by_fixture: dict[str, int] = defaultdict(int)
    signatures = set()
    for leg in legs:
        by_fixture[leg.fixture_id] += 1
        if by_fixture[leg.fixture_id] > config.max_same_match:
            return _Verdict("same_match_limit", Decimal("0"), None, "")
        signature = _signature(leg)
        if signature in signatures:
            return _Verdict("duplicate_selection", Decimal("0"), None, "")
        signatures.add(signature)
    try:
        odds = combined_decimal_odds([leg.decimal_odds for leg in legs])
    except ValueError:
        return _Verdict("invalid_odds", Decimal("0"), None, "")
    joint, method = _joint_for_legs(legs, scorelines)
    if method in {"dependence_unavailable", "inconsistent_probability"}:
        return _Verdict(method, odds, None, method)
    if joint is None or joint <= 0 or method == "contradictory":
        return _Verdict("contradictory", odds, Decimal("0"), method)
    return _Verdict(None, odds, joint, method)


def _partial_score(strategy: str, verdict: _Verdict, legs: list[CandidateSelection]) -> Decimal:
    assert verdict.joint is not None
    if strategy == STRATEGY_PROBABILITY:
        return verdict.joint + sum(leg.data_quality for leg in legs) / Decimal(100)
    if strategy == STRATEGY_BALANCED:
        return expected_value(verdict.joint, verdict.odds)
    return verdict.odds


def _final_sort_key(strategy: str, verdict: _Verdict, signature: tuple[str, ...]):
    assert verdict.joint is not None
    if strategy == STRATEGY_PROBABILITY:
        return (-verdict.joint, signature)
    if strategy == STRATEGY_BALANCED:
        return (-expected_value(verdict.joint, verdict.odds), -verdict.joint, signature)
    return (-verdict.odds, -verdict.joint, signature)


def _search(
    pool: list[CandidateSelection],
    scorelines: dict[str, np.ndarray],
    config: OptimizerConfig,
    strategy: str,
) -> tuple[list[tuple[list[CandidateSelection], _Verdict]], Counter]:
    rejections: Counter = Counter()
    completed: list[tuple[list[CandidateSelection], _Verdict]] = []
    beam: list[tuple[int, ...]] = [()]
    index_pool = list(enumerate(pool))
    for _depth in range(config.max_legs):
        ranked: list[tuple[Decimal, tuple[int, ...]]] = []
        for partial in beam:
            start = partial[-1] + 1 if partial else 0
            for idx, selection in index_pool[start:]:
                trial_index = partial + (idx,)
                legs = [pool[position] for position in trial_index]
                verdict = _evaluate_legs(legs, scorelines, config)
                if verdict.reject:
                    rejections[verdict.reject] += 1
                    continue
                assert verdict.joint is not None
                if verdict.odds > config.odds_max:
                    rejections["above_target_odds"] += 1
                    continue
                if verdict.odds >= config.odds_min:
                    completed.append((legs, verdict))
                if len(trial_index) < config.max_legs:
                    ranked.append((_partial_score(strategy, verdict, legs), trial_index))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        beam = [trial for _, trial in ranked[: config.beam_width]]
        if not beam:
            break
    unique: dict[tuple[str, ...], tuple[list[CandidateSelection], _Verdict]] = {}
    for legs, verdict in completed:
        signature = tuple(sorted(_signature(leg) for leg in legs))
        current = unique.get(signature)
        if current is None or _final_sort_key(strategy, verdict, signature) < _final_sort_key(
            strategy, current[1], signature
        ):
            unique[signature] = (legs, verdict)
    ordered = sorted(
        unique.values(),
        key=lambda item: _final_sort_key(strategy, item[1], tuple(sorted(_signature(leg) for leg in item[0]))),
    )
    return ordered, rejections


def _warnings(legs: list[CandidateSelection], method: str) -> list[str]:
    warnings = [
        "Estimated probabilities are not guarantees and are not a recommendation to stake.",
        "Positive estimated value matters only if the probability model is calibrated and the price is still executable.",
    ]
    if method in {"independent_cross_match", "mixed_scoreline_and_cross_match"}:
        warnings.append(
            "Selections from different matches are treated as independent. That is an assumption, not a measured correlation."
        )
    if any(leg.mapping_status == "manual" for leg in legs):
        warnings.append("At least one price was entered manually. Verify it on the bookmaker before using the slip.")
    if any(leg.data_origin == "synthetic_demo" for leg in legs):
        warnings.append("This slip uses synthetic demonstration data and is not a real bookmaker price.")
    if any(leg.data_quality < Decimal("0.60") for leg in legs):
        warnings.append("At least one selection has limited historical sample support.")
    return warnings


def _jaccard(left: set[str], right: set[str]) -> Decimal:
    if not left and not right:
        return Decimal("1")
    return Decimal(len(left & right)) / Decimal(len(left | right))


def build_slips(
    selections: list[CandidateSelection],
    scorelines: dict[str, np.ndarray],
    config: OptimizerConfig,
) -> OptimizerResult:
    base_rejections: Counter = Counter()
    eligible: list[CandidateSelection] = []
    seen: set[str] = set()
    for selection in sorted(selections, key=lambda item: item.selection_id):
        signature = _signature(selection)
        if signature in seen:
            base_rejections["duplicate_selection"] += 1
            continue
        seen.add(signature)
        reason = _hard_reject(selection, config)
        if reason:
            base_rejections[reason] += 1
            continue
        eligible.append(selection)

    ranked_by_strategy: dict[str, list[tuple[list[CandidateSelection], _Verdict]]] = {}
    search_rejections: dict[str, dict[str, int]] = {}
    for strategy in STRATEGIES:
        minimum = config.strategy_min_probability[strategy]
        pool = [selection for selection in eligible if selection.probability >= minimum]
        low = len(eligible) - len(pool)
        ordered, rejections = _search(pool, scorelines, config, strategy)
        rejections["below_strategy_probability"] = low
        ranked_by_strategy[strategy] = ordered
        search_rejections[strategy] = dict(rejections)

    chosen: list[BuiltSlip] = []
    chosen_sets: list[set[str]] = []
    omitted: dict[str, str] = {}
    for strategy in STRATEGIES:
        picked = None
        for legs, verdict in ranked_by_strategy[strategy]:
            identities = {_signature(leg) for leg in legs}
            if any(_jaccard(identities, previous) >= config.max_overlap for previous in chosen_sets):
                continue
            picked = (legs, verdict, identities)
            break
        if picked is None:
            if not ranked_by_strategy[strategy]:
                omitted[strategy] = "No combination met the odds range, probability floor and data rules."
            else:
                omitted[strategy] = "Qualifying combinations overlapped too much with an earlier strategy."
            continue
        legs, verdict, identities = picked
        assert verdict.joint is not None
        value = expected_value(verdict.joint, verdict.odds)
        chosen.append(
            BuiltSlip(
                strategy=strategy,
                label=STRATEGY_LABELS[strategy],
                selections=legs,
                combined_odds=verdict.odds,
                joint_probability=verdict.joint,
                joint_method=verdict.method,
                expected_value=value.quantize(Decimal("0.000001")),
                warnings=_warnings(legs, verdict.method),
                diagnostics={
                    "completed_candidates": len(ranked_by_strategy[strategy]),
                    "rejections": search_rejections[strategy],
                    "signature": sorted(identities),
                },
            )
        )
        chosen_sets.append(identities)

    return OptimizerResult(
        slips=chosen,
        rejections=dict(base_rejections),
        diagnostics={
            "eligible_selections": len(eligible),
            "hard_rejections": dict(base_rejections),
            "by_strategy": search_rejections,
            "omitted": omitted,
            "returned": len(chosen),
            "note": "The optimizer returns fewer than three slips when the constraints require it.",
        },
    )
