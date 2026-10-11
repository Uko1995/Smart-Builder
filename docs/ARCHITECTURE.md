# Architecture

The browser talks only to the Next.js application. Next.js stores the session in an HttpOnly cookie named `spl_session` and checks it on every API call. The browser never receives a provider key.

```text
Browser
  -> Next.js App Router (frontend/app)
    -> /api/backend/* route handler -> in-process router (frontend/server/api/router.ts)
      -> services, engine, providers (frontend/server/)
        -> PostgreSQL (Neon in production)
Vercel Cron -> /api/cron/daily (Bearer CRON_SECRET)
```

The schema lives in plain SQL migrations under `frontend/server/db/migrations`, applied by `npm run db:migrate`. Prediction runs are synchronous and bounded. The default budget is 25 seconds and the hard cap is 240. A duplicate `Idempotency-Key` returns the stored batch. A second run for the same date while one is still marked running returns 409. A running row older than the budget plus 30 seconds is marked failed and interrupted.

Run statuses are `running`, `succeeded`, `succeeded_with_warnings`, `failed`, `insufficient_data`, and `no_qualifying_slips`. `insufficient_data` and `no_qualifying_slips` are successful HTTP responses because the batch was stored. Ingestion failure is 502, a budget overrun is 504, and an unexpected prediction failure is 500. A failed refresh is not rewritten as a successful batch.

Odds snapshots are immutable. A database trigger rejects update and delete. The newest `captured_at` wins for a fixture, bookmaker, market, selection, and line. A stale snapshot is not replaced with a price from a different bookmaker.

Rate limits (login, refresh, generate) are stored in Postgres because serverless instances share no memory.

The dashboard pages read those stored payloads:

- Daily overview generates a run and shows the day's priced picks in per-market tabs, then status, fixtures, and provider health.
- Market explorer filters saved predictions from each match's latest run, excludes trivial lines, and ranks by implied then model probability.
- Match analysis separates measured history from the model scoreline.
- Performance reports Brier score and log loss only after the sample threshold, with synthetic rows separated.
- Data and settings edits thresholds, shows whether keys are configured, and accepts CSV import.

The daily cron refreshes results and fixtures, settles finished predictions, prunes old unpriced rows, refreshes odds, and runs the day's predictions. See `docs/DEPLOYMENT.md`.
