# Data sources

Nothing in this application is filled in when a provider is missing. Counts, prices, and probabilities come from rows that were stored.

## API-Football

Base URL: `https://v3.football.api-sports.io`. The free plan used for this design allows 100 requests per day and 10 per minute. Historical seasons on that plan are limited. The adapter requests fixtures and does not request per-fixture statistics, which would spend extra quota. Calls are skipped when `API_FOOTBALL_KEY` is empty.

## football-data.org

Base URL: `https://api.football-data.org/v4`. The free tier covers 12 competitions and 10 calls per minute. It supplies fixtures, results, and tables. It does not supply odds. Calls are skipped when `FOOTBALL_DATA_API_KEY` is empty. The default competition list is `PL`.

## The Odds API

Base URL: `https://api.the-odds-api.com/v4`. The free plan used for this design allows 500 credits per month. Credit cost is markets multiplied by regions. The default request is bookmaker `onexbet` and market `h2h`, about one credit per sport. The default sport list is `soccer_epl`.

1xBet appears in that feed as `onexbet`. Bet9ja and SportyBet do not. Spreads are stored with mapping status `mapping_required` and are excluded from slips. Outcomes that do not map to a canonical market are counted and not stored.

An odds event is attached to an existing fixture when the normalized team names match and the kickoff is within 90 minutes. An ambiguous match is not guessed. An unmatched event can create an odds-provider fixture, which has no historical results until a fixture provider or a manual import supplies them.

## Manual CSV

Fixture and odds imports require the columns documented on the Data page. `data_origin` must be `manual` or `synthetic_demo`. The demo book accepts only synthetic rows.

## Synthetic demonstration

`python -m app.cli seed-demo` or the Data page button writes a labelled league, six invented teams, two round-robins of completed matches, and upcoming fixtures with demo-book prices. Production refuses the seed. Prediction runs include those fixtures only when `ALLOW_SYNTHETIC` is true.

## Refetch windows

Fixtures are skipped inside 360 minutes of a successful fingerprint, and odds inside 60 minutes, unless the refresh asks to ignore the window. A failed ingestion run is committed and reported. It does not raise into a successful prediction.
