"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { EmptyState, OriginBadge, RunStatus, WarningList } from "@/components/indicators";
import { PickCard } from "@/components/pick-card";
import { QueryView } from "@/components/query-view";
import { api, ApiError } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { todayUtc } from "@/lib/scoreline";
import { groupPicks } from "@/lib/pick-tabs";
import type { DailyPick, Overview, PredictionRun } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

export default function OverviewPage() {
  const [date, setDate] = useState(todayUtc);
  const query = useQuery<Overview>(`/api/v1/overview?scope_date=${date}`);
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
    }
  }

  const overview = query.data;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Daily overview</p>
          <h1 className="text-3xl font-semibold">Today’s highest-probability picks</h1>
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
        Ranked by de-vigged bookmaker probability. The model is a second opinion. Generation runs only when you press the
        button. This application does not place bets.
      </p>
      {actionError ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {actionError}
        </p>
      ) : null}
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
      <section>
        <h2 className="text-lg font-semibold">Today’s picks</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          {overview.picks_note || "Priced selections at 50% model probability or higher, excluding trivial lines."}
        </p>
        {overview.picks.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No priced high-probability picks"
              body="Generate predictions for this date after odds have been stored. Extreme lines such as Under 4.5 are excluded. Accumulators are not built."
            />
          </div>
        ) : (
          <PickTabs picks={overview.picks} />
        )}
      </section>
      {runSucceeded && overview.warnings.length === 0 ? null : <RunStatus status={status} />}
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

function PickTabs({ picks }: { picks: DailyPick[] }) {
  const tabs = useMemo(() => groupPicks(picks), [picks]);
  const [active, setActive] = useState("all");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className="mt-3">
      <div role="tablist" aria-label="Pick categories" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === current.id}
            onClick={() => setActive(tab.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              tab.id === current.id ? "border-tide bg-tide text-white" : "border-line bg-white text-slate-700"
            }`}
          >
            {tab.label} <span className="opacity-70">({tab.total})</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mt-4">
        {current.picks.length === 0 ? (
          <EmptyState title={`No ${current.label} picks`} body="Nothing in this category cleared the probability floor with a fresh price." />
        ) : (
          <>
            {current.id === "all" && current.total > current.picks.length ? (
              <p className="mb-3 text-sm text-slate-500">
                Showing the top {current.picks.length} of {current.total}. Open a category tab to see all of its picks.
              </p>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              {current.picks.map((pick) => (
                <PickCard key={`${pick.fixture_id}-${pick.market_key}-${pick.selection}-${pick.line}`} pick={pick} />
              ))}
            </div>
          </>
        )}
      </div>
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
