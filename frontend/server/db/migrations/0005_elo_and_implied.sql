-- Elo third opinion and the de-vigged market probability at the time of the prediction,
-- so settled rows can be scored for calibration against both.
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS elo_probability numeric(12,8);
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS implied_probability numeric(12,8);
CREATE INDEX IF NOT EXISTS ix_predictions_settled ON predictions (outcome) WHERE outcome IS NOT NULL;
