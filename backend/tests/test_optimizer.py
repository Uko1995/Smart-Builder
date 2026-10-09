from datetime import UTC, datetime, timedelta
from decimal import Decimal

import numpy as np

from app.engine.markets import derive_goal_markets
from app.engine.scoreline import scoreline_matrix
from app.optimizer.slips import CandidateSelection, OptimizerConfig, build_slips

NOW = datetime(2026, 10, 9, 12, tzinfo=UTC)


def _selection(**overrides) -> CandidateSelection:
    payload = dict(
        selection_id="s",
        fixture_id="f",
        market_key="match_result",
        selection="home",
        line=None,
        decimal_odds=Decimal("2.20"),
        probability=Decimal("0.50"),
        data_quality=Decimal("0.80"),
        captured_at=NOW - timedelta(minutes=10),
        mapping_status="verified",
        implementation_status="supported",
        market_family="goals",
        bookmaker_key="onexbet",
        data_origin="provider",
    )
    payload.update(overrides)
    return CandidateSelection(**payload)


def _config(**overrides) -> OptimizerConfig:
    payload = dict(
        now=NOW,
        freshness=timedelta(hours=3),
        odds_min=Decimal("10"),
        odds_max=Decimal("30"),
        min_quality=Decimal("0.25"),
        max_legs=4,
        beam_width=30,
        strategy_min_probability={
            "probability_led": Decimal("0.40"),
            "balanced_value": Decimal("0.28"),
            "higher_odds": Decimal("0.18"),
        },
    )
    payload.update(overrides)
    return OptimizerConfig(**payload)


def _favorites():
    return [
        _selection(selection_id=f"f{index}", fixture_id=f"fav-{index}", probability=Decimal("0.50"))
        for index in range(3)
    ]


def _value():
    prices = [Decimal("3.40"), Decimal("3.50"), Decimal("3.60")]
    probabilities = [Decimal("0.35"), Decimal("0.33"), Decimal("0.30")]
    return [
        _selection(
            selection_id=f"v{index}",
            fixture_id=f"val-{index}",
            decimal_odds=prices[index],
            probability=probabilities[index],
        )
        for index in range(3)
    ]


def _longshots():
    return [
        _selection(
            selection_id="h0",
            fixture_id="high-0",
            decimal_odds=Decimal("4.50"),
            probability=Decimal("0.22"),
        ),
        _selection(
            selection_id="h1",
            fixture_id="high-1",
            decimal_odds=Decimal("5.00"),
            probability=Decimal("0.20"),
        ),
    ]


def test_three_distinct_strategies_when_evidence_supports_them():
    result = build_slips(_favorites() + _value() + _longshots(), {}, _config())
    assert len(result.slips) == 3
    assert [slip.strategy for slip in result.slips] == [
        "probability_led",
        "balanced_value",
        "higher_odds",
    ]
    for slip in result.slips:
        assert Decimal("10") <= slip.combined_odds <= Decimal("30")
        assert slip.joint_probability is not None
    signatures = [tuple(sorted(item.selection_id for item in slip.selections)) for slip in result.slips]
    assert len(set(signatures)) == 3


def test_optimizer_returns_fewer_than_three_when_candidates_overlap():
    result = build_slips(_favorites(), {}, _config())
    assert len(result.slips) == 1
    assert "No combination" in result.diagnostics["omitted"]["balanced_value"] or "overlapped" in result.diagnostics["omitted"]["balanced_value"]


def test_same_inputs_are_deterministic():
    selections = _favorites() + _value() + _longshots()
    first = build_slips(selections, {}, _config())
    second = build_slips(list(reversed(selections)), {}, _config())
    assert [(slip.strategy, [item.selection_id for item in slip.selections]) for slip in first.slips] == [
        (slip.strategy, [item.selection_id for item in slip.selections]) for slip in second.slips
    ]


def test_stale_and_unmapped_prices_are_rejected():
    stale = [
        _selection(selection_id=f"s{index}", fixture_id=f"stale-{index}", captured_at=NOW - timedelta(hours=5))
        for index in range(3)
    ]
    result = build_slips(stale, {}, _config())
    assert result.slips == []
    assert result.rejections["stale_price"] == 3


def test_contradictory_same_match_selections_are_not_combined():
    matrix = scoreline_matrix(1.4, 1.1, 0)
    derived = {(item["selection"]): item["probability"] for item in derive_goal_markets(matrix) if item["market_key"] == "match_result"}
    selections = [
        _selection(selection_id="home", fixture_id="same", selection="home", probability=derived["home"], decimal_odds=Decimal("4.00")),
        _selection(selection_id="away", fixture_id="same", selection="away", probability=derived["away"], decimal_odds=Decimal("4.00")),
        _selection(selection_id="other", fixture_id="other", probability=Decimal("0.45"), decimal_odds=Decimal("3.00")),
    ]
    result = build_slips(selections, {"same": matrix}, _config(max_legs=2))
    for slip in result.slips:
        identities = {item.selection_id for item in slip.selections}
        assert identities != {"home", "away"}


def test_same_match_goal_joint_is_not_the_independent_product():
    matrix = np.zeros((13, 13))
    matrix[3, 0] = 0.40
    matrix[1, 0] = 0.30
    matrix[0, 0] = 0.30
    home = _selection(
        selection_id="home",
        fixture_id="m",
        selection="home",
        probability=Decimal("0.70000000"),
        decimal_odds=Decimal("3.50"),
    )
    over = _selection(
        selection_id="over",
        fixture_id="m",
        market_key="over_under_goals",
        selection="over",
        line=Decimal("1.5"),
        probability=Decimal("0.40000000"),
        decimal_odds=Decimal("3.20"),
    )
    result = build_slips(
        [home, over],
        {"m": matrix},
        _config(odds_min=Decimal("10"), odds_max=Decimal("30"), strategy_min_probability={
            "probability_led": Decimal("0.40"),
            "balanced_value": Decimal("0.28"),
            "higher_odds": Decimal("0.18"),
        }),
    )
    assert result.slips
    slip = next(item for item in result.slips if {leg.selection_id for leg in item.selections} == {"home", "over"})
    independent = Decimal("0.70000000") * Decimal("0.40000000")
    assert slip.joint_probability != independent
    assert slip.joint_probability == Decimal("0.40000000")
    assert slip.joint_method == "scoreline_joint"
