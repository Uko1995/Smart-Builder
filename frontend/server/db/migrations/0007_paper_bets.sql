-- Paper betting: bets a strategy would have placed, recorded before kick-off. No money moves.
CREATE TABLE IF NOT EXISTS paper_bets (
  id bigserial PRIMARY KEY,
  strategy varchar(24) NOT NULL,
  fixture_id bigint NOT NULL REFERENCES fixtures(id),
  market varchar(8) NOT NULL,
  selection varchar(8) NOT NULL,
  probability numeric(10,8) NOT NULL,
  price numeric(8,3) NOT NULL,
  bookmaker varchar(40) NOT NULL,
  price_captured_at timestamptz NOT NULL,
  edge numeric(10,6) NOT NULL,
  stake_units numeric(10,4) NOT NULL,
  bankroll_units numeric(12,2) NOT NULL,
  kickoff_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_paper_bets_before_kickoff CHECK (recorded_at < kickoff_at),
  CONSTRAINT ck_paper_bets_stake CHECK (stake_units > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_paper_bets_once ON paper_bets (strategy, fixture_id, market);
CREATE INDEX IF NOT EXISTS ix_paper_bets_kickoff ON paper_bets (kickoff_at);

CREATE OR REPLACE FUNCTION paper_bets_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'paper_bets is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_paper_bets_no_update ON paper_bets;
CREATE TRIGGER tr_paper_bets_no_update BEFORE UPDATE OR DELETE ON paper_bets FOR EACH ROW EXECUTE FUNCTION paper_bets_append_only();
DROP TRIGGER IF EXISTS tr_paper_bets_no_truncate ON paper_bets;
CREATE TRIGGER tr_paper_bets_no_truncate BEFORE TRUNCATE ON paper_bets FOR EACH STATEMENT EXECUTE FUNCTION paper_bets_append_only();
