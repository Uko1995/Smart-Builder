# Environment variables

Copy `.env.example` to `.env`. The filled file is gitignored. Placeholders are refused when `ENVIRONMENT` is not `test`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres URL, `postgresql://...`. On Vercel, the Neon integration sets it. |
| `AUTH_SECRET` | HMAC secret for the session JWT. Minimum 32 characters. |
| `DASHBOARD_USERNAME` | Optional. Copied into the `users` table by `npm run cli -- seed-user`, or on first login when the table is empty. |
| `DASHBOARD_PASSWORD` | Optional, minimum 12 characters. Stored only as a salted scrypt hash. Change it later with `npm run cli -- set-user --username NAME`. |
| `ENVIRONMENT` | `development`, `test`, or `production`. |
| `ALLOW_SYNTHETIC` | Include labelled synthetic fixtures in prediction runs. |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/daily`. Required for the scheduled job. |
| `PREDICTION_RETENTION_DAYS` | Unpriced predictions older than this are pruned by the daily job. Default 21. |
| `ODDS_FRESHNESS_MINUTES` | Maximum age of a price that may appear on the daily picks board. Default 180. |
| `FIXTURE_REFETCH_MINUTES` | Skip an identical fixture fetch inside this window. Default 360. |
| `ODDS_REFETCH_MINUTES` | Skip an identical odds fetch inside this window. Default 60. |
| `PREDICTION_TIME_BUDGET_SECONDS` | Default run budget. Default 25. |
| `PREDICTION_TIME_BUDGET_CAP_SECONDS` | Hard cap. Default 240, inside Vercel's 300-second function limit. |
| `MIN_PICK_PROBABILITY` | Minimum model probability for a daily pick. Default 0.50. |
| `MIN_DATA_QUALITY` | Minimum sample quality. Default 0.25. |
| `MIN_TEAM_MATCHES` | Completed matches required before a team is estimated. Default 5. |
| `PREDICTION_HISTORY_DAYS` | Completed matches older than this are not loaded for a prediction run. Default 1100. |
| `RHO_MIN_MATCHES` | League matches required before rho is estimated. Default 80. |
| `API_FOOTBALL_KEY` | Optional. |
| `ODDS_API_KEY` | Optional. |
| `FOOTBALL_DATA_API_KEY` | Optional. |
| `ODDS_API_SPORTS` | Default `soccer_epl`. |
| `ODDS_API_BOOKMAKERS` | Default `onexbet`. |
| `ODDS_API_MARKETS` | League-wide markets, one credit each per league per refresh. Default `h2h,totals`. |
| `ODDS_API_EVENT_MARKETS` | Optional per-match markets such as `btts,alternate_totals`. About one credit per market per match. |
| `ODDS_API_MAX_EVENTS` | Cap on matches fetched with per-match markets in one refresh. Default 20. |
| `FOOTBALL_DATA_CO_UK_ENABLED` | Fetch fixtures and results from football-data.co.uk on refresh. Default true. |
| `FOOTBALL_DATA_CO_UK_LEAGUES` | Optional comma-separated league codes such as `E0,SP1,BRA`. Empty means all. |
| `HISTORY_SEASONS` | Seasons loaded by `npm run history:import`. Default 15. |
| `API_FOOTBALL_LEAGUE_IDS` | Optional comma-separated league ids. |
| `FOOTBALL_DATA_COMPETITIONS` | Default `PL`. |
| `SESSION_HOURS` | JWT lifetime. Default 12. |

Thresholds that also exist in the `app_settings` row can be edited from Data and settings. Those stored values override the process defaults for a run. Secrets are not editable from the dashboard and are not returned by the API. The settings payload exposes only `configured` booleans.
