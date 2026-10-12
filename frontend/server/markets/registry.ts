/**
 * Bookmaker-independent market definitions. Implementation status describes
 * the model, not a particular bookmaker.
 */

export type MarketDefinition = {
  key: string;
  displayName: string;
  family: "goals" | "corners" | "cards" | "player";
  period: "full_time" | "first_half";
  lineRequired: boolean;
  selections: string[];
  settlement: string;
  requiredData: string;
  implementationStatus: "supported" | "experimental" | "insufficient_data" | "unsupported";
  enabled: boolean;
};

type Draft = Omit<MarketDefinition, "enabled"> & { enabled?: boolean };

const CORRECT_SCORES = Array.from({ length: 25 }, (_, index) => `${Math.floor(index / 5)}-${index % 5}`);

const DRAFTS: Draft[] = [
  {
    key: "match_result",
    displayName: "Match result",
    family: "goals",
    period: "full_time",
    lineRequired: false,
    selections: ["home", "draw", "away"],
    settlement: "Home, draw or away from the full-time score after 90 minutes plus stoppage time. Extra time is excluded.",
    requiredData: "Full-time goals for historical matches in the same competition.",
    implementationStatus: "supported",
  },
  {
    key: "double_chance",
    displayName: "Double chance",
    family: "goals",
    period: "full_time",
    lineRequired: false,
    selections: ["home_or_draw", "home_or_away", "draw_or_away"],
    settlement: "Wins if either of the two named full-time outcomes occurs.",
    requiredData: "The same full-time scoreline distribution as the match result.",
    implementationStatus: "supported",
  },
  {
    key: "draw_no_bet",
    displayName: "Draw no bet",
    family: "goals",
    period: "full_time",
    lineRequired: false,
    selections: ["home", "away"],
    settlement: "Stake is returned on a draw. Otherwise the full-time winner is settled.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "supported",
  },
  {
    key: "over_under_goals",
    displayName: "Over/under goals",
    family: "goals",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares the full-time goal total with the stated half-goal line. Half-goal lines have no push.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "supported",
  },
  {
    key: "btts",
    displayName: "Both teams to score",
    family: "goals",
    period: "full_time",
    lineRequired: false,
    selections: ["yes", "no"],
    settlement: "Yes if both teams score at least one full-time goal.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "supported",
  },
  {
    key: "asian_handicap",
    displayName: "Asian handicap (half-goal lines)",
    family: "goals",
    period: "full_time",
    lineRequired: true,
    selections: ["home", "away"],
    settlement: "Half-goal lines are settled from the full-time score with no push. The line is quoted from the home side.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "supported",
  },
  {
    key: "asian_handicap_integer",
    displayName: "Asian handicap (integer lines)",
    family: "goals",
    period: "full_time",
    lineRequired: true,
    selections: ["home", "away"],
    settlement: "Integer lines can push and return the stake.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "experimental",
  },
  {
    key: "correct_score",
    displayName: "Correct score",
    family: "goals",
    period: "full_time",
    lineRequired: false,
    selections: CORRECT_SCORES,
    settlement: "Wins only on the exact full-time score. Listed scores are a subset, not a partition of all scorelines.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "supported",
  },
  {
    key: "team_total_home",
    displayName: "Home team goals",
    family: "goals",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares home full-time goals with the stated half-goal line.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "supported",
  },
  {
    key: "team_total_away",
    displayName: "Away team goals",
    family: "goals",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares away full-time goals with the stated half-goal line.",
    requiredData: "Full-time scoreline distribution.",
    implementationStatus: "supported",
  },
  {
    key: "first_half_result",
    displayName: "First-half result",
    family: "goals",
    period: "first_half",
    lineRequired: false,
    selections: ["home", "draw", "away"],
    settlement: "Home, draw or away from the half-time score.",
    requiredData: "Historical half-time scores. Not inferred from full-time scores.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "first_half_over_under",
    displayName: "First-half goals",
    family: "goals",
    period: "first_half",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares the half-time goal total with the stated half-goal line.",
    requiredData: "Historical half-time scores.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "htft",
    displayName: "Half-time/full-time",
    family: "goals",
    period: "full_time",
    lineRequired: false,
    selections: ["home_home", "home_draw", "home_away", "draw_home", "draw_draw", "draw_away", "away_home", "away_draw", "away_away"],
    settlement: "Requires a joint half-time and full-time model. Multiplying separate half-time and full-time probabilities is not used.",
    requiredData: "A validated joint half-time and full-time distribution.",
    implementationStatus: "unsupported",
  },
  {
    key: "match_corners",
    displayName: "Match corners",
    family: "corners",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares the match corner total with the stated half-corner line.",
    requiredData: "Historical match corner counts for both teams.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "team_corners_home",
    displayName: "Home team corners",
    family: "corners",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares home corner count with the stated line.",
    requiredData: "Historical team corner counts.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "team_corners_away",
    displayName: "Away team corners",
    family: "corners",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares away corner count with the stated line.",
    requiredData: "Historical team corner counts.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "corner_handicap",
    displayName: "Corner handicap",
    family: "corners",
    period: "full_time",
    lineRequired: true,
    selections: ["home", "away"],
    settlement: "Half-corner handicap settled from team corner counts.",
    requiredData: "Historical team corner counts and a corner count model.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "match_cards",
    displayName: "Match cards",
    family: "cards",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares total cards with the stated line. Only produced when card counts are sufficiently complete.",
    requiredData: "Match-level card counts and enough competition history.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "team_cards_home",
    displayName: "Home team cards",
    family: "cards",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares home cards with the stated line.",
    requiredData: "Team card counts.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "team_cards_away",
    displayName: "Away team cards",
    family: "cards",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Compares away cards with the stated line.",
    requiredData: "Team card counts.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "player_shots",
    displayName: "Player shots",
    family: "player",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Requires player shot history, expected minutes and lineup evidence.",
    requiredData: "Player-match shot statistics and expected playing time.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "player_shots_on_target",
    displayName: "Player shots on target",
    family: "player",
    period: "full_time",
    lineRequired: true,
    selections: ["over", "under"],
    settlement: "Requires player shots-on-target history and expected minutes.",
    requiredData: "Player-match shots on target and expected playing time.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "player_goals",
    displayName: "Player goals",
    family: "player",
    period: "full_time",
    lineRequired: false,
    selections: ["anytime"],
    settlement: "Not estimated. Scoring rates without minutes and lineup evidence would be invented.",
    requiredData: "Player goal history, expected minutes and lineup availability.",
    implementationStatus: "insufficient_data",
  },
  {
    key: "player_assists",
    displayName: "Player assists",
    family: "player",
    period: "full_time",
    lineRequired: false,
    selections: ["anytime"],
    settlement: "Not estimated without player assist history and expected minutes.",
    requiredData: "Player assist history and expected playing time.",
    implementationStatus: "insufficient_data",
  },
];

