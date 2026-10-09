"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { EmptyState, Odds, Probability } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { formatSigned, formatWhen } from "@/lib/format";
import { todayUtc } from "@/lib/scoreline";
import type { Coverage, ExplorerRow } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

export default function MarketsPage() {
  const coverage = useQuery<Coverage>("/api/v1/markets");
  const [filters, setFilters] = useState({
    scope_date: "",
    market_key: "",
    family: "",
    bookmaker: "",
    status: "",
    min_probability: "",
    min_odds: "",
    max_odds: "",
  });
  const [query, setQuery] = useState("");
  const rows = useQuery<{ rows: ExplorerRow[] }>(`/api/v1/explorer${query}`);

  function apply(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const text = params.toString();
    setQuery(text ? `?${text}` : "");
  }

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Market explorer</p>
      <h1 className="text-3xl font-semibold">Stored predictions and prices</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Rows come from predictions already saved. A missing price stays blank. Another bookmaker is not used to fill it.
      </p>
      <form className="panel mt-6 grid gap-3 p-4 md:grid-cols-4" onSubmit={apply}>
        <Field label="Date (UTC)" type="date" value={filters.scope_date} onChange={(value) => setFilters({ ...filters, scope_date: value })} />
        <Select
          label="Market"
          value={filters.market_key}
          onChange={(value) => setFilters({ ...filters, market_key: value })}
          options={(coverage.data?.markets || []).map((market) => ({ value: market.key, label: market.display_name }))}
        />
        <Select
          label="Family"
          value={filters.family}
          onChange={(value) => setFilters({ ...filters, family: value })}
          options={["goals", "corners", "cards", "player"].map((value) => ({ value, label: value }))}
        />
        <Select
          label="Bookmaker"
          value={filters.bookmaker}
          onChange={(value) => setFilters({ ...filters, bookmaker: value })}
          options={["bet9ja", "sportybet", "onexbet", "demo_book"].map((value) => ({ value, label: value }))}
        />
        <Field label="Status" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} />
        <Field label="Min probability" value={filters.min_probability} onChange={(value) => setFilters({ ...filters, min_probability: value })} />
        <Field label="Min odds" value={filters.min_odds} onChange={(value) => setFilters({ ...filters, min_odds: value })} />
        <Field label="Max odds" value={filters.max_odds} onChange={(value) => setFilters({ ...filters, max_odds: value })} />
        <div className="md:col-span-4 flex gap-2">
          <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm text-white">
            Apply filters
          </button>
          <button
            type="button"
            className="rounded-full border border-line px-4 py-2 text-sm"
            onClick={() => {
              setFilters({
                scope_date: todayUtc(),
                market_key: "",
                family: "",
                bookmaker: "",
                status: "",
                min_probability: "",
                min_odds: "",
                max_odds: "",
              });
            }}
          >
            Fill today’s date
          </button>
        </div>
      </form>
      <div className="mt-6">
        <QueryView status={rows.status} error={rows.error}>
          {rows.data && rows.data.rows.length === 0 ? (
            <EmptyState title="No matching predictions" body="Widen the filters or generate a run for a date that has fixtures and history." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Match</th>
                    <th className="px-3 py-2">Market</th>
                    <th className="px-3 py-2">Probability</th>
                    <th className="px-3 py-2">Odds</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data?.rows.map((row, index) => (
                    <tr key={`${row.fixture_id}-${row.market_key}-${row.selection}-${index}`} className="border-b border-line">
                      <td className="px-3 py-2">
                        <Link href={`/matches/${row.fixture_id}`} className="font-medium text-tide">
                          {row.home} vs {row.away}
                        </Link>
                        <p className="text-xs text-slate-500">{formatWhen(row.kickoff_at)}</p>
                      </td>
                      <td className="px-3 py-2">
                        {row.market_name} · {row.selection}
                        {row.line ? ` · ${row.line}` : ""}
                        <p className="text-xs text-slate-500">{row.bookmaker || "No price stored"}</p>
                      </td>
                      <td className="px-3 py-2">
                        <Probability value={row.probability} />
                      </td>
                      <td className="px-3 py-2">
                        <Odds value={row.decimal_odds} />
                        <p className="text-xs text-slate-500">{formatWhen(row.captured_at)}</p>
                      </td>
                      <td className="num px-3 py-2">{formatSigned(row.estimated_value)}</td>
                      <td className="px-3 py-2 text-slate-600">{row.implementation_status.replaceAll("_", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryView>
      </div>
    </Shell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-line px-3 py-2"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-sm">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2">
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
