"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Shell } from "@/components/shell";
import { EmptyState, OriginBadge, RunStatus, WarningList } from "@/components/indicators";
import { ForecastBoardView } from "@/components/forecast-board";
import { ValueBoardView } from "@/components/value-board";
import { QueryView } from "@/components/query-view";
import { api, ApiError } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { todayUtc } from "@/lib/scoreline";
import type { ForecastBoard, Overview, PredictionRun, ValueBoard } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

export default function OverviewPage() {
  const [date, setDate] = useState(todayUtc);
  const query = useQuery<Overview>(`/api/v1/overview?scope_date=${date}`);
  const board = useQuery<ValueBoard>(`/api/v1/value-board?scope_date=${date}`);
  const forecasts = useQuery<ForecastBoard>(`/api/v1/forecasts?scope_date=${date}`);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      await api<PredictionRun>("/api/v1/prediction-runs", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ scope_date: date, refresh: true }),
      });
    } catch (reason) {
      setActionError(reason instanceof ApiError ? reason.message : "Prediction generation failed.");
    } finally {
      setPending(false);
      query.reload();
      board.reload();
      forecasts.reload();
    }
  }

  const overview = query.data;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Daily overview</p>
          <h1 className="text-3xl font-semibold">Today’s predictions</h1>
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={generate}>
          <label className="text-sm">
            Scope date (UTC)
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 block rounded-xl border border-line bg-white px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-tide px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {pending ? "Generating…" : "Generate predictions"}
          </button>
        </form>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Win, goals and both-teams-to-score probabilities for every match on the date. Below them, the expected-value board
        lists bets only where the backtest showed a real edge. This application does not place bets.
      </p>
      {actionError ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="mt-6">
        <QueryView status={forecasts.status} error={forecasts.error}>
          {forecasts.data ? <ForecastBoardView board={forecasts.data} /> : null}
        </QueryView>
      </div>
      <div className="mt-6">
        <QueryView status={board.status} error={board.error}>
          {board.data ? <ValueBoardView board={board.data} /> : null}
        </QueryView>
      </div>
      <div className="mt-6">
        <QueryView status={query.status} error={query.error}>
          {overview ? <OverviewBody overview={overview} /> : null}
        </QueryView>
      </div>
    </Shell>
  );
}

function OverviewBody({ overview }: { overview: Overview }) {
  const status = overview.latest_run?.status;
  const runSucceeded = status === "succeeded" || status === "succeeded_with_warnings";
  return (
    <div className="space-y-6">
      {runSucceeded && overview.warnings.length === 0 ? null : <RunStatus status={status} error={overview.latest_run?.error_message} />}
      <WarningList items={overview.warnings} />
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Timezone" value={overview.timezone} />
        <Stat label="Scheduled fixtures" value={String(overview.fixture_counts.scheduled)} />
        <Stat label="Completed fixtures" value={String(overview.fixture_counts.completed)} />
        <Stat label="Latest odds" value={formatWhen(overview.latest_odds_captured_at)} />
      </div>
      <section>
        <h2 className="text-lg font-semibold">Providers</h2>
        {overview.providers.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No providers recorded" body="Reference data has not been seeded yet." />
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {overview.providers.map((provider) => (
              <li key={provider.key} className="panel px-4 py-3 text-sm">
                <p className="font-medium">{provider.name}</p>
                <p className="text-slate-600">
                  {provider.configured ? "Credentials present" : "Not configured"} · {provider.health_status.replaceAll("_", " ")}
                </p>
                <p className="text-slate-500">
                  Quota remaining: {provider.quota_remaining === null ? "not reported" : provider.quota_remaining}
                </p>
                {provider.last_error ? <p className="mt-1 text-rose-800">{provider.last_error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-lg font-semibold">Fixtures</h2>
        {overview.fixture_counts.synthetic > 0 ? (
          <p className="mt-2 text-sm text-amber-900">{overview.fixture_counts.synthetic} fixture(s) on this date are labelled synthetic.</p>
        ) : null}
        {overview.fixtures.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No fixtures for this date"
              body="Import a CSV, seed the labelled demonstration set, or refresh a configured provider. Empty dates stay empty."
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {overview.fixtures.map((fixture) => (
              <li key={fixture.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <Link href={`/matches/${fixture.id}`} className="font-medium text-tide">
                    {fixture.home} vs {fixture.away}
                  </Link>
                  <p className="text-slate-500">
                    {fixture.league} · {formatWhen(fixture.kickoff_at)} · {fixture.status}
                    {fixture.home_goals !== null && fixture.away_goals !== null
                      ? ` · ${fixture.home_goals}–${fixture.away_goals}`
                      : ""}
                  </p>
                </div>
                <OriginBadge origin={fixture.data_origin} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-ink">Settled predictions: {overview.recent_performance.settled_predictions}</p>
        <p className="mt-1">{overview.recent_performance.note}</p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
