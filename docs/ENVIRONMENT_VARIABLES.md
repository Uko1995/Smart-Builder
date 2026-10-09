# Environment variables

Copy `.env.example` to `.env`. The filled file is gitignored. Placeholders are refused when `ENVIRONMENT` is not `test`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy URL, `postgresql+psycopg://...` |
| `AUTH_SECRET` | HMAC secret for the session JWT. Minimum 32 characters. |
| `DASHBOARD_USERNAME` | Single dashboard user. |
| `DASHBOARD_PASSWORD` | Minimum 12 characters. |
| `ENVIRONMENT` | `development`, `test`, or `production`. |
| `CORS_ORIGINS` | Comma-separated browser origins for direct API calls. |
| `ALLOW_SYNTHETIC` | Include labelled synthetic fixtures in prediction runs. |
| `ENABLE_DOCS` | Optional. Unset keeps `/docs` off in production only. |
| `ODDS_FRESHNESS_MINUTES` | Maximum age of a price that may enter a slip. Default 180. |
| `FIXTURE_REFETCH_MINUTES` | Skip an identical fixture fetch inside this window. Default 360. |
| `ODDS_REFETCH_MINUTES` | Skip an identical odds fetch inside this window. Default 60. |
| `PREDICTION_TIME_BUDGET_SECONDS` | Default run budget. Default 25. |
| `PREDICTION_TIME_BUDGET_CAP_SECONDS` | Hard cap. Default 60. |
| `MIN_PROBABILITY_A` | Probability-led floor. Default 0.40. |
| `MIN_PROBABILITY_B` | Balanced-value floor. Default 0.28. |
| `MIN_PROBABILITY_C` | Higher-odds floor. Default 0.18. |
| `MIN_DATA_QUALITY` | Minimum sample quality. Default 0.25. |
| `MIN_TEAM_MATCHES` | Completed matches required before a team is estimated. Default 5. |
| `TARGET_ODDS_MIN` | Combined decimal odds floor. Default 10. |
| `TARGET_ODDS_MAX` | Combined decimal odds ceiling. Default 30. |
| `MAX_SLIP_LEGS` | Default 5. |
| `BEAM_WIDTH` | Default 30. |
| `RHO_MIN_MATCHES` | League matches required before rho is estimated. Default 80. |
| `API_FOOTBALL_KEY` | Optional. |
| `ODDS_API_KEY` | Optional. |
| `FOOTBALL_DATA_API_KEY` | Optional. |
| `ODDS_API_SPORTS` | Default `soccer_epl`. |
| `ODDS_API_BOOKMAKERS` | Default `onexbet`. |
| `API_FOOTBALL_LEAGUE_IDS` | Optional comma-separated league ids. |
| `FOOTBALL_DATA_COMPETITIONS` | Default `PL`. |
| `LOG_LEVEL` | Default `INFO`. |
| `SESSION_HOURS` | JWT lifetime. Default 12. |
| `BACKEND_URL` | Used by Next.js only. Default `http://127.0.0.1:8000`. |

Thresholds that also exist in the `app_settings` row can be edited from Data and settings. Those stored values override the process defaults for a run. Secrets are not editable from the dashboard and are not returned by the API. The settings payload exposes only `configured` booleans.
