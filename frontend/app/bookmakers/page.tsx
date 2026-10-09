"use client";

import { FormEvent, useState } from "react";
import { EmptyState, Odds, OriginBadge } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { api, ApiError } from "@/lib/api";
import type { Coverage, Slip } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

const BOOKS = [
  { key: "bet9ja", name: "Bet9ja" },
  { key: "sportybet", name: "SportyBet" },
  { key: "onexbet", name: "1xBet" },
] as const;

export default function BookmakersPage() {
  const [book, setBook] = useState<(typeof BOOKS)[number]["key"]>("bet9ja");
  const coverage = useQuery<Coverage>("/api/v1/coverage");
  const slips = useQuery<{ slips: Slip[] }>("/api/v1/slips");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveCode(event: FormEvent<HTMLFormElement>, slip: Slip) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/v1/slips/${slip.public_id}/booking-code`, {
        method: "POST",
        body: JSON.stringify({ bookmaker_key: book, booking_code: String(form.get("booking_code") || "") }),
      });
      setNotice("Booking code stored for this bookmaker only. It is not checked against the bookmaker.");
      slips.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The booking code was not stored.");
    }
  }

  const mappings = (coverage.data?.mappings || []).filter((mapping) => mapping.bookmaker === book);
  const relevant = (slips.data?.slips || []).filter((slip) => slip.selections.some((selection) => selection.bookmaker_key === book));

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Bookmaker preparation</p>
      <h1 className="text-3xl font-semibold">Check a slip before you type it</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Prices stay with the bookmaker that supplied them. This page does not log in, place a bet, or copy an odds value from one book onto another.
      </p>
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Bookmakers">
        {BOOKS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={book === item.key}
            className={`rounded-full px-3 py-1.5 text-sm ${book === item.key ? "bg-ink text-white" : "border border-line bg-white"}`}
            onClick={() => setBook(item.key)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {notice ? <p className="mt-3 text-sm text-tide">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-800">{error}</p> : null}
      <div className="mt-6 space-y-6">
        <QueryView status={coverage.status} error={coverage.error}>
          <section>
            <h2 className="text-lg font-semibold">Mapping</h2>
            {mappings.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="No mapping stored" body="A market without a mapping is unavailable for this bookmaker." />
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {mappings.map((mapping) => (
                  <li key={`${mapping.market_key}-${mapping.provider_market_key}`} className="panel px-4 py-3 text-sm">
                    <p className="font-medium">
                      {mapping.market_key} · {mapping.status.replaceAll("_", " ")}
                    </p>
                    <p className="text-slate-600">{mapping.notes}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </QueryView>
        <QueryView status={slips.status} error={slips.error}>
          <section>
            <h2 className="text-lg font-semibold">Slips with a {book} price</h2>
            {relevant.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Nothing to prepare"
                  body="No stored slip selection uses this bookmaker. A price from another book is not shown in its place."
                />
              </div>
            ) : (
              <ul className="mt-3 space-y-4">
                {relevant.map((slip) => {
                  const mixed = new Set(slip.selections.map((selection) => selection.bookmaker_key)).size > 1;
                  return (
                    <li key={slip.public_id} className="panel p-4">
                      <p className="font-semibold">{slip.label}</p>
                      <p className="text-sm text-slate-600">{slip.preparation_status.replaceAll("_", " ")}</p>
                      {mixed ? (
                        <p className="mt-2 text-sm text-amber-900">
                          This slip mixes bookmakers. Only the {book} rows below belong on this tab.
                        </p>
                      ) : null}
                      <ul className="mt-3 space-y-2 text-sm">
                        {slip.selections
                          .filter((selection) => selection.bookmaker_key === book)
                          .map((selection) => (
                            <li key={selection.position} className="rounded-xl border border-line px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-medium">{selection.match}</p>
                                <OriginBadge origin={selection.data_origin} />
                              </div>
                              <p>
                                {selection.market_name} · {selection.selection}
                                {selection.line ? ` · ${selection.line}` : ""} · <Odds value={selection.decimal_odds} />
                              </p>
                              <p className="text-slate-500">Mapping {selection.mapping_status || "unknown"}</p>
                            </li>
                          ))}
                      </ul>
                      {slip.booking_bookmaker === book && slip.booking_code ? (
                        <p className="mt-3 text-sm">
                          Stored code for {book}: <span className="num">{slip.booking_code}</span>
                        </p>
                      ) : null}
                      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => saveCode(event, slip)}>
                        <input
                          name="booking_code"
                          maxLength={64}
                          placeholder="Code you created on this bookmaker"
                          className="rounded-xl border border-line px-3 py-2 text-sm"
                          required
                        />
                        <button type="submit" className="rounded-full border border-line px-3 py-2 text-sm">
                          Save booking code
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </QueryView>
      </div>
    </Shell>
  );
}
