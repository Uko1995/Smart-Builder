# Roadmap

Phase 7 is not implemented. The items below are the upgrade path. They should be added without replacing the stored run, odds snapshot, or market catalogue.

## Scheduling

A free or local scheduler can call `create_prediction_run` with an idempotency key. The dashboard button can stay. Do not add a paid scheduler, a queue, or an always-on worker for the current hosting target. A scheduled run must persist the same statuses, including `insufficient_data`.

## Data that this revision refuses to invent

- Player props, once player-match history, expected minutes, and a lineup source exist.
- Bet builders, once the bookmaker publishes a documented price for the combination. The scoreline joint is not a substitute for that price.
- Lineup and injury feeds.
- A paid odds feed that includes Bet9ja or SportyBet, with an explicit market mapping before a pick is treated as executable.
- Corner, card, and first-half markets for competitions that do not yet have count history. The model path already exists; the gate is the sample.

## Model work that stays off the expected-value board until the backtest approves it

- A richer Dixon-Coles likelihood, or a second model version stored beside `poisson-dc-v2`.
- Any new data source or market. The closing-line backtest ([EDGE_BACKTEST.md](EDGE_BACKTEST.md)) has to show where an edge exists first.

## Explicitly out of scope

Bookmaker login, session cookies from a bookmaker, automated staking, scraping, and undocumented private endpoints.
