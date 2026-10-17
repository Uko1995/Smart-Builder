# Expected-value board

The board replaces the old "highest probability" picks. A short-priced favourite with a high win chance is not a good bet unless the price pays more than that chance is worth. Long-run profit depends only on expected value against the market.

## Approval comes first

`npm run cli -- backtest` runs the walk-forward backtest described in [EDGE_BACKTEST.md](EDGE_BACKTEST.md) and stores every segment (league or all-league × market × forecast source × price basis) in `edge_segments`. A segment is approved only when all of these hold:

1. At least 100 simulated bets.
2. Closing-line value with a bootstrap 95% interval entirely above zero.
3. Positive mean CLV over at least 30 bets from the last full season on.
4. A CLV lower bound above the market-only control on the same league, market and prices. This removes "edges" that come from shopping for an outlying price rather than from our forecasts.

The board shows nothing outside approved segments. When no segment is approved it says so.

## What a recommendation contains

For each upcoming match result and over/under 2.5 market with a prediction for the chosen date:

- Probabilities from the goals model, Elo (match result only) and the blend (log-linear pool with the de-margined market average, weights from the backtest).
- Prices: the football-data.co.uk early prices from the upcoming-fixtures files (Bet365, Pinnacle, Betfair Exchange, best across books) inside `REFERENCE_ODDS_FRESHNESS_HOURS`, and live non-synthetic prices from The Odds API inside `ODDS_FRESHNESS_MINUTES`. The market average is used only for the blend, never as a price to bet.
- One bet per match and market: the approved candidate with the largest edge = probability × price − 1, if it exceeds 5%.
- Stake: quarter Kelly, capped at 5% of the bankroll set under Data and settings (`bankroll_units`, default 100).

## Bet record

Every recommendation is appended to `bet_log` before kick-off, when predictions are generated from the dashboard and by the daily job. The table rejects UPDATE, DELETE and TRUNCATE, rejects rows recorded after kick-off, and keeps the first price recorded for each match, market and selection.

Closing-line value per bet is price taken × fair closing probability − 1, using the same closing benchmark as the backtest. Closing prices come from the football-data.co.uk season files a few days after each match. The performance page shows CLV per bet and per segment as the main health metric, and settled profit with its bootstrap interval as a secondary one.

## Paper betting bot

The Paper bets page runs three strategies without staking anything. The bot runs in the daily 10:00 cron job after predictions, when you press Generate, from "Run bot for today", and with `npm run cli -- paper [--date D]`.

| Strategy | Fair chance | Bets when | Stake |
|---|---|---|---|
| Sharp price vs your bookmakers | Betfair Exchange, else Pinnacle, else market-average early price, margin removed | your bookmaker's price gives 5%+ expected value | quarter Kelly, max 5% |
| Model value | goals model | 5%+ expected value | quarter Kelly, max 5% |
| Strong favourites | market estimate, else model | most likely outcome is 65%+ and the price is 1.25+ | flat 1% |

Prices are the best fresh live price from The Odds API books (not the market average), otherwise Bet365's price from the football-data.co.uk upcoming file. Each strategy keeps its own paper bankroll, starting at `bankroll_units` and moving with settled results. Bets go into the append-only `paper_bets` table before kick-off, one per strategy, match and market. Results and closing-line value are worked out when the page is read.
