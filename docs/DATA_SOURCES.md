# Data sources

Nothing in this application is filled in when a provider is missing. Counts, prices, and probabilities come from rows that were stored.

## football-data.co.uk

Base URL: `https://football-data.co.uk`. Free CSV files, no key. Twenty-two main European leagues (codes such as `E0`, `SP1`, `D1`) have one file per season with half-time scores, corners, cards and shots. Sixteen extra leagues (`ARG`, `BRA`, `USA` and others) have one file per country with full-time scores only. `fixtures.csv` and `new_league_fixtures.csv` list upcoming matches. Kickoff times are UK local time and are converted to UTC.

The upcoming-fixtures files also carry pre-match prices. The app stores the bookmaker averages as the `market_average` bookmaker ("Market average"): `AvgH/AvgD/AvgA` for match result in all 38 leagues, and `Avg>2.5/Avg<2.5` for over/under 2.5 goals in the 22 main leagues. The files are updated about twice a week (Tuesday and Friday) and carry no timestamp, so `captured_at` is when a price was first seen and unchanged prices are not stored again. These are reference prices, accepted for `REFERENCE_ODDS_FRESHNESS_HOURS` (default 120).

Per-bookmaker prices are kept as timestamped snapshots in `market_prices` (one row per fixture, book, phase and capture time) for matches from 2019/20 on. Books: Pinnacle (`PS…`, `P>2.5`), Bet365, best across books (`Max`), market average (`Avg`) and Betfair Exchange (`BFE…`, from 2024/25). Phases: `early` (the file's pre-match price) and `closing` (the `…C…` columns). The 22 main leagues carry match result and over/under 2.5 in both phases. The 16 extra leagues carry closing match result only. Historical early prices are stamped with the estimated collection time (the last Tuesday 13:00 or Friday 17:00 UK before kick-off) and closing prices with kick-off; both are flagged `captured_at_estimated`. Early prices fetched from the upcoming-fixtures files are stamped with the fetch time, and a new row is stored whenever a book's prices change. Rows are never overwritten. The site reports Pinnacle prices as unreliable from 23 July 2025, so the closing benchmark switches to Betfair Exchange (then market average) from that date.

`npm run history:import` loads `HISTORY_SEASONS` seasons. A dashboard refresh fetches the current season and the upcoming-fixtures files. Rows are upserted on league, date and team names, so a scheduled fixture becomes completed when its result is published. A scheduled fixture still unplayed seven days after kickoff is marked `unknown`.

Teams keep one identity per country, so a promoted club keeps its history. Strength estimates still use only matches from the fixture's own league.

## API-Football

Base URL: `https://v3.football.api-sports.io`. The free plan used for this design allows 100 requests per day and 10 per minute. Historical seasons on that plan are limited. The adapter requests fixtures and does not request per-fixture statistics, which would spend extra quota. Calls are skipped when `API_FOOTBALL_KEY` is empty.

## football-data.org

Base URL: `https://api.football-data.org/v4`. The free tier covers 12 competitions and 10 calls per minute. It supplies fixtures, results, and tables. It does not supply odds. Calls are skipped when `FOOTBALL_DATA_API_KEY` is empty. The default competition list is `PL`.

## The Odds API

Base URL: `https://api.the-odds-api.com/v4`. The free plan used for this design allows 500 credits per month. Credit cost is markets multiplied by regions. The default request is bookmaker `onexbet` and market `h2h`, about one credit per sport. The default sport list is `soccer_epl`.

1xBet appears in that feed as `onexbet`. Bet9ja and SportyBet do not. Spreads are stored with mapping status `mapping_required` and are excluded from slips. Outcomes that do not map to a canonical market are counted and not stored.

League-wide markets come from `ODDS_API_MARKETS` (default `h2h,totals`). Per-match markets in `ODDS_API_EVENT_MARKETS` (1xBet prices `btts` and `alternate_totals`) are fetched for the earliest `ODDS_API_MAX_EVENTS` matches in the refresh window, because each match costs credits.

An odds event is attached to a stored fixture whose kickoff is within 90 minutes and whose home and away names are both similar to the feed's names. Similarity allows short forms such as "Man United" and a small alias list for abbreviations. When two fixtures score within 0.15 of each other, the event is treated as ambiguous and not attached. An unmatched event is counted and not stored.

## Manual CSV

Fixture and odds imports require the columns documented on the Data page. `data_origin` must be `manual` or `synthetic_demo`. The demo book accepts only synthetic rows.

## Synthetic demonstration

`npm run cli -- seed-demo` or the Data page button writes a labelled league, six invented teams, two round-robins of completed matches, and upcoming fixtures with demo-book prices. Production refuses the seed. Prediction runs include those fixtures only when `ALLOW_SYNTHETIC` is true.

## Refetch windows

Fixtures are skipped inside 360 minutes of a successful fingerprint, and odds inside 60 minutes, unless the refresh asks to ignore the window. A failed ingestion run is committed and reported. It does not raise into a successful prediction.
