"use client";

import { FormEvent, useState } from "react";
import { EmptyState } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { api, ApiError } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import type { Coverage, IngestionRun } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

const EDITABLE = [
  ["odds_freshness_minutes", "Odds freshness (minutes)"],
  ["min_probability_a", "Strategy A minimum probability"],
  ["min_probability_b", "Strategy B minimum probability"],
  ["min_probability_c", "Strategy C minimum probability"],
  ["min_data_quality", "Minimum data quality"],
  ["min_team_matches", "Minimum team matches"],
  ["target_odds_min", "Combined odds minimum"],
  ["target_odds_max", "Combined odds maximum"],
  ["max_slip_legs", "Maximum slip legs"],
  ["prediction_time_budget_seconds", "Prediction time budget (seconds)"],
] as const;

export default function SettingsPage() {
  const coverage = useQuery<Coverage>("/api/v1/settings");
  const runs = useQuery<{ runs: IngestionRun[] }>("/api/v1/ingestion/runs");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<string | null>(null);

  async function loadEnvironment() {
    if (environment) return;
    const health = await api<{ environment?: string }>("/health");
    setEnvironment(health.environment || "unknown");
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes: Record<string, number | boolean> = {};
    for (const [key] of EDITABLE) {
      changes[key] = Number(form.get(key));
    }
    changes.allow_synthetic = form.get("allow_synthetic") === "on";
    setError(null);
    setMessage(null);
    try {
      await api("/api/v1/settings", { method: "PUT", body: JSON.stringify({ changes }) });
      setMessage("Thresholds stored.");
      coverage.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Settings were not stored.");
    }
  }

  async function refresh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ failed: boolean }>("/api/v1/ingestion/refresh", {
        method: "POST",
        body: JSON.stringify({
          date_from: String(form.get("date_from")),
          date_to: String(form.get("date_to")),
          force: form.get("force") === "on",
        }),
      });
      setMessage(result.failed ? "Refresh finished with at least one failed provider. See the log." : "Refresh finished.");
      runs.reload();
      coverage.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Refresh failed.");
    }
  }

  async function importCsv(path: string, raw: string) {
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ written: number; label: string }>(path, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: raw,
      });
      setMessage(`${result.written} row(s) written. ${result.label}`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Import failed.");
    }
  }

  async function seedDemo() {
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ label: string; completed_matches: number; scope_date: string }>("/api/v1/demo/seed", { method: "POST" });
      setMessage(`${result.label}: ${result.completed_matches} completed matches. Upcoming scope ${result.scope_date}.`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Demo data was not seeded.");
    }
  }

  async function evaluate() {
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ evaluation: { status?: string } }>("/api/v1/evaluation", { method: "POST" });
      setMessage(`Evaluation stored with status ${result.evaluation.status || "recorded"}. Synthetic rows are excluded.`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Evaluation did not finish.");
    }
  }

  const settings = coverage.data?.settings;

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Data and settings</p>
      <h1 className="text-3xl font-semibold">Sources, thresholds, and imports</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        API keys stay on the server. This page shows only whether a provider is configured.
      </p>
      {message ? <p className="mt-3 text-sm text-tide">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-800">{error}</p> : null}
      <div className="mt-6 space-y-6">
        <QueryView status={coverage.status} error={coverage.error}>
          {coverage.data && settings ? (
            <>
              <section className="grid gap-3 md:grid-cols-3">
                <Secret label="API-Football" configured={coverage.data.secrets.api_football_configured} />
                <Secret label="The Odds API" configured={coverage.data.secrets.odds_api_configured} />
                <Secret label="football-data.org" configured={coverage.data.secrets.football_data_configured} />
              </section>
              <section>
                <h2 className="text-lg font-semibold">Market catalogue</h2>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {coverage.data.markets.map((market) => (
                    <li key={market.key} className="panel px-4 py-3 text-sm">
                      <p className="font-medium">{market.display_name}</p>
                      <p className="text-slate-600">
                        {market.family} · {market.implementation_status.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-slate-500">{market.required_data}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel p-4">
                <h2 className="font-semibold">Thresholds</h2>
                <form key={JSON.stringify(settings)} className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={saveSettings}>
                  {EDITABLE.map(([key, label]) => (
                    <label key={key} className="text-sm">
                      {label}
                      <input
                        name={key}
                        defaultValue={String(settings[key] ?? "")}
                        className="mt-1 w-full rounded-xl border border-line px-3 py-2"
                        required
                      />
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input name="allow_synthetic" type="checkbox" defaultChecked={Boolean(settings.allow_synthetic)} />
                    Allow synthetic fixtures in prediction runs
                  </label>
                  <button type="submit" className="w-fit rounded-full bg-ink px-4 py-2 text-sm text-white">
                    Save thresholds
                  </button>
                </form>
              </section>
            </>
          ) : null}
        </QueryView>
        <section className="panel p-4">
          <h2 className="font-semibold">Refresh configured providers</h2>
          <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={refresh}>
            <label className="text-sm">
              From
              <input name="date_from" type="date" required className="mt-1 block rounded-xl border border-line px-3 py-2" />
            </label>
            <label className="text-sm">
              To
              <input name="date_to" type="date" required className="mt-1 block rounded-xl border border-line px-3 py-2" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input name="force" type="checkbox" />
              Ignore the refetch window
            </label>
            <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm">
              Refresh
            </button>
          </form>
        </section>
        <section>
          <h2 className="text-lg font-semibold">Ingestion log</h2>
          <div className="mt-3">
            <QueryView status={runs.status} error={runs.error}>
              {runs.data && runs.data.runs.length === 0 ? (
                <EmptyState title="No ingestion runs" body="A refresh or import creates a log row. There is nothing to show yet." />
              ) : (
                <ul className="space-y-2">
                  {runs.data?.runs.map((run) => (
                    <li key={run.id} className="panel px-4 py-3 text-sm">
                      <p className="font-medium">
                        {run.provider || "manual"} · {run.kind} · {run.status}
                      </p>
                      <p className="text-slate-600">
                        {run.records_written} written · {formatWhen(run.finished_at || run.started_at)}
                      </p>
                      {run.error_message ? <p className="text-rose-800">{run.error_message}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </QueryView>
          </div>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <CsvBox
            title="Import fixtures"
            hint="Required columns: external_id, league, season, kickoff_utc, home_team, away_team, status, data_origin. data_origin is manual or synthetic_demo."
            onSubmit={(raw) => importCsv("/api/v1/imports/fixtures", raw)}
          />
          <CsvBox
            title="Import odds"
            hint="Required columns: fixture_external_id, bookmaker_key, market_key, selection, decimal_odds, captured_at_utc, data_origin."
            onSubmit={(raw) => importCsv("/api/v1/imports/odds", raw)}
          />
        </section>
        <section className="panel space-y-3 p-4 text-sm">
          <h2 className="font-semibold">Local actions</h2>
          <p className="text-slate-600">
            The demonstration seed is labelled synthetic and is refused in production. Evaluation uses completed recorded matches only.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-full border border-line px-3 py-1.5" onClick={() => void loadEnvironment()}>
              Check environment
            </button>
            <button type="button" className="rounded-full border border-line px-3 py-1.5" onClick={() => void seedDemo()}>
              Seed synthetic demo
            </button>
            <button type="button" className="rounded-full border border-line px-3 py-1.5" onClick={() => void evaluate()}>
              Run evaluation
            </button>
          </div>
          {environment ? <p>Environment: {environment}</p> : null}
        </section>
      </div>
    </Shell>
  );
}

function Secret({ label, configured }: { label: string; configured: boolean }) {
  return (
    <div className="panel px-4 py-3 text-sm">
      <p className="font-medium">{label}</p>
      <p className="text-slate-600">{configured ? "Configured" : "Not configured"}</p>
    </div>
  );
}

function CsvBox({ title, hint, onSubmit }: { title: string; hint: string; onSubmit: (raw: string) => void }) {
  return (
    <form
      className="panel p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const raw = String(new FormData(event.currentTarget).get("csv") || "");
        onSubmit(raw);
      }}
    >
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{hint}</p>
      <textarea name="csv" required rows={6} className="mt-3 w-full rounded-xl border border-line px-3 py-2 font-mono text-xs" />
      <button type="submit" className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-white">
        Import
      </button>
    </form>
  );
}
