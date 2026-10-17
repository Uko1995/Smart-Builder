export type PredictionRun = {
  public_id: string;
  scope_date: string;
  status: string;
  warnings: string[];
  diagnostics: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  source_data_cutoff: string | null;
  time_budget_seconds: number;
  created?: boolean;
};

export type FixtureRow = {
  id: number;
  kickoff_at: string | null;
  status: string;
  league: string | null;
  home: string | null;
  away: string | null;
  home_goals: number | null;
  away_goals: number | null;
  data_origin: string;
};

export type Overview = {
  timezone: string;
  scope_date: string;
  generated_at: string;
  providers: Array<{
    key: string;
    name: string;
    configured: boolean;
    health_status: string;
    quota_remaining: number | null;
    last_error: string | null;
  }>;
  fixture_counts: { scheduled: number; completed: number; synthetic: number };
  fixtures: FixtureRow[];
  latest_odds_captured_at: string | null;
  latest_run: PredictionRun | null;
  warnings: string[];
  recent_performance: { settled_predictions: number; note: string };
  settings?: { allow_synthetic: boolean; odds_freshness_minutes: number };
};

export type ExplorerRow = FixtureRow & {
  fixture_id: number;
  market_key: string;
  market_name: string | null;
  family: string | null;
  selection: string;
  line: string | null;
  probability: string | null;
  elo_probability?: string | null;
  fair_odds: string | null;
  decimal_odds: string | null;
  implied_probability: string | null;
  captured_at: string | null;
  bookmaker: string | null;
  implementation_status: string;
  data_quality: string | null;
  model_version: string | null;
  estimated_value: string | null;
};

export type MarketRow = {
  key: string;
  display_name: string;
  family: string;
  implementation_status: string;
  required_data: string;
  settlement: string;
  enabled: boolean;
};

export type Coverage = {
  providers: Overview["providers"];
  leagues: Array<{ id: number; name: string; data_origin: string }>;
  markets: MarketRow[];
  mappings: Array<{
    bookmaker: string | null;
    market_key: string | null;
    provider_market_key: string;
    status: string;
    notes: string;
  }>;
  settings: Record<string, string | number | boolean>;
  secrets: {
    api_football_configured: boolean;
    odds_api_configured: boolean;
    football_data_configured: boolean;
  };
};

export type MatchDetail = {
  fixture: FixtureRow;
  measured: {
    home_form: string[];
    away_form: string[];
    home_record: { matches: number; goals_for: number; goals_against: number };
    away_record: { matches: number; goals_for: number; goals_against: number };
    match_statistics: {
      home_corners: number | null;
      away_corners: number | null;
      home_cards: number | null;
      away_cards: number | null;
      home_xg: string | null;
      away_xg: string | null;
      source: string;
    } | null;
  };
  model: {
    available: boolean;
    model_version: string | null;
    scoreline: number[][] | null;
    elo?: { home: number; draw: number; away: number } | null;
    predictions: Array<{
      market_key: string;
      selection: string;
      line: string | null;
      probability: string | null;
      elo_probability?: string | null;
      fair_odds: string | null;
      implementation_status: string;
      data_quality: string | null;
      sample_size: number;
    }>;
    note: string;
  };
  unavailable_markets: Array<{
    key: string;
    display_name: string;
    implementation_status: string;
    required_data: string;
  }>;
};

export type MetricGroup = {
  status: string;
  observations: number;
  by_market?: Record<string, { status: string; observations: number; brier_score?: number; log_loss?: number }>;
};

export type HitRate = { observations: number; mean_probability: number | null; hit_rate: number | null };

export type HeadToHead = {
  status: string;
  observations: number;
  model?: { brier_score: number; log_loss: number };
  other?: { brier_score: number; log_loss: number };
};

export type CalibrationReport = {
  status: string;
  observations: number;
  min_pick_probability: number;
  buckets: Array<HitRate & { low: number; high: number }>;
  picks: HitRate;
  by_market: Record<string, { all: HitRate; picks: HitRate }>;
  model_vs_market: HeadToHead;
  model_vs_elo: HeadToHead;
  note: string;
};

