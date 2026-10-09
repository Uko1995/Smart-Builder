# Testing

## Backend

PostgreSQL must be running. `scripts/test-backend.sh` creates the schema on `soccer_prediction_lab_test` through Alembic, then runs ruff and pytest. The test environment is set before the application is imported, and each test truncates the tables.

```bash
./scripts/test-backend.sh
```

The suite covers scoreline normalization, mutually exclusive markets, the slip search, provider retry behaviour, authentication, idempotent runs, and the rule that a failed refresh cannot become a successful batch. Provider tests use injected HTTP responses. They do not call API-Football, football-data.org, or The Odds API.

## Frontend

From `frontend/`:

```bash
npm run typecheck
npm run lint
npm test
```

Vitest covers odds and probability formatting, API error parsing, run-status labels, scoreline ranking, and slip-card rendering. Formatting tests assert that a missing number stays as an em dash.

## Manual check

With the API on port 8000 and `npm run dev` on port 3000:

1. Sign in. A bad password stays on the login page.
2. Open a date with no fixtures and confirm the empty state.
3. Seed the synthetic demo only in development, generate predictions, and confirm the synthetic badge.
4. Export a slip and confirm the text names the captured bookmaker.
5. Open Performance with a small sample and confirm metrics are withheld.

A screenshot of a loaded page is not a substitute for those steps.
