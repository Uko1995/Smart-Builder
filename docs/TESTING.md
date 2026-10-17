# Testing

From `frontend/`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Vitest covers the scoreline model (normalisation, Dixon-Coles correction, complementary markets), de-vigging and fair odds, Brier score and log loss, settlement grading, team-name matching, odds and probability formatting, pick tabs, and pick-card rendering. Engine tests run in the Node environment and do not need a database.

## Manual check

With `npm run dev` on port 3000 and a migrated database:

1. Sign in. A bad password stays on the login page.
2. Open a date with no fixtures and confirm the empty state.
3. Seed the synthetic demo only in development, generate predictions, and confirm the synthetic badge.
4. Generate for a date with odds. With no approved backtest segment the board says no edge was found and shows no bets; with one, each bet shows edge, best price and stake.
5. Open Performance with a small sample and confirm metrics are withheld.
6. `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/daily?steps=settle` returns a JSON report; without the header it returns 401.
