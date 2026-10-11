# Daily picks (accumulators retired)

The dashboard no longer builds 10–30 combined-odds slips. Those accumulators ranked longshots and stacked independent legs, so the joint win chance was far below the per-leg percentages.

Daily picks are single priced selections from the latest prediction run for the chosen UTC date.

## Ranking

1. Model probability at least `MIN_PICK_PROBABILITY` (default 0.50).
2. A stored bookmaker price of 1.20 or higher, still inside the freshness window.
3. Markets: match result, double chance, BTTS, over/under 1.5/2.5/3.5, draw no bet, half-goal Asian handicap.
4. Excluded as trivia: Over 0.5, Under 4.5, team totals, correct scores, corners/cards, odds below 1.20.
5. Ranked by de-vigged implied probability, then model probability.

A disagreement flag is shown when |model − implied| > 0.15. A conservative badge is shown when both are at least 0.60.

The bookmaker-implied probability is the primary ranking signal. The Poisson model is a second opinion and is not claimed to beat closing lines.
