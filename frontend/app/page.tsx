"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Shell } from "@/components/shell";
import { EmptyState, OriginBadge, RunStatus, WarningList } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { SlipCard } from "@/components/slip-card";
import { api, ApiError } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { todayUtc } from "@/lib/scoreline";
import type { Overview, PredictionRun } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

export default function OverviewPage() {
  const [date, setDate] = useState(todayUtc);
  const query = useQuery<Overview>(`/api/v1/overview?scope_date=${date}`);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      await api<PredictionRun>("/api/v1/prediction-runs", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ scope_date: date }),
      });
    } catch (reason) {
      setActionError(reason instanceof ApiError ? reason.message : "Prediction generation failed.");
    } finally {
      setPending(false);
      query.reload();
    }
  }

  async function exportSlip(publicId: string) {
    const result = await api<{ body: string }>(`/api/v1/slips/${publicId}/export?export_format=text`);
    setExportText(result.body);
  }

  const overview = query.data;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Daily overview</p>
          <h1 className="text-3xl font-semibold">What is stored for this date</h1>
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
        Generation runs only when you press the button. A stored failure stays a failure. The button stays disabled until this request finishes.
      </p>
      {actionError ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="mt-6">
        <QueryView status={query.status} error={query.error}>
          {overview ? <OverviewBody overview={overview} onExport={exportSlip} /> : null}
        </QueryView>
      </div>
      {exportText ? (
        <section className="panel mt-6 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Slip export</h2>
            <button type="button" className="text-sm text-tide" onClick={() => setExportText(null)}>
              Close
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm text-slate-700">{exportText}</pre>
        </section>
      ) : null}
    </Shell>
  );
}

function OverviewBody({ overview, onExport }: { overview: Overview; onExport: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Timezone" value={overview.timezone} />
        <Stat label="Scheduled fixtures" value={String(overview.fixture_counts.scheduled)} />
        <Stat label="Completed fixtures" value={String(overview.fixture_counts.completed)} />
        <Stat label="Latest odds" value={formatWhen(overview.latest_odds_captured_at)} />
      </div>
      <RunStatus status={overview.latest_run?.status} />
      <WarningList items={overview.warnings} />
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
      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Candidate slips</h2>
          <Link href="/slips" className="text-sm text-tide">
            Open slip lab
          </Link>
        </div>
        {overview.slips.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No slips stored for the latest run"
              body="A run can finish without a qualifying slip. The page does not invent a third slip to fill the row."
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            {overview.slips.slice(0, 3).map((slip) => (
              <SlipCard key={slip.public_id} slip={slip} onExport={() => onExport(slip.public_id)} />
            ))}
          </div>
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
