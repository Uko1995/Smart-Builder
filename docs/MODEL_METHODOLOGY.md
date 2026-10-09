# Model methodology

Version key: `poisson-dc-v1`. Feature version: `team-strength-v1`.

This is a transparent baseline. It is not a claim of calibration, and a positive expected value is meaningful only when the model has been checked on settled prices and the displayed odds are still executable.

## Team strength

Attack and defence are ratios of a team's time-weighted scoring rate to the competition average. The decay constant xi is fixed at 0.005 per day, about a 139-day half-life. It is not tuned on the holdout. Expected goals are clamped to the range 0.05–6. Only matches in the same league that kicked off before the fixture are used.

A team with fewer than `MIN_TEAM_MATCHES` completed matches (default 5) is withheld. Sample quality is `min(1, n / 30)`. The default minimum quality is 0.25, so a side with about eight to ten matches can pass.

## Scoreline

The grid is goals 0 through 12, using `scipy.stats.poisson`. Marginals are renormalized, the Dixon-Coles tau factor is applied to 0-0, 0-1, 1-0, and 1-1, and the grid is renormalized again. Rho is shrunk toward zero until every tau factor is positive. Rho of zero is the independent Poisson model.

Rho is chosen on a grid from -0.14 to 0.01 in steps of 0.01, using only the last 20% of matches before the prediction cutoff, and only when the league sample is at least `RHO_MIN_MATCHES` (default 80). Otherwise rho is 0 and `rho_source` is `withheld`. The feature snapshot stores lambdas, rho, rho source, sample sizes, and the scoreline grid.

Corner and card grids use the same Poisson construction with rho 0. Corners stop at 20.

## Evaluation

`POST /api/v1/evaluation` walks completed recorded matches in time order and skips synthetic rows. Rho for the final holdout is frozen from earlier matches. Brier score and log loss on the performance page are withheld below 20 settled observations for a group, and below 20 for a market. Simulated unit returns are withheld below 30 priced non-synthetic settlements. The report states the sample size and does not present a return as a betting history.
