# Model methodology

Version key: `poisson-dc-v2`. Feature version: `team-strength-v2`. Version 1 had no shrinkage.

This is a transparent baseline. It is not a claim of calibration, and a positive expected value is meaningful only when the model has been checked on settled prices and the displayed odds are still executable.

## Team strength

Attack and defence are ratios of a team's time-weighted scoring rate to the competition average. The decay constant xi is fixed at 0.005 per day, about a 139-day half-life. It is not tuned on the holdout. Expected goals are clamped to the range 0.05–6. Only matches in the same league that kicked off before the fixture are used.

Each team's home or away scoring and conceding rates are shrunk toward the league average, as if the team had also played eight full-weight average matches (`PRIOR_WEIGHT`). Without this, a promoted side with two recent away games could be rated as a strong favourite away at a title contender. On a walk-forward slice ending October 2025, the value 8 improved the scoreline log score from -2.993 to -2.920, and the both-teams-to-score and over 2.5 log losses from about 0.705 to 0.680 (0.693 is a coin flip).

A team with fewer than `MIN_TEAM_MATCHES` completed matches (default 5) is withheld. Sample quality is `min(1, n / 30)`. The default minimum quality is 0.25, so a side with about eight to ten matches can pass.

## Scoreline

The grid is goals 0 through 12, using `scipy.stats.poisson`. Marginals are renormalized, the Dixon-Coles tau factor is applied to 0-0, 0-1, 1-0, and 1-1, and the grid is renormalized again. Rho is shrunk toward zero until every tau factor is positive. Rho of zero is the independent Poisson model.

Rho is chosen on a grid from -0.14 to 0.01 in steps of 0.01, using only the last 20% of matches before the prediction cutoff, and only when the league sample is at least `RHO_MIN_MATCHES` (default 80). Otherwise rho is 0 and `rho_source` is `withheld`. The feature snapshot stores lambdas, rho, rho source, sample sizes, and the scoreline grid.

Corner and card grids use the same Poisson construction with rho 0. Corners stop at 20.

## Elo second opinion

`server/engine/elo.ts` rates clubs from stored results, with one rating pool per league; Club Elo's public fixtures API was deactivated in 2026, so ratings are computed in-house. Each result moves both ratings by K = 20, scaled by the World Football Elo goal-difference multiplier. Home advantage is a fixed 60 points. A team entering a pool starts at the pool's 20th-percentile rating. After a break of more than 60 days, a rating regresses 20% toward the pool mean. A per-league ordered logit, fitted on pre-match rating differences, turns the difference into home, draw and away probabilities. Both teams need 15 pool matches before a probability is given. Prediction runs read about six seasons for Elo.

Elo prices match result, double chance and draw no bet only. It is stored on each prediction as `elo_probability` and shown next to the book and model percentages. It does not change the model probability or the pick ranking.

On the most recent season of stored results (11,548 matches, ratings and logit fitted only on earlier matches), 1X2 log loss was 1.069 for league base rates, 1.027 for the goal model and 1.013 for Elo (Brier 0.646, 0.616, 0.606). A 50/50 blend scored 1.015, so Elo alone was the sharper result-market forecast on that slice.

## Calibration tracking

When a priced prediction is linked to a price, the de-vigged probability of that same bookmaker is stored as `implied_probability`. After settlement, the performance page groups settled pick-market selections (latest prediction per match and selection, synthetic rows excluded) into 10-point probability bands and shows the predicted and actual win rate for each band, the hit rate of rows that would have been picks, and Brier score and log loss for model vs bookmaker and model vs Elo on the same rows. Head-to-head scores are withheld below 20 paired rows.

## Edge against the closing line

The closing price is treated as the best available estimate of the true probability. The margin is removed with the power method (`p_i = r_i^k`, with `k` chosen so the probabilities sum to one); the Shin method is also implemented in `server/engine/devig.ts`. The benchmark is Pinnacle's close before 23 July 2025, then Betfair Exchange, then the market-average close.

`npm run cli -- backtest` (`server/services/backtest.ts`) walks forward over every completed match from 2019/20 with a closing benchmark. Test seasons start in 2020/21; 2019/20 only trains the blend. For each match it uses only earlier data: goal rates from the previous 1100 days with rho chosen at each season start, Elo updated match by match with its logit refitted at each season start, and blend weights (`server/engine/edge.ts`, log-linear pool fitted by gradient ascent) fitted on earlier seasons. It reports:

- Log loss of the model, Elo, the blend and the early market against the closing benchmark, by league and market, with paired bootstrap intervals on the difference.
- A betting rule: one bet per match and market on the highest-EV selection above 5% (2% and 10% as sensitivity), quarter Kelly capped at 5% of a flat 100-unit bankroll, at the best early price across books, at Bet365's early price, or at the best closing price for leagues with no early prices. Profit, ROI and closing-line value come with 1000-sample bootstrap intervals.
- A market-only control that bets the de-margined early market average. Edge it shows comes from price shopping, not forecasting.

Results are stored in `edge_backtests` and `edge_segments` and written to [EDGE_BACKTEST.md](EDGE_BACKTEST.md). The approval rule for the board is in [SLIP_OPTIMIZATION.md](SLIP_OPTIMIZATION.md).

## Evaluation

`POST /api/v1/evaluation` walks completed recorded matches in time order and skips synthetic rows. Rho for the final holdout is frozen from earlier matches. Brier score and log loss on the performance page are withheld below 20 settled observations for a group, and below 20 for a market. Simulated unit returns are withheld below 30 priced non-synthetic settlements. The report states the sample size and does not present a return as a betting history.
