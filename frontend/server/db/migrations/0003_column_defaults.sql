-- Databases created by the earlier Python service kept defaults client-side. Put them in the schema.
ALTER TABLE providers ALTER COLUMN configured SET DEFAULT false,
  ALTER COLUMN health_status SET DEFAULT 'not_configured',
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE leagues ALTER COLUMN data_origin SET DEFAULT 'provider', ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE seasons ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE teams ALTER COLUMN data_origin SET DEFAULT 'provider', ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE fixtures ALTER COLUMN status SET DEFAULT 'scheduled',
  ALTER COLUMN data_origin SET DEFAULT 'provider',
  ALTER COLUMN provenance SET DEFAULT '{}'::jsonb,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE match_statistics ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE bookmakers ALTER COLUMN is_synthetic SET DEFAULT false,
  ALTER COLUMN notes SET DEFAULT '',
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE market_definitions ALTER COLUMN enabled SET DEFAULT true, ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE bookmaker_market_mappings ALTER COLUMN notes SET DEFAULT '', ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE odds_snapshots ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE model_versions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE feature_snapshots ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE prediction_batches ALTER COLUMN warnings SET DEFAULT '[]'::jsonb,
  ALTER COLUMN diagnostics SET DEFAULT '{}'::jsonb,
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE predictions ALTER COLUMN details SET DEFAULT '{}'::jsonb, ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE ingestion_runs ALTER COLUMN records_written SET DEFAULT 0,
  ALTER COLUMN details SET DEFAULT '{}'::jsonb,
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE evaluation_runs ALTER COLUMN metrics SET DEFAULT '{}'::jsonb,
  ALTER COLUMN sample_sizes SET DEFAULT '{}'::jsonb,
  ALTER COLUMN notes SET DEFAULT '',
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE app_settings ALTER COLUMN updated_at SET DEFAULT now();
