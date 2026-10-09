# Market coverage

Canonical markets live in `backend/app/markets/registry.py`. Implementation status describes the model. Bookmaker mapping is separate.

## Supported from the full-time scoreline

Match result, double chance, draw no bet, over/under goals, both teams to score, half-goal Asian handicap, and selected correct scores with probability at least 0.01.

Mutually exclusive selections are partition-adjusted so they sum to 1.00000000. Double chance overlaps, so those three selections are not forced to sum to 1.

Draw no bet and integer Asian handicap are estimated, then excluded from multi-leg slips. A void changes the combined price. Half-time/full-time is unsupported because there is no joint model for the two periods.

## Conditional markets

Corners, cards, and first-half goals are estimated only when the count history meets `MIN_TEAM_MATCHES`. Otherwise the run records a warning and does not invent a probability.

Player shots, shots on target, goals, and assists stay `insufficient_data`. Scoring rates without minutes and lineup evidence would be invented.

## Bookmakers

| Bookmaker | Feed | Mapping |
| --- | --- | --- |
| 1xBet | The Odds API key `onexbet` | Match result (`h2h`) and totals verified. Spreads require mapping and stay out of slips. |
| Bet9ja | None | Match result is `mapping_required` until a manual price is imported. |
| SportyBet | None | Match result is `mapping_required` until a manual price is imported. |
| Demo Book | Synthetic seed | Verified for the demonstration only. Not a real bookmaker. |

A slip is `synthetic_demo` if any leg is synthetic, `manually_prepared` if any leg was entered manually, `ready_for_review` only when every leg has a verified mapping, and `mapping_required` otherwise. Approval is accepted for `ready_for_review` and `manually_prepared`. If a newer snapshot for the same selection differs, the overview labels the slip `odds_changed` and still shows the captured price.
