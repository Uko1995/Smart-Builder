# Roadmap

Phase 7 is not implemented. The items below are the upgrade path. They should be added without replacing the stored run, odds snapshot, or market catalogue.

## Scheduling

A free or local scheduler can call `create_prediction_run` with an idempotency key. The dashboard button can stay. Do not add a paid scheduler, a queue, or an always-on worker for the current hosting target. A scheduled run must persist the same statuses, including `insufficient_data` and `no_qualifying_slips`.

## Data that this revision refuses to invent

- Player props, once player-match history, expected minutes, and a lineup source exist.
- Bet builders, once the bookmaker publishes a documented price for the combination. The scoreline joint is not a substitute for that price.
- Lineup and injury feeds.
- A paid odds feed that includes Bet9ja or SportyBet, with an explicit market mapping before a slip can become `ready_for_review`.
- Corner, card, and first-half markets for competitions that do not yet have count history. The model path already exists; the gate is the sample.

## Model work that stays out of the live slip until it is measured

- A richer Dixon-Coles likelihood, or a second model version stored beside `poisson-dc-v1`.
- Calibration plots with sample sizes, using the evaluation run that already skips synthetic rows.
- Closing-line comparison, only when the captured historical price is the closing price. A later snapshot is not labelled closing unless the provider says so.

## Explicitly out of scope

Bookmaker login, session cookies from a bookmaker, automated staking, scraping, and undocumented private endpoints. A booking code remains something the user copies in after creating it on the bookmaker.
