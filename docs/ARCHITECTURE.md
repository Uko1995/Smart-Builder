# Architecture

The browser talks only to the Next.js application. Next.js stores the session in an HttpOnly cookie named `spl_session` and forwards API calls to FastAPI with `Authorization: Bearer`. The browser never receives the token or a provider key.

```text
Browser
  -> Next.js App Router (frontend/)
    -> /api/backend/* proxy
      -> FastAPI (backend/)
        -> PostgreSQL
```

FastAPI owns the schema through SQLAlchemy and Alembic. Prisma is not used. Prediction runs are synchronous and bounded. The default budget is 25 seconds and the hard cap is 60. A duplicate `Idempotency-Key` returns the stored batch. A second run for the same date while one is still marked running returns 409. A running row older than the budget plus 30 seconds is marked failed and interrupted.

Run statuses are `running`, `succeeded`, `succeeded_with_warnings`, `failed`, `insufficient_data`, and `no_qualifying_slips`. `insufficient_data` and `no_qualifying_slips` are successful HTTP responses because the batch was stored. Ingestion failure is 502, a budget overrun is 504, and an unexpected prediction failure is 500. A failed refresh is not rewritten as a successful batch.

Odds snapshots are immutable. A database trigger rejects update and delete. The newest `captured_at` wins for a fixture, bookmaker, market, selection, and line. A stale snapshot is not replaced with a price from a different bookmaker.

The dashboard pages read those stored payloads:

- Daily overview generates a run and shows the stored status, fixtures, provider health, and up to three slips.
- Market explorer filters saved predictions.
- Match analysis separates measured history from the model scoreline.
- Slip lab exports text and records approve or reject.
- Bookmaker preparation shows only the prices captured for that book and stores a booking code the user typed.
- Performance reports Brier score and log loss only after the sample threshold, with synthetic rows separated.
- Data and settings edits thresholds, shows whether keys are configured, and accepts CSV import.

Scheduling is not wired. A later scheduler can call the same `create_prediction_run` function. It does not need a new model or schema.
