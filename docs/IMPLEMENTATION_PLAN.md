# Implementation plan

Assessment date: 2026-10-09.

## Repository assessment

The repository contained only an MIT license and an initial commit. There was no frontend, backend, schema, test suite, or deployment config to preserve.

Chosen stack:

- Next.js App Router, TypeScript, and Tailwind for the dashboard. Not started in the first commit.
- FastAPI and Pydantic for the API.
- SQLAlchemy and Alembic as the only schema owner. Prisma is not used.
- PostgreSQL. Local development uses a normal Postgres install or Docker Compose. The documented hosted target is Neon’s free plan, subject to its quotas.
- Single-user password authentication with an HttpOnly session token. No paid auth vendor.

## Defaults chosen without a blocking question

- Prediction runs are synchronous and bounded (default 25 seconds, hard cap 60). Longer evaluation stays on the local CLI.
- Cross-match selections are treated as independent and the slip says so. Same-match goal markets use the shared scoreline grid. Other same-match mixes are rejected.
- Draw-no-bet and integer Asian handicaps are estimated, then kept out of multi-leg slips because a void changes the combined price.
- Bet9ja and SportyBet have no authorized odds feed in this revision. Manual prices can be imported. 1xBet head-to-head and half-goal totals are mapped only for The Odds API’s documented `onexbet` feed.
- Player, corner, card, and first-half markets stay unavailable until the required history exists. Half-time/full-time is unsupported because there is no joint model.
- Synthetic data is opt-in, labelled, and excluded from production seeding.

## Phases

### Phase 1 — Foundation

Status: implemented in the backend.

- Environment configuration, Alembic migration, health and readiness, authentication, request IDs, and pytest.
- Acceptance: the API process starts, `/health` returns ok, and `/ready` checks Postgres.

### Phase 2 — Data and market catalogue

Status: implemented behind credentials. Live provider calls are not made in tests.

- Provider interfaces, idempotent fixture and odds writes, market registry, coverage payload, stale-price rules, and failed-fetch handling.
- Acceptance: unsupported markets and missing credentials are reported. A failed refresh cannot become a successful prediction batch.

### Phase 3 — Baseline models

Status: implemented.

- Scoreline distribution, derived goal markets, optional corner, card, and first-half models, model version records, and chronological evaluation.
- Acceptance: mutually exclusive outcomes sum to 1 within tolerance, and small samples return `insufficient_data`.

### Phase 4 — Slip optimizer

Status: implemented.

- Three strategies, odds range 10.00–30.00, freshness, mapping, dependence, and diversity.
- Acceptance: tests cover a three-slip case, a one-slip case, stale rejection, and deterministic output.

### Phase 5 — Dashboard

Status: not started.

- Daily overview, market explorer, match analysis, slip lab, bookmaker preparation, performance, and settings.
- Acceptance: an authenticated user can generate a run, read its status, and export a slip without opening the database.

### Phase 6 — Free-tier deployment

Status: not started. Limits checked on 2026-10-09 are recorded in the deployment notes once that phase is written.

- Vercel Hobby for the frontend, a free Python host or local FastAPI for the API, Neon free Postgres.
- Render’s free web service sleeps after 15 minutes and has 512 MB RAM. Heavy fitting stays on the local CLI if that limit is too small.

### Phase 7 — Roadmap only

Automatic scheduling, workers, player props, bet builders, lineup feeds, and paid odds feeds stay documented and unimplemented.

## Complexity

The invasive work is the prediction service and the dashboard, because they join provenance, odds freshness, and run status. Provider adapters are isolated. Deployment is configuration plus documentation, with a real risk that the free API host cannot hold a scientific Python process in 512 MB.

## Risks

- Free odds and fixture quotas are small. The app caches refetches and does not call a provider until a key exists.
- Bookmaker coverage for Bet9ja and SportyBet is absent from the verified feeds checked for this plan.
- Model probabilities are a baseline. Positive expected value is not evidence that a price is executable or that the model is calibrated.
