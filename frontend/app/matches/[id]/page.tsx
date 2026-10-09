"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, Odds, Probability } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { api, ApiError } from "@/lib/api";
import { formatProbability, formatWhen } from "@/lib/format";
import { topScorelines } from "@/lib/scoreline";
import type { MatchDetail } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const query = useQuery<MatchDetail>(`/api/v1/fixtures/${id}`);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, number> = {
      home_goals: Number(form.get("home_goals")),
      away_goals: Number(form.get("away_goals")),
    };
    for (const key of ["ht_home_goals", "ht_away_goals", "home_corners", "away_corners", "home_cards", "away_cards"]) {
      const raw = String(form.get(key) || "");
      if (raw !== "") body[key] = Number(raw);
    }
    setError(null);
    setMessage(null);
    try {
      await api(`/api/v1/fixtures/${id}/result`, { method: "POST", body: JSON.stringify(body) });
      setMessage("Result stored. Existing predictions are not rewritten.");
      query.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The result was not stored.");
    }
  }

  const detail = query.data;
  const bars = topScorelines(detail?.model.scoreline).map((row) => ({
    ...row,
    label: formatProbability(row.probability),
  }));

  return (
    <Shell>
      <Link href="/" className="text-sm text-tide">
        Back to overview
      </Link>
      <QueryView status={query.status} error={query.error}>
        {detail ? (
          <div className="mt-4 space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{detail.fixture.league}</p>
              <h1 className="text-3xl font-semibold">
                {detail.fixture.home} vs {detail.fixture.away}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {formatWhen(detail.fixture.kickoff_at)} · {detail.fixture.status} · {detail.fixture.data_origin.replaceAll("_", " ")}
              </p>
            </div>
            <section className="grid gap-4 md:grid-cols-2">
              <Record title={`${detail.fixture.home} measured history`} form={detail.measured.home_form} record={detail.measured.home_record} />
              <Record title={`${detail.fixture.away} measured history`} form={detail.measured.away_form} record={detail.measured.away_record} />
            </section>
            <section className="panel p-4">
              <h2 className="font-semibold">Model scoreline</h2>
              <p className="mt-1 text-sm text-slate-600">{detail.model.note}</p>
              {detail.model.model_version ? <p className="mt-1 text-xs text-slate-500">Version {detail.model.model_version}</p> : null}
              {!detail.model.available || bars.length === 0 ? (
                <div className="mt-3">
                  <EmptyState title="No scoreline stored" body="Generate predictions after both teams have enough completed matches in this competition." />
                </div>
              ) : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bars}>
                      <CartesianGrid stroke="#e1e7e4" vertical={false} />
                      <XAxis dataKey="score" />
                      <YAxis tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} />
                      <Tooltip formatter={(value) => formatProbability(Number(value))} />
                      <Bar dataKey="probability" fill="#0f766e" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <section>
              <h2 className="text-lg font-semibold">Stored selections</h2>
              {detail.model.predictions.length === 0 ? (
                <div className="mt-3">
                  <EmptyState title="No predictions for this match" body="Markets without a stored probability are listed below and are not filled with a guess." />
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                  {detail.model.predictions.map((row) => (
                    <li key={`${row.market_key}-${row.selection}-${row.line}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">
                          {row.market_key.replaceAll("_", " ")} · {row.selection}
                          {row.line ? ` · ${row.line}` : ""}
                        </p>
                        <p className="text-slate-500">
                          Sample {row.sample_size} · quality {row.data_quality ?? "—"} · {row.implementation_status.replaceAll("_", " ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <Probability value={row.probability} />
                        <p className="text-xs text-slate-500">
                          Fair <Odds value={row.fair_odds} />
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="text-lg font-semibold">Unavailable markets</h2>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {detail.unavailable_markets.map((market) => (
                  <li key={market.key} className="panel px-4 py-3 text-sm">
                    <p className="font-medium">{market.display_name}</p>
                    <p className="text-slate-600">{market.implementation_status.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-slate-500">{market.required_data}</p>
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel p-4">
              <h2 className="font-semibold">Record a verified result</h2>
              <p className="mt-1 text-sm text-slate-600">Enter a score you have checked. This form does not look up a result.</p>
              <form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={saveResult}>
                <NumberField name="home_goals" label="Home goals" required />
                <NumberField name="away_goals" label="Away goals" required />
                <NumberField name="home_corners" label="Home corners" />
                <NumberField name="away_corners" label="Away corners" />
                <NumberField name="home_cards" label="Home cards" />
                <NumberField name="away_cards" label="Away cards" />
                <div className="md:col-span-4">
                  <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm text-white">
                    Store result
                  </button>
                </div>
              </form>
              {message ? <p className="mt-3 text-sm text-tide">{message}</p> : null}
              {error ? <p className="mt-3 text-sm text-rose-800">{error}</p> : null}
            </section>
          </div>
        ) : null}
      </QueryView>
    </Shell>
  );
}

function Record({
  title,
  form,
  record,
}: {
  title: string;
  form: string[];
  record: { matches: number; goals_for: number; goals_against: number };
}) {
  return (
    <article className="panel p-4 text-sm">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-slate-600">Last five results: {form.length ? form.join(" ") : "none stored"}</p>
      <p className="mt-1 text-slate-600">
        Split sample {record.matches} · goals {record.goals_for} for, {record.goals_against} against
      </p>
    </article>
  );
}

function NumberField({ name, label, required = false }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="text-sm">
      {label}
      <input name={name} type="number" min={0} required={required} className="mt-1 w-full rounded-xl border border-line px-3 py-2" />
    </label>
  );
}
