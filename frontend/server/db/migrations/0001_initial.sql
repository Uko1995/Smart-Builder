-- Same tables and constraint names as the original Python schema, so an
-- existing database can be pointed at this app without a data migration.

CREATE TABLE IF NOT EXISTS providers (
  id bigserial PRIMARY KEY,
  key varchar(64) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  kind varchar(32) NOT NULL,
  configured boolean NOT NULL DEFAULT false,
  health_status varchar(32) NOT NULL DEFAULT 'not_configured',
  last_checked_at timestamptz,
  last_error text,
  quota_remaining integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leagues (
  id bigserial PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES providers(id),
  external_id varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  country varchar(80),
  data_origin varchar(32) NOT NULL DEFAULT 'provider',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_league_external UNIQUE (provider_id, external_id)
);

CREATE TABLE IF NOT EXISTS seasons (
  id bigserial PRIMARY KEY,
  league_id bigint NOT NULL REFERENCES leagues(id),
  name varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_season_name UNIQUE (league_id, name)
);

CREATE TABLE IF NOT EXISTS teams (
  id bigserial PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES providers(id),
  external_id varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  normalized_name varchar(160) NOT NULL,
  data_origin varchar(32) NOT NULL DEFAULT 'provider',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_team_external UNIQUE (provider_id, external_id)
);

CREATE TABLE IF NOT EXISTS fixtures (
  id bigserial PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES providers(id),
  external_id varchar(80) NOT NULL,
  league_id bigint NOT NULL REFERENCES leagues(id),
  season_id bigint NOT NULL REFERENCES seasons(id),
  home_team_id bigint NOT NULL REFERENCES teams(id),
  away_team_id bigint NOT NULL REFERENCES teams(id),
  kickoff_at timestamptz NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'scheduled',
  home_goals integer,
  away_goals integer,
  ht_home_goals integer,
  ht_away_goals integer,
  data_origin varchar(32) NOT NULL DEFAULT 'provider',
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fixture_external UNIQUE (provider_id, external_id),
  CONSTRAINT ck_fixture_status CHECK (status IN ('scheduled','completed','postponed','cancelled','unknown'))
);
CREATE INDEX IF NOT EXISTS ix_fixtures_kickoff ON fixtures (kickoff_at);

CREATE TABLE IF NOT EXISTS match_statistics (
  id bigserial PRIMARY KEY,
  fixture_id bigint NOT NULL UNIQUE REFERENCES fixtures(id),
  home_corners integer,
  away_corners integer,
  home_cards integer,
  away_cards integer,
  home_xg numeric(6,3),
  away_xg numeric(6,3),
  home_shots integer,
  away_shots integer,
  home_shots_on_target integer,
  away_shots_on_target integer,
  source varchar(64) NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookmakers (
  id bigserial PRIMARY KEY,
  key varchar(64) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_definitions (
  id bigserial PRIMARY KEY,
  key varchar(64) NOT NULL UNIQUE,
  display_name varchar(120) NOT NULL,
  family varchar(32) NOT NULL,
  period varchar(32) NOT NULL,
  line_required boolean NOT NULL,
  selections jsonb NOT NULL,
  settlement text NOT NULL,
  required_data text NOT NULL,
  implementation_status varchar(32) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookmaker_market_mappings (
  id bigserial PRIMARY KEY,
  bookmaker_id bigint NOT NULL REFERENCES bookmakers(id),
  market_definition_id bigint NOT NULL REFERENCES market_definitions(id),
  provider_market_key varchar(80) NOT NULL,
  status varchar(32) NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bookmaker_market_map UNIQUE (bookmaker_id, market_definition_id, provider_market_key)
);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id bigserial PRIMARY KEY,
  fixture_id bigint NOT NULL REFERENCES fixtures(id),
  bookmaker_id bigint NOT NULL REFERENCES bookmakers(id),
  provider_id bigint NOT NULL REFERENCES providers(id),
  market_key varchar(64) NOT NULL,
  selection varchar(40) NOT NULL,
  line numeric(8,2),
  decimal_odds numeric(12,4) NOT NULL,
  captured_at timestamptz NOT NULL,
  source_timestamp timestamptz,
  mapping_status varchar(32) NOT NULL,
  data_origin varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_odds_gt_one CHECK (decimal_odds > 1)
);
CREATE INDEX IF NOT EXISTS ix_odds_fixture ON odds_snapshots (fixture_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_odds_snapshot_identity ON odds_snapshots
  (fixture_id, bookmaker_id, market_key, selection, COALESCE(line, -9999::numeric), captured_at);

CREATE OR REPLACE FUNCTION prevent_odds_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'odds_snapshots are immutable';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'odds_snapshots_immutable') THEN
    CREATE TRIGGER odds_snapshots_immutable BEFORE DELETE OR UPDATE ON odds_snapshots
      FOR EACH ROW EXECUTE FUNCTION prevent_odds_snapshot_mutation();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS model_versions (
  id bigserial PRIMARY KEY,
  version_key varchar(64) NOT NULL UNIQUE,
  feature_version varchar(64) NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_snapshots (
  id bigserial PRIMARY KEY,
  model_version_id bigint NOT NULL REFERENCES model_versions(id),
  fixture_id bigint NOT NULL REFERENCES fixtures(id),
  payload jsonb NOT NULL,
  training_cutoff timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prediction_batches (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  scope_date date NOT NULL,
  league_id bigint REFERENCES leagues(id),
  status varchar(40) NOT NULL,
  idempotency_key varchar(80) NOT NULL,
  request_payload jsonb NOT NULL,
  model_version_id bigint REFERENCES model_versions(id),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code varchar(64),
  error_message text,
  time_budget_seconds integer NOT NULL,
  source_data_cutoff timestamptz,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_prediction_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_batch_status CHECK (status IN ('running','succeeded','succeeded_with_warnings','failed','insufficient_data','no_qualifying_slips'))
);

CREATE TABLE IF NOT EXISTS predictions (
  id bigserial PRIMARY KEY,
  batch_id bigint NOT NULL REFERENCES prediction_batches(id),
  fixture_id bigint NOT NULL REFERENCES fixtures(id),
  market_key varchar(64) NOT NULL,
  selection varchar(40) NOT NULL,
  line numeric(8,2),
  probability numeric(12,8) NOT NULL,
  fair_odds numeric(12,4),
  model_version_id bigint NOT NULL REFERENCES model_versions(id),
  feature_snapshot_id bigint NOT NULL REFERENCES feature_snapshots(id),
  odds_snapshot_id bigint REFERENCES odds_snapshots(id),
  data_quality numeric(6,4) NOT NULL,
  sample_size integer NOT NULL,
  implementation_status varchar(32) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome varchar(16),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_prediction_probability CHECK (probability >= 0 AND probability <= 1)
);
CREATE INDEX IF NOT EXISTS ix_predictions_batch ON predictions (batch_id);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id bigserial PRIMARY KEY,
  provider_id bigint REFERENCES providers(id),
  kind varchar(40) NOT NULL,
  status varchar(24) NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  records_written integer NOT NULL DEFAULT 0,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id bigserial PRIMARY KEY,
  model_version_id bigint REFERENCES model_versions(id),
  status varchar(32) NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_sizes jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