export const MARKETS: MarketDefinition[] = DRAFTS.map((draft) => ({ enabled: true, ...draft }));
export const MARKET_BY_KEY: Record<string, MarketDefinition> = Object.fromEntries(MARKETS.map((item) => [item.key, item]));

export type BookmakerSeed = { key: string; name: string; isSynthetic: boolean; notes: string };

export const BOOKMAKERS: BookmakerSeed[] = [
  {
    key: "bet9ja",
    name: "Bet9ja",
    isSynthetic: false,
    notes: "No authorized odds feed is configured. Manual prices can be recorded and must be verified on Bet9ja.",
  },
  {
    key: "sportybet",
    name: "SportyBet",
    isSynthetic: false,
    notes: "No authorized odds feed is configured. Manual prices can be recorded and must be verified on SportyBet.",
  },
  {
    key: "onexbet",
    name: "1xBet",
    isSynthetic: false,
    notes: "Prices are used only when returned by The Odds API bookmaker key onexbet for a verified market mapping.",
  },
  {
    key: "market_average",
    name: "Market average",
    isSynthetic: false,
    notes:
      "Average price across the bookmakers football-data.co.uk tracks, from its upcoming-fixtures files. " +
      "Published about twice a week, so it is a reference price; check the live price before staking.",
  },
  {
    key: "demo_book",
    name: "Demo Book (synthetic)",
    isSynthetic: true,
    notes: "Synthetic demonstration prices. Not a real bookmaker and not usable for staking.",
  },
];

