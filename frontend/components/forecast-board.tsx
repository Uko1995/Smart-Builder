import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/indicators";
import { formatProbability, formatWhen } from "@/lib/format";
import type { Forecast, ForecastBoard } from "@/lib/types";

const MARKET_LABEL: Record<string, string> = { match_result: "Result", over_under_goals: "Goals 2.5", btts: "Both score" };
const SELECTION_LABEL: Record<string, string> = { home: "Home", draw: "Draw", away: "Away", over: "Over", under: "Under", yes: "Yes", no: "No" };

function MarketRow({ market, forecasts }: { market: string; forecasts: Forecast[] }) {
  const top = Math.max(...forecasts.map((item) => item.best));
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2 py-1.5">
      <p className="pt-1 text-xs uppercase tracking-wide text-slate-500">{MARKET_LABEL[market] ?? market}</p>
      <div className={`grid gap-2 ${forecasts.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {forecasts.map((item) => {
          const leading = item.best === top;
          return (
            <div
              key={item.selection}
              className={`rounded-xl border px-2 py-1 ${leading ? "border-tide bg-teal-50" : "border-line bg-white"}`}
              title={`Model ${formatProbability(item.model)}${item.elo === null ? "" : ` · Elo ${formatProbability(item.elo)}`}${
                item.market === null ? "" : ` · Bookmaker ${formatProbability(item.market)}`
              }`}
            >
              <p className="text-xs text-slate-500">{SELECTION_LABEL[item.selection] ?? item.selection}</p>
              <p className={`num text-sm ${leading ? "font-semibold text-tide" : "text-ink"}`}>{formatProbability(item.best)}</p>
              <p className="num text-[11px] text-slate-500">
                M {formatProbability(item.model)}
                {item.elo === null ? "" : ` · E ${formatProbability(item.elo)}`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ForecastBoardView({ board }: { board: ForecastBoard }) {
  const leagues = useMemo(() => [...new Set(board.matches.map((match) => match.league ?? "Other"))].sort(), [board.matches]);
  const [league, setLeague] = useState("all");
  const matches = league === "all" ? board.matches : board.matches.filter((match) => (match.league ?? "Other") === league);
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Predictions</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{board.note}</p>
        </div>
        {leagues.length > 1 ? (
          <label className="text-sm">
            League
            <select
              value={league}
              onChange={(event) => setLeague(event.target.value)}
              className="mt-1 block rounded-xl border border-line bg-white px-3 py-2"
            >
              <option value="all">All leagues ({board.matches.length})</option>
              {leagues.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {board.matches.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="No predictions for this date" body="Press Generate predictions. Matches need enough league history for the model to rate both teams." />
        </div>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {matches.map((match) => (
            <article key={match.fixture_id} className="panel px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/matches/${match.fixture_id}`} className="font-medium text-tide">
                  {match.home} vs {match.away}
                </Link>
                {match.score ? <span className="num text-sm font-medium">{match.score}</span> : null}
              </div>
              <p className="text-xs text-slate-500">
                {match.league} · {formatWhen(match.kickoff_at)}
              </p>
              <div className="mt-2 divide-y divide-line">
                {["match_result", "over_under_goals", "btts"]
                  .filter((key) => match.markets[key]?.length)
                  .map((key) => (
                    <MarketRow key={key} market={key} forecasts={match.markets[key]} />
                  ))}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Large number: best estimate. M: goals model. E: Elo. Hover a box for the bookmaker’s figure.</p>
    </section>
  );
}
