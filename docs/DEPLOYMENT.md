# Deployment

The whole application is one Next.js project in `frontend/`. The API, the prediction engine, provider ingestion and the scheduled job run as Vercel serverless functions. Postgres is Neon.

## Local

```bash
cd frontend
npm install
npm run db:migrate          # applies server/db/migrations/*.sql, safe to re-run
npm run history:import      # 15 seasons from football-data.co.uk, about ten minutes
npm run dev
```

Local runs read the repository-root `.env`. Other commands: `npm run cli -- predict --date 2026-10-10 [--refresh]`, `npm run cli -- daily --steps odds,predict`, `npm run cli -- seed-demo`.

## Vercel + Neon (Hobby, free)

1. In Vercel, import the repository and set **Root Directory** to `frontend`.
2. Storage → add **Neon** from the Marketplace (free plan). It injects `DATABASE_URL`. Use the pooled connection string; the client already disables prepared statements for PgBouncer.
3. Add environment variables: `AUTH_SECRET` (32+ chars), `ENVIRONMENT=production`, `CRON_SECRET` (32+ chars), `ODDS_API_KEY` and the `ODDS_API_*` settings you use locally. Set `ODDS_FRESHNESS_MINUTES=360` on Hobby so prices from the last cron still count.
   Each Vercel build runs `vercel-build`, which applies pending migrations to that deployment's `DATABASE_URL` before `next build`, so new code never runs against an older schema. Make sure Vercel's `DATABASE_URL` is the same database as your local `.env`; the Marketplace integration can create a separate, empty one.
4. From your machine, point at Neon once and load the schema and history:

   ```bash
   cd frontend
   DATABASE_URL='<neon url>' npm run db:migrate
   DATABASE_URL='<neon url>' npm run history:import
   DATABASE_URL='<neon url>' npm run cli -- seed-user      # copies DASHBOARD_USERNAME/PASSWORD from .env as a hash
   ```

   Dashboard accounts live in the `users` table, so Vercel does not need the dashboard password. `npm run cli -- set-user --username NAME` adds an account or changes a password (it prompts, hidden).

   Or copy the existing local database instead of re-importing:

   ```bash
   pg_dump --no-owner --no-acl "$LOCAL_URL" | psql "$NEON_URL"
   DATABASE_URL="$NEON_URL" npm run db:migrate
   ```

5. Deploy. `vercel.json` registers two daily cron calls (UTC):
   - 06:00 `fixtures,settle,prune`: pull results and upcoming fixtures, grade finished predictions, delete old unpriced predictions.
   - 10:00 `odds,predict`: fresh prices, then the day's predictions; any expected-value bets in approved segments are appended to `bet_log`.

   Hobby runs each cron once a day and may fire anywhere inside the scheduled hour. The **Generate** button on the overview refreshes odds and re-runs predictions on demand.

## Limits to keep in mind

- Function duration: routes declare `maxDuration = 300`. A full day (about 160 fixtures, 15,700 predictions) takes about 5 seconds; a full odds refresh across ten leagues about 30 seconds.
- Neon free storage is 0.5 GB. Each daily run writes roughly 16k prediction rows; the 06:00 prune keeps only the last `PREDICTION_RETENTION_DAYS` of unpriced rows. Priced, settled predictions are kept for performance tracking.
- The Odds API charges one credit per market per region per sport. Ten sports with `h2h,totals` is about 20 credits a refresh, plus event-market calls, so one refresh a day is roughly 600+ credits a month. The free tier is 500: on it, trim `ODDS_API_SPORTS` to the leagues you follow, or leave `ODDS_API_EVENT_MARKETS` empty. Each Generate click with refresh costs the same as a cron refresh.
- The history import is too long for a serverless function. Run it from your machine.

## Checklist before a hosted login

1. `AUTH_SECRET` is at least 32 characters and is not the example placeholder.
2. `npm run cli -- seed-user` or `set-user` has created an account in the hosted `users` table.
3. `ENVIRONMENT=production`, so the synthetic seed is off.
4. `CRON_SECRET` is set, otherwise the cron route answers 401.
5. `GET /api/backend/health` returns ok and `GET /api/backend/ready` reports the database.
6. `npm run db:migrate` has been run against Neon.