export type MappingSeed = { bookmakerKey: string; marketKey: string; providerMarketKey: string; status: string; notes: string };

export const MAPPINGS: MappingSeed[] = [
  { bookmakerKey: "onexbet", marketKey: "match_result", providerMarketKey: "h2h", status: "verified", notes: "The Odds API documents h2h outcomes as home, draw and away for soccer." },
  { bookmakerKey: "onexbet", marketKey: "over_under_goals", providerMarketKey: "totals", status: "verified", notes: "The Odds API totals market uses Over/Under and a point line." },
  { bookmakerKey: "onexbet", marketKey: "over_under_goals", providerMarketKey: "alternate_totals", status: "verified", notes: "Per-event alternate lines. Only half-goal lines are mapped; quarter and integer lines stay unmapped." },
  { bookmakerKey: "onexbet", marketKey: "btts", providerMarketKey: "btts", status: "verified", notes: "Per-event market with Yes/No outcomes." },
  { bookmakerKey: "onexbet", marketKey: "asian_handicap", providerMarketKey: "spreads", status: "mapping_required", notes: "Soccer spread settlement is not treated as verified." },
  { bookmakerKey: "market_average", marketKey: "match_result", providerMarketKey: "AvgH/AvgD/AvgA", status: "verified", notes: "football-data.co.uk average home, draw and away prices." },
  { bookmakerKey: "market_average", marketKey: "over_under_goals", providerMarketKey: "Avg>2.5/Avg<2.5", status: "verified", notes: "Over/under 2.5 goals only. Main-league file only." },
  { bookmakerKey: "bet9ja", marketKey: "match_result", providerMarketKey: "manual", status: "mapping_required", notes: "No documented Bet9ja market feed is configured." },
  { bookmakerKey: "sportybet", marketKey: "match_result", providerMarketKey: "manual", status: "mapping_required", notes: "No documented SportyBet market feed is configured." },
  { bookmakerKey: "demo_book", marketKey: "match_result", providerMarketKey: "synthetic_h2h", status: "verified", notes: "Synthetic demonstration mapping only." },
  { bookmakerKey: "demo_book", marketKey: "over_under_goals", providerMarketKey: "synthetic_totals", status: "verified", notes: "Synthetic demonstration mapping only." },
];

export const PROVIDERS = [
  { key: "api_football", name: "API-Football", kind: "fixtures" },
  { key: "the_odds_api", name: "The Odds API", kind: "odds" },
  { key: "football_data_org", name: "football-data.org", kind: "fixtures" },
  { key: "football_data_co_uk", name: "football-data.co.uk", kind: "fixtures" },
  { key: "manual", name: "Manual import", kind: "manual" },
  { key: "synthetic_demo", name: "Synthetic demonstration", kind: "demo" },
] as const;

export const MODEL_VERSION_KEY = "poisson-dc-v2";
export const FEATURE_VERSION = "team-strength-v2";
export const MODEL_DESCRIPTION =
  "Independent Poisson team-strength baseline with an optional Dixon-Coles " +
  "low-score adjustment. Strengths are time-weighted attack and defence ratios, " +
  "shrunk toward the league average by eight full-weight matches. " +
  "Rho is estimated only when the pre-match sample meets the configured minimum; " +
  "otherwise rho is zero and that choice is stored on the feature snapshot.";

export function marketCatalog() {
  return MARKETS.map((item) => ({
    key: item.key,
    display_name: item.displayName,
    family: item.family,
    period: item.period,
    line_required: item.lineRequired,
    selections: item.selections,
    settlement: item.settlement,
    required_data: item.requiredData,
    implementation_status: item.implementationStatus,
    enabled: item.enabled,
  }));
}
