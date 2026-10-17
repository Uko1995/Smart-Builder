# Soccer Prediction Lab

Personal football prediction research dashboard. It stores fixtures and odds, estimates probabilities from a transparent baseline model, and measures them against the closing market. It recommends a bet only where a walk-forward backtest showed positive closing-line value, and records every recommendation before kick-off. Accumulators are not generated.

The application does not place bets, log in to bookmakers, or scrape bookmaker websites.

## What works in this revision

- One Next.js / TypeScript app in `frontend/`: dashboard, API routes, prediction engine, provider ingestion and a daily Vercel Cron job. It deploys to Vercel with Neon Postgres; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Health and readiness checks.
- Single-user session authentication.
- Canonical market catalogue, including markets that stay unavailable when the data is missing.
- Poisson scoreline model with an optional Dixon-Coles adjustment.
- Expected-value board gated by a closing-line backtest (`npm run cli -- backtest`, results in [docs/EDGE_BACKTEST.md](docs/EDGE_BACKTEST.md)), with an append-only bet record and closing-line value tracking.
- Manual CSV import and an opt-in synthetic demonstration seed.
- Provider adapters for API-Football, football-data.org, and The Odds API. They stay idle until you add keys.

The Next.js dashboard is in `frontend/`. It signs in through the API, keeps the session cookie on the server, and reads stored fixtures, probabilities, expected-value bets and the bet record.

## Local setup (Node only)

Requirements: Node 20+ and PostgreSQL 16.

```bash
cp .env.example .env        # edit AUTH_SECRET and DASHBOARD_PASSWORD
cd frontend
npm install
npm run db:migrate
npm run history:import      # optional, about ten minutes
npm run dev
```

Do not commit `.env`. Open `http://127.0.0.1:3000` and sign in with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`. Generate predictions from the overview. The button does nothing on a schedule.

Docker Compose can start only the database:

```bash
docker compose up -d db
```

## Historical data

Load 15 seasons of results, corners and cards from football-data.co.uk (no key, about ten minutes):

```bash
cd frontend
npm run history:import
```

The Refresh button on the Data page then keeps the current season, upcoming fixtures and configured odds up to date.

## Synthetic demonstration data

This data is invented and labelled. It is not a record of real matches or bookmaker prices.

```bash
cd frontend
npm run cli -- seed-demo
npm run cli -- predict --date YYYY-MM-DD
```

Set `ALLOW_SYNTHETIC=true` in `.env` before a prediction run should include those rows. Production mode refuses the demo seed.

## Tests

From `frontend/`:

```bash
npm run typecheck
npm run lint
npm test
```

## Documentation

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data sources](docs/DATA_SOURCES.md)
- [Market coverage](docs/MARKET_COVERAGE.md)
- [Model methodology](docs/MODEL_METHODOLOGY.md)
- [Expected-value board](docs/SLIP_OPTIMIZATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Environment variables](docs/ENVIRONMENT_VARIABLES.md)
- [Testing](docs/TESTING.md)
- [Roadmap](docs/ROADMAP.md)