export type PerformanceReport = {
  settled_real: MetricGroup;
  settled_synthetic: MetricGroup;
  calibration?: CalibrationReport;
  evaluation_runs: Array<{
    id: number;
    status: string;
    metrics: Record<string, unknown>;
    sample_sizes: Record<string, unknown>;
    notes: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>;
  simulated_returns: {
    status: string;
    observations: number;
    note?: string;
    profit_units?: string;
    max_drawdown_units?: string;
    stake?: string;
    disclaimer?: string;
  };
  disclaimer: string;
};

export type IngestionRun = {
  id: number;
  provider: string | null;
  kind: string;
  status: string;
  records_written: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type Interval = { estimate: number; low: number; high: number };

export type ValueBet = {
  fixture_id: number;
  match: string;
  league: string | null;
  kickoff_at: string | null;
  market: "1x2" | "ou25";
  selection: string;
  source: "model" | "elo" | "blend";
  price_basis: string;
  segment_key: string;
  probability: number;
  price: number;
  bookmaker: string;
  price_captured_at: string | null;
  edge: number;
  stake_fraction: number;
  stake_units: number;
  backtest_clv: Interval | null;
  backtest_bets: number;
};

export type ValueBoard = {
  scope_date: string;
  threshold: number;
  bankroll_units: number;
  backtest: { id: number; created_at: string | null; test_seasons: string[] } | null;
  approved_segments: Array<{ key: string; bets: number; clv: Interval | null }>;
  bets: ValueBet[];
  candidates_checked: number;
  note: string;
};

export type BetSummary = {
  bets: number;
  with_closing_price: number;
  clv: Interval | null;
  settled: number;
  profit_units: number;
  roi: Interval | null;
};

export type BetRecord = {
  overall: BetSummary;
  segments: Array<BetSummary & { segment_key: string }>;
  bets: Array<{
    id: number;
    fixture_id: number;
    match: string;
    market: string;
    selection: string;
    segment_key: string;
    price: number;
    bookmaker: string;
    edge: number;
    stake_units: number;
    kickoff_at: string | null;
    recorded_at: string | null;
    closing_source: string | null;
    fair_closing_probability: number | null;
    clv: number | null;
    result: "won" | "lost" | null;
    profit_units: number | null;
  }>;
  note: string;
};

export type EdgeSegment = {
  segment_key: string;
  league: string;
  market: string;
  source: string;
  price_basis: string;
  approved: boolean;
  bets: number;
  profit_units: number;
  roi: Interval | null;
  clv: Interval | null;
  confirmation: { bets: number; mean_clv: number | null };
  control_clv: number | null;
};

export type EdgeBacktestSummary = {
  backtest: {
    id: number;
    created_at: string | null;
    config: { test_seasons?: string[]; threshold?: number; confirmation_from?: string; benchmark?: string };
    multiple_testing: { segments_with_enough_bets: number; expected_false_passes_at_2_5_percent: number; passing_clv_rule: number; beating_control: number; approved: number };
  } | null;
  log_loss?: Array<{
    market_key: string;
    matches?: number;
    closing?: number;
    model?: { matches: number; log_loss: number; minus_closing: Interval | null };
    elo?: { matches: number; log_loss: number; minus_closing: Interval | null };
    blend?: { matches: number; log_loss: number; minus_closing: Interval | null };
    market?: { matches: number; log_loss: number; minus_closing: Interval | null };
  }>;
  aggregate?: EdgeSegment[];
  approved?: EdgeSegment[];
  leaders?: EdgeSegment[];
};

export type Forecast = { selection: string; model: number; elo: number | null; market: number | null; best: number };

export type ForecastBoard = {
  scope_date: string;
  matches: Array<{
    fixture_id: number;
    kickoff_at: string | null;
    status: string;
    league: string | null;
    home: string | null;
    away: string | null;
    score: string | null;
    markets: Record<string, Forecast[]>;
  }>;
  note: string;
};

export type PaperStrategy = {
  key: string;
  name: string;
  rule: string;
  bets: number;
  open: number;
  settled: number;
  won: number;
  staked_units: number;
  profit_units: number;
  bankroll_units: number;
  max_drawdown_units: number;
  roi: Interval | null;
  clv: Interval | null;
  with_clv: number;
  curve: Array<{ at: string | null; bankroll: number }>;
};

export type PaperBet = {
  id: number;
  strategy: string;
  fixture_id: number;
  match: string;
  league: string | null;
  market: "1x2" | "ou25";
  selection: string;
  probability: number;
  price: number;
  bookmaker: string;
  edge: number;
  stake_units: number;
  kickoff_at: string | null;
  recorded_at: string | null;
  score: string | null;
  result: "won" | "lost" | null;
  profit_units: number | null;
  clv: number | null;
};

export type PaperReport = { starting_bankroll_units: number; strategies: PaperStrategy[]; bets: PaperBet[]; note: string };
