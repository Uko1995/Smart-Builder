import Link from "next/link";
import { OriginBadge, Odds, Probability } from "@/components/indicators";
import { formatWhen } from "@/lib/format";
import type { DailyPick } from "@/lib/types";

export function PickCard({ pick }: { pick: DailyPick }) {
  return (
    <article className="panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {pick.fixture_id ? (
            <Link href={`/matches/${pick.fixture_id}`} className="font-semibold text-tide">
              {pick.match}
            </Link>
          ) : (
            <p className="font-semibold">{pick.match}</p>
          )}
          <p className="text-xs text-slate-500">
            {pick.league} · {formatWhen(pick.kickoff_at)}
          </p>
        </div>
        <div className="text-right">
          {pick.conservative ? (
            <p className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-800">Both ≥ 60%</p>
          ) : null}
          {pick.disagreement ? (
            <p className="mt-1 rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-900">Model disagrees with the book</p>
          ) : null}
          <OriginBadge origin={pick.data_origin} />
        </div>
      </div>
      <p className="text-sm">
        {pick.market_name} · {pick.selection}
        {pick.line ? ` · ${pick.line}` : ""}
      </p>
      <dl className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Book %</dt>
          <dd>
            <Probability value={pick.implied_probability} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Model %</dt>
          <dd>
            <Probability value={pick.model_probability} />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500" title="Elo rating opinion, for result markets only">
            Elo %
          </dt>
          <dd>{pick.elo_probability ? <Probability value={pick.elo_probability} /> : <span className="text-slate-400">—</span>}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Odds</dt>
          <dd>
            <Odds value={pick.decimal_odds} />
          </dd>
        </div>
      </dl>
      <p className="text-xs text-slate-500">{pick.sample_note}</p>
      <p className="text-xs text-slate-500">
        {pick.bookmaker || "No bookmaker name"} · {formatWhen(pick.captured_at)}
        {pick.reference_price ? " · reference price, check the live odds" : ""}
      </p>
    </article>
  );
}
