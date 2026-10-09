"""Bookmaker-independent market definitions.

Implementation status describes the model, not a particular bookmaker.
Provider coverage and bookmaker mapping are tracked separately.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class MarketDefinitionData:
    key: str
    display_name: str
    family: str
    period: str
    line_required: bool
    selections: tuple[str, ...]
    settlement: str
    required_data: str
    implementation_status: str
    enabled: bool = True


@dataclass(frozen=True)
class BookmakerData:
    key: str
    name: str
    is_synthetic: bool
    notes: str


@dataclass(frozen=True)
class MappingData:
    bookmaker_key: str
    market_key: str
    provider_market_key: str
    status: str
    notes: str


MARKETS: tuple[MarketDefinitionData, ...] = (
    MarketDefinitionData(
        key="match_result",
        display_name="Match result",
        family="goals",
        period="full_time",
        line_required=False,
        selections=("home", "draw", "away"),
        settlement="Home, draw or away from the full-time score after 90 minutes plus stoppage time. Extra time is excluded.",
        required_data="Full-time goals for historical matches in the same competition.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="double_chance",
        display_name="Double chance",
        family="goals",
        period="full_time",
        line_required=False,
        selections=("home_or_draw", "home_or_away", "draw_or_away"),
        settlement="Wins if either of the two named full-time outcomes occurs.",
        required_data="The same full-time scoreline distribution as the match result.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="draw_no_bet",
        display_name="Draw no bet",
        family="goals",
        period="full_time",
        line_required=False,
        selections=("home", "away"),
        settlement="Stake is returned on a draw. Otherwise the full-time winner is settled.",
        required_data="Full-time scoreline distribution. Void handling makes this unsuitable for multi-leg slips.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="over_under_goals",
        display_name="Over/under goals",
        family="goals",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares the full-time goal total with the stated half-goal line. Half-goal lines have no push.",
        required_data="Full-time scoreline distribution.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="btts",
        display_name="Both teams to score",
        family="goals",
        period="full_time",
        line_required=False,
        selections=("yes", "no"),
        settlement="Yes if both teams score at least one full-time goal.",
        required_data="Full-time scoreline distribution.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="asian_handicap",
        display_name="Asian handicap (half-goal lines)",
        family="goals",
        period="full_time",
        line_required=True,
        selections=("home", "away"),
        settlement="Half-goal lines are settled from the full-time score with no push. The line is quoted from the home side.",
        required_data="Full-time scoreline distribution.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="asian_handicap_integer",
        display_name="Asian handicap (integer lines)",
        family="goals",
        period="full_time",
        line_required=True,
        selections=("home", "away"),
        settlement="Integer lines can push and return the stake. Experimental because accumulator void rules differ by bookmaker.",
        required_data="Full-time scoreline distribution.",
        implementation_status="experimental",
    ),
    MarketDefinitionData(
        key="correct_score",
        display_name="Correct score",
        family="goals",
        period="full_time",
        line_required=False,
        selections=tuple(f"{h}-{a}" for h in range(5) for a in range(5)),
        settlement="Wins only on the exact full-time score. Listed scores are a subset, not a partition of all scorelines.",
        required_data="Full-time scoreline distribution.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="team_total_home",
        display_name="Home team goals",
        family="goals",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares home full-time goals with the stated half-goal line.",
        required_data="Full-time scoreline distribution.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="team_total_away",
        display_name="Away team goals",
        family="goals",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares away full-time goals with the stated half-goal line.",
        required_data="Full-time scoreline distribution.",
        implementation_status="supported",
    ),
    MarketDefinitionData(
        key="first_half_result",
        display_name="First-half result",
        family="goals",
        period="first_half",
        line_required=False,
        selections=("home", "draw", "away"),
        settlement="Home, draw or away from the half-time score.",
        required_data="Historical half-time scores. Not inferred from full-time scores.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="first_half_over_under",
        display_name="First-half goals",
        family="goals",
        period="first_half",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares the half-time goal total with the stated half-goal line.",
        required_data="Historical half-time scores.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="htft",
        display_name="Half-time/full-time",
        family="goals",
        period="full_time",
        line_required=False,
        selections=("home_home", "home_draw", "home_away", "draw_home", "draw_draw", "draw_away", "away_home", "away_draw", "away_away"),
        settlement="Requires a joint half-time and full-time model. Multiplying separate half-time and full-time probabilities is not used.",
        required_data="A validated joint half-time and full-time distribution.",
        implementation_status="unsupported",
    ),
    MarketDefinitionData(
        key="match_corners",
        display_name="Match corners",
        family="corners",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares the match corner total with the stated half-corner line.",
        required_data="Historical match corner counts for both teams.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="team_corners_home",
        display_name="Home team corners",
        family="corners",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares home corner count with the stated line.",
        required_data="Historical team corner counts.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="team_corners_away",
        display_name="Away team corners",
        family="corners",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares away corner count with the stated line.",
        required_data="Historical team corner counts.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="corner_handicap",
        display_name="Corner handicap",
        family="corners",
        period="full_time",
        line_required=True,
        selections=("home", "away"),
        settlement="Half-corner handicap settled from team corner counts.",
        required_data="Historical team corner counts and a corner count model.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="match_cards",
        display_name="Match cards",
        family="cards",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares total cards with the stated line. Only produced when card counts are sufficiently complete.",
        required_data="Match-level card counts and enough competition history.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="team_cards_home",
        display_name="Home team cards",
        family="cards",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares home cards with the stated line.",
        required_data="Team card counts.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="team_cards_away",
        display_name="Away team cards",
        family="cards",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Compares away cards with the stated line.",
        required_data="Team card counts.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="player_shots",
        display_name="Player shots",
        family="player",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Requires player shot history, expected minutes and lineup evidence.",
        required_data="Player-match shot statistics and expected playing time.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="player_shots_on_target",
        display_name="Player shots on target",
        family="player",
        period="full_time",
        line_required=True,
        selections=("over", "under"),
        settlement="Requires player shots-on-target history and expected minutes.",
        required_data="Player-match shots on target and expected playing time.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="player_goals",
        display_name="Player goals",
        family="player",
        period="full_time",
        line_required=False,
        selections=("anytime",),
        settlement="Not estimated. Scoring rates without minutes and lineup evidence would be invented.",
        required_data="Player goal history, expected minutes and lineup availability.",
        implementation_status="insufficient_data",
    ),
    MarketDefinitionData(
        key="player_assists",
        display_name="Player assists",
        family="player",
        period="full_time",
        line_required=False,
        selections=("anytime",),
        settlement="Not estimated without player assist history and expected minutes.",
        required_data="Player assist history and expected playing time.",
        implementation_status="insufficient_data",
    ),
)

MARKET_BY_KEY = {item.key: item for item in MARKETS}

GOAL_MARKET_KEYS = {item.key for item in MARKETS if item.family == "goals" and item.period == "full_time"}
SLIP_EXCLUDED_MARKETS = {"draw_no_bet", "asian_handicap_integer", "htft", "correct_score"}
# Correct score is supported as a prediction but excluded from multi-leg search by default
# because the grid joint is valid while the prices are sparse. It can be enabled later.
# Actually the spec wants selected correct-score outcomes available. They can be in slips
# if odds exist and joint is from the scoreline. I'll allow correct_score in slips.
SLIP_EXCLUDED_MARKETS = {"draw_no_bet", "asian_handicap_integer", "htft"}

BOOKMAKERS: tuple[BookmakerData, ...] = (
    BookmakerData(
        key="bet9ja",
        name="Bet9ja",
        is_synthetic=False,
        notes="No authorized odds feed is configured. Manual prices can be recorded and must be verified on Bet9ja.",
    ),
    BookmakerData(
        key="sportybet",
        name="SportyBet",
        is_synthetic=False,
        notes="No authorized odds feed is configured. Manual prices can be recorded and must be verified on SportyBet.",
    ),
    BookmakerData(
        key="onexbet",
        name="1xBet",
        is_synthetic=False,
        notes="Prices are used only when returned by The Odds API bookmaker key onexbet for a verified market mapping.",
    ),
    BookmakerData(
        key="demo_book",
        name="Demo Book (synthetic)",
        is_synthetic=True,
        notes="Synthetic demonstration prices. Not a real bookmaker and not usable for staking.",
    ),
)

MAPPINGS: tuple[MappingData, ...] = (
    MappingData(
        bookmaker_key="onexbet",
        market_key="match_result",
        provider_market_key="h2h",
        status="verified",
        notes="The Odds API documents h2h outcomes as home, draw and away for soccer.",
    ),
    MappingData(
        bookmaker_key="onexbet",
        market_key="over_under_goals",
        provider_market_key="totals",
        status="verified",
        notes="The Odds API totals market uses Over/Under and a point line. A price is still absent until that market is collected.",
    ),
    MappingData(
        bookmaker_key="onexbet",
        market_key="asian_handicap",
        provider_market_key="spreads",
        status="mapping_required",
        notes="Soccer spread settlement is not treated as verified. Prices with this mapping are stored but excluded from slips.",
    ),
    MappingData(
        bookmaker_key="bet9ja",
        market_key="match_result",
        provider_market_key="manual",
        status="mapping_required",
        notes="No documented Bet9ja market feed is configured.",
    ),
    MappingData(
        bookmaker_key="sportybet",
        market_key="match_result",
        provider_market_key="manual",
        status="mapping_required",
        notes="No documented SportyBet market feed is configured.",
    ),
    MappingData(
        bookmaker_key="demo_book",
        market_key="match_result",
        provider_market_key="synthetic_h2h",
        status="verified",
        notes="Synthetic demonstration mapping only.",
    ),
    MappingData(
        bookmaker_key="demo_book",
        market_key="over_under_goals",
        provider_market_key="synthetic_totals",
        status="verified",
        notes="Synthetic demonstration mapping only.",
    ),
)

PROVIDERS = (
    {"key": "api_football", "name": "API-Football", "kind": "fixtures"},
    {"key": "the_odds_api", "name": "The Odds API", "kind": "odds"},
    {"key": "football_data_org", "name": "football-data.org", "kind": "fixtures"},
    {"key": "manual", "name": "Manual import", "kind": "manual"},
    {"key": "synthetic_demo", "name": "Synthetic demonstration", "kind": "demo"},
)

MODEL_VERSION_KEY = "poisson-dc-v1"
FEATURE_VERSION = "team-strength-v1"
MODEL_DESCRIPTION = (
    "Independent Poisson team-strength baseline with an optional Dixon-Coles "
    "low-score adjustment. Strengths are time-weighted attack and defence ratios. "
    "Rho is estimated only when the pre-match sample meets the configured minimum; "
    "otherwise rho is zero and that choice is stored on the feature snapshot."
)
