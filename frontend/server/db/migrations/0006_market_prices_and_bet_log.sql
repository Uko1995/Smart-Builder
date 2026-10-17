-- Per-bookmaker 1X2 and over/under 2.5 prices from football-data.co.uk, one row per
-- fixture, bookmaker, phase and capture time. Wide rows keep the history small enough for Neon's free tier.
CREATE TABLE IF NOT EXISTS market_prices (
  fixture_id bigint NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  bookmaker varchar(24) NOT NULL,
  phase varchar(8) NOT NULL,
  captured_at timestamptz NOT NULL,
  captured_at_estimated boolean NOT NULL,
  home numeric(8,3),
  draw numeric(8,3),
  away numeric(8,3),
  over_2_5 numeric(8,3),
  under_2_5 numeric(8,3),
  CONSTRAINT ck_market_prices_phase CHECK (phase IN ('early', 'closing')),
  PRIMARY KEY (fixture_id, bookmaker, phase, captured_at)
);

-- Edge backtests and the segments they approve. The value board only shows approved segments.
CREATE TABLE IF NOT EXISTS edge_backtests (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  config jsonb NOT NULL,
  report jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_segments (
  backtest_id integer NOT NULL REFERENCES edge_backtests(id) ON DELETE CASCADE,
  segment_key varchar(120) NOT NULL,
  league_id bigint REFERENCES leagues(id),
  market varchar(8) NOT NULL,
  source varchar(8) NOT NULL,
  price_basis varchar(16) NOT NULL,
  approved boolean NOT NULL,
  stats jsonb NOT NULL,
  PRIMARY KEY (backtest_id, segment_key)
);

-- Recommended bets, written before kick-off and never changed afterwards.
-- Closing prices and results are joined in at read time, so nothing here is edited.
CREATE TABLE IF NOT EXISTS bet_log (
  id bigserial PRIMARY KEY,
  fixture_id bigint NOT NULL REFERENCES fixtures(id),
  market varchar(8) NOT NULL,
  selection varchar(8) NOT NULL,
  segment_key varchar(120) NOT NULL,
  source varchar(8) NOT NULL,
  probability numeric(10,8) NOT NULL,
  price numeric(8,3) NOT NULL,
  bookmaker varchar(24) NOT NULL,
  price_captured_at timestamptz NOT NULL,
  edge numeric(10,6) NOT NULL,
  stake_units numeric(10,4) NOT NULL,
  bankroll_units numeric(12,2) NOT NULL,
  kickoff_at timestamptz NOT NULL,
  backtest_id integer REFERENCES edge_backtests(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_bet_log_before_kickoff CHECK (recorded_at < kickoff_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bet_log_once ON bet_log (fixture_id, market, selection);

CREATE OR REPLACE FUNCTION bet_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bet_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_bet_log_no_update ON bet_log;
CREATE TRIGGER tr_bet_log_no_update BEFORE UPDATE OR DELETE ON bet_log FOR EACH ROW EXECUTE FUNCTION bet_log_append_only();
DROP TRIGGER IF EXISTS tr_bet_log_no_truncate ON bet_log;
CREATE TRIGGER tr_bet_log_no_truncate BEFORE TRUNCATE ON bet_log FOR EACH STATEMENT EXECUTE FUNCTION bet_log_append_only();
