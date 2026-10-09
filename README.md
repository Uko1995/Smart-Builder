# Soccer Prediction Lab

Personal football prediction research dashboard. It stores fixtures and odds, estimates probabilities from a transparent baseline model, and can prepare up to three candidate betting slips for manual review.

The application does not place bets, log in to bookmakers, or scrape bookmaker websites.

## What works in this revision

- FastAPI backend with PostgreSQL and Alembic migrations.
- Health and readiness checks.
- Single-user session authentication.
- Canonical market catalogue, including markets that stay unavailable when the data is missing.
- Poisson scoreline model with an optional Dixon-Coles adjustment.
- Deterministic slip search that returns fewer than three slips when the evidence requires it.
- Manual CSV import and an opt-in synthetic demonstration seed.
- Provider adapters for API-Football, football-data.org, and The Odds API. They stay idle until you add keys.

The Next.js dashboard is in `frontend/`. It signs in through the API, keeps the session cookie on the server, and reads stored fixtures, probabilities, and slips.

## Local setup without Docker

Requirements: Python 3.12 and PostgreSQL 16.

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements-dev.txt
cp .env.example .env
```

Edit `.env`. Replace `AUTH_SECRET` and `DASHBOARD_PASSWORD`. Do not commit `.env`.

```bash
createdb soccer_prediction_lab
cd backend
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000/docs` and `http://127.0.0.1:8000/health`.

In another shell, start the dashboard:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:3000` and sign in with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`. Generate predictions from the overview. The button does nothing on a schedule.

Docker Compose can start only the database:

```bash
docker compose up -d db
```

## Synthetic demonstration data

This data is invented and labelled. It is not a record of real matches or bookmaker prices.

```bash
cd backend
python -m app.cli seed-demo
python -m app.cli predict --date YYYY-MM-DD
```

Set `ALLOW_SYNTHETIC=true` in `.env` before a prediction run should include those rows. Production mode refuses the demo seed.

## Tests

From the repository root, with the virtualenv active and `soccer_prediction_lab_test` created:

```bash
./scripts/test-backend.sh
```

The suite creates the test database schema itself when `DATABASE_URL` points at a database your user can migrate. `scripts/test-backend.sh` points pytest at the local test database.

Frontend checks, from `frontend/`:

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
- [Slip optimization](docs/SLIP_OPTIMIZATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Environment variables](docs/ENVIRONMENT_VARIABLES.md)
- [Testing](docs/TESTING.md)
- [Roadmap](docs/ROADMAP.md)
