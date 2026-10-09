# Deployment

Checked on 2026-10-09. Recheck the vendor pages before relying on a free quota. This project targets $0 hosting and does not require a credit card, Kubernetes, Redis, Kafka, or an always-on worker.

## Local path

PostgreSQL 16, the backend virtualenv, and `npm run dev` in `frontend/` are the reliable path. `docker compose up -d db` starts only Postgres when Docker is available. Scientific imports stay in the API process. The prediction CLI is `python -m app.cli predict`.

## Suggested free split

- Neon Postgres free: the notes reviewed on 2026-10-09 cited 100 projects, 1 GB per project, 100 CU-hours, scale-to-zero after 5 minutes, and a 6-hour restore window. Run `alembic upgrade head` against that database from a machine with the repo. Do not use Render’s free Postgres as the store: that offer expired after 30 days in the notes reviewed the same day.
- Vercel Hobby for `frontend/`. Set the project root to `frontend`. Hobby is personal and non-commercial. Set `BACKEND_URL` to the API origin. The browser calls Next.js, so the API key never reaches the client. Function duration on Hobby was documented around a 300 second maximum; the proxy still has to wait for FastAPI, and public proxy timeout notes around 120 seconds are a reason to keep prediction runs inside the 60 second cap.
- A free Python web service, such as Render’s free web service, for FastAPI. The notes reviewed on 2026-10-09 described spin-down after 15 minutes, about a minute to wake, an ephemeral disk, 512 MB RAM, 0.1 CPU, and 750 free instance hours per month. `render.yaml` in the repo root targets that shape. If the process is killed during import of pandas or scikit-learn, use the local API instead of pretending the hosted run succeeded.

`CORS_ORIGINS` must include the Vercel origin if a browser ever calls FastAPI directly. The dashboard does not need that, because the proxy is same-origin.

## Checklist before a hosted login

1. `AUTH_SECRET` is at least 32 characters and is not the example placeholder.
2. `DASHBOARD_PASSWORD` is at least 12 characters and is not the example placeholder.
3. `ENVIRONMENT=production` so OpenAPI and the synthetic seed are off.
4. `ALLOW_SYNTHETIC=false`.
5. `GET /health` returns ok and `GET /ready` reports the database.
6. Alembic is at head on the hosted database.
7. Provider keys, if used, exist only in the host’s environment.

A cold free API host can time out the first request after sleep. The overview shows that failure. It does not mark the run successful.

## What is intentionally absent

No cron, no queue, and no bookmaker login. Phase 7 in `docs/ROADMAP.md` is the upgrade list. The prediction function can be called by a scheduler later without a schema rewrite.
