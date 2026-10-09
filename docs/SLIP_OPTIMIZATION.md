# Slip optimization

The search is a deterministic beam. It returns zero, one, two, or three slips. It does not add a slip to fill the dashboard.

## Strategies

| Strategy | Minimum probability | Ranked by |
| --- | --- | --- |
| Probability-led | 0.40 | Joint probability |
| Balanced value | 0.28 | Estimated value |
| Higher odds | 0.18 | Combined decimal odds |

Defaults can be changed in Data and settings. The floors must stay A ≥ B ≥ C.

## Constraints

- Combined decimal odds must fall in 10.00–30.00.
- At most `MAX_SLIP_LEGS` selections, default 5.
- Beam width default 30.
- At most two goal-market legs from the same match. Their joint probability comes from the shared scoreline grid.
- Same-match mixes that are not both goal markets are rejected.
- Selections from different matches are multiplied as if independent. The slip warning says that this is an assumption.
- Draw no bet, integer Asian handicap, and half-time/full-time are excluded.
- A price older than the freshness window is rejected. Another bookmaker is not substituted.
- Mapping status `mapping_required` does not enter the search. Manual prices can.
- A later strategy is dropped when its selection set has Jaccard overlap of 0.5 or more with an earlier slip. The omitted reason is stored on the slip diagnostics.

Expected value is `joint probability * combined odds - 1`. The slip records whether that value is estimated and repeats that it depends on calibration and an executable price.

The same inputs and config produce the same slips. Tests cover a three-slip case, a one-slip case, stale rejection, and that determinism.
