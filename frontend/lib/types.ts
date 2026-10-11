export type DailyPick = {
  fixture_id: number | null;
  match: string | null;
  home: string | null;
  away: string | null;
  league: string | null;
  kickoff_at: string | null;
  market_key: string;
  market_name: string | null;
  selection: string;
  line: string | null;
  model_probability: string;
  implied_probability: string;
  decimal_odds: string;
  captured_at: string | null;
  bookmaker: string | null;
  data_quality: string | null;
  sample_size: number;
  sample_note: string;
  disagreement: boolean;
  conservative: boolean;
  data_origin: string;
};

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
  picks: DailyPick[];
  picks_note?: string;
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
    predictions: Array<{
      market_key: string;
      selection: string;
      line: string | null;
      probability: string | null;
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

export type PerformanceReport = {
  settled_real: MetricGroup;
  settled_synthetic: MetricGroup;
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
