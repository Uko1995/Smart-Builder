"use client";

import { useState } from "react";
import { EmptyState } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { SlipCard } from "@/components/slip-card";
import { api, ApiError } from "@/lib/api";
import type { Slip } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

export default function SlipsPage() {
  const query = useQuery<{ slips: Slip[] }>("/api/v1/slips");
  const [error, setError] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);

  async function decide(slip: Slip, action: "approve" | "reject") {
    setError(null);
    try {
      await api(`/api/v1/slips/${slip.public_id}/decision`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      query.reload();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The decision was not stored.");
    }
  }

  async function exportSlip(slip: Slip) {
    const result = await api<{ body: string }>(`/api/v1/slips/${slip.public_id}/export?export_format=text`);
    setExportText(result.body);
  }

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Daily slip lab</p>
      <h1 className="text-3xl font-semibold">Inspect, export, and review</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Approval is allowed for a verified mapping or a manually prepared slip. Synthetic demonstration slips stay labelled and are not treated as ready to stake.
      </p>
      {error ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-6">
        <QueryView status={query.status} error={query.error}>
          {query.data && query.data.slips.length === 0 ? (
            <EmptyState title="No slips stored" body="Generate predictions from the overview. If none qualify, this list stays empty." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {query.data?.slips.map((slip) => (
                <SlipCard key={slip.public_id} slip={slip} onExport={() => exportSlip(slip)} onDecision={(action) => decide(slip, action)} />
              ))}
            </div>
          )}
        </QueryView>
      </div>
      {exportText ? (
        <section className="panel mt-6 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Text export</h2>
            <button type="button" className="text-sm text-tide" onClick={() => setExportText(null)}>
              Close
            </button>
          </div>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm">{exportText}</pre>
        </section>
      ) : null}
    </Shell>
  );
}
