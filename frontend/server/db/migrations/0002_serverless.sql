-- Serverless functions do not share memory, so rate limits live in the database.
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id bigserial PRIMARY KEY,
  bucket varchar(120) NOT NULL,
  hit_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rate_limit_bucket ON rate_limit_hits (bucket, hit_at);

CREATE INDEX IF NOT EXISTS ix_predictions_fixture ON predictions (fixture_id);
CREATE INDEX IF NOT EXISTS ix_predictions_snapshot ON predictions (feature_snapshot_id);
CREATE INDEX IF NOT EXISTS ix_fixtures_league_status ON fixtures (league_id, status, kickoff_at);
CREATE INDEX IF NOT EXISTS ix_batches_scope ON prediction_batches (scope_date, started_at);
