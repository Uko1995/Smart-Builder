import { Odds, OriginBadge, Probability, WarningList } from "@/components/indicators";
import { formatSigned } from "@/lib/format";
import type { Slip } from "@/lib/types";

export function SlipCard({
  slip,
  onExport,
  onDecision,
}: {
  slip: Slip;
  onExport?: () => void;
  onDecision?: (action: "approve" | "reject") => void;
}) {
  return (
    <article className="panel flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{slip.strategy.replaceAll("_", " ")}</p>
          <h3 className="text-lg font-semibold">{slip.label}</h3>
        </div>
        <div className="text-right text-xs text-slate-600">
          <p className="rounded-full bg-slate-100 px-2 py-1">{slip.preparation_status.replaceAll("_", " ")}</p>
          <p className="mt-1">Review: {slip.review_status.replaceAll("_", " ")}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-slate-500">Combined odds</dt>
          <dd className="text-xl">
            <Odds value={slip.combined_odds} />
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Selections</dt>
          <dd className="num text-xl">{slip.selection_count}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Joint probability</dt>
          <dd>
            <Probability value={slip.joint_probability} />
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Estimated value</dt>
          <dd className="num">{formatSigned(slip.expected_value)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">Joint method: {slip.joint_probability_method.replaceAll("_", " ")}. Value status: {slip.ev_status}.</p>
      <div className="mt-3">
        <WarningList items={slip.warnings} />
      </div>
      <ol className="mt-4 space-y-3">
        {slip.selections.map((selection) => (
          <li key={`${selection.position}-${selection.match}`} className="rounded-xl border border-line px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{selection.match}</p>
              <OriginBadge origin={selection.data_origin} />
            </div>
            <p className="text-slate-600">
              {selection.market_name} · {selection.selection}
              {selection.line ? ` · line ${selection.line}` : ""} · odds <Odds value={selection.decimal_odds} />
              {selection.bookmaker_name ? ` · ${selection.bookmaker_name}` : ""}
            </p>
            {selection.odds_changed ? (
              <p className="mt-1 text-amber-900">
                Captured odds differ from the newest stored price (<Odds value={selection.latest_decimal_odds} />). The slip still shows the captured price.
              </p>
            ) : null}
            <p className="mt-1 text-slate-700">{selection.rationale}</p>
          </li>
        ))}
      </ol>
      {slip.diagnostics?.omitted && Object.keys(slip.diagnostics.omitted).length > 0 ? (
        <div className="mt-3 text-sm text-slate-600">
          <p className="font-medium text-ink">Why other strategies were left out</p>
          <ul className="mt-1 list-disc pl-4">
            {Object.entries(slip.diagnostics.omitted).map(([strategy, reason]) => (
              <li key={strategy}>
                {strategy.replaceAll("_", " ")}: {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {onExport ? (
          <button type="button" className="rounded-full bg-ink px-3 py-1.5 text-sm text-white" onClick={onExport}>
            Export
          </button>
        ) : null}
        {onDecision ? (
          <>
            <button type="button" className="rounded-full border border-line px-3 py-1.5 text-sm" onClick={() => onDecision("approve")}>
              Approve for manual entry
            </button>
            <button type="button" className="rounded-full border border-line px-3 py-1.5 text-sm" onClick={() => onDecision("reject")}>
              Reject
            </button>
          </>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-slate-500">{slip.disclaimer}</p>
    </article>
  );
}
