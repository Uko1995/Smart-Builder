"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInterval } from "@/components/value-board";
import { EmptyState } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { api, ApiError } from "@/lib/api";
import { formatOdds, formatProbability, formatWhen } from "@/lib/format";
import { todayUtc } from "@/lib/scoreline";
import type { PaperReport, PaperStrategy } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

const COLORS = ["#0f766e", "#6b8f3c", "#b45309"];
const MARKET_LABEL: Record<string, string> = { "1x2": "Result", ou25: "Goals 2.5" };

function tone(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-ink";
  return value > 0 ? "text-emerald-700" : "text-rose-700";
}

export default function PaperPage() {
  const query = useQuery<PaperReport>("/api/v1/paper");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  async function runNow() {
    setPending(true);
    setMessage(null);
    try {
      const result = await api<{ recorded: number; considered: number }>(`/api/v1/paper/run?scope_date=${todayUtc()}`, { method: "POST" });
      setMessage(
        result.recorded
          ? `Recorded ${result.recorded} new paper bet(s).`
          : "No new bets. Either nothing qualified, today's bets are already recorded, or there are no fresh prices.",
      );
    } catch (reason) {
      setMessage(reason instanceof ApiError ? reason.message : "The bot run failed.");
    } finally {
      setPending(false);
      query.reload();
    }
  }

  const report = query.data;
  const chart = useMemo(() => {
    if (!report) return [];
    const length = Math.max(...report.strategies.map((strategy) => strategy.curve.length));
    return Array.from({ length }, (_, index) => {
      const point: Record<string, number> = { bet: index };
      for (const strategy of report.strategies) {
        const entry = strategy.curve[Math.min(index, strategy.curve.length - 1)];
        point[strategy.key] = entry.bankroll;
      }
      return point;
    });
  }, [report]);
  const bets = report ? report.bets.filter((bet) => filter === "all" || bet.strategy === filter) : [];

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Paper betting bot</p>
          <h1 className="text-3xl font-semibold">Practice bets, no money</h1>
        </div>
        <button type="button" onClick={runNow} disabled={pending} className="rounded-full bg-tide px-4 py-2 text-sm text-white disabled:opacity-60">
          {pending ? "Running…" : "Run bot for today"}
        </button>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        The bot runs every morning after predictions (and whenever you press Generate). It records each strategy&apos;s bets before
        kick-off, settles them from results, and keeps a paper bankroll for each strategy.
      </p>
      {message ? <p className="mt-3 rounded-xl border border-line bg-white px-3 py-2 text-sm">{message}</p> : null}
      <div className="mt-6">
        <QueryView status={query.status} error={query.error}>
          {report ? (
            <div className="space-y-6">
              <p className="text-sm text-slate-600">{report.note}</p>
              <div className="grid gap-4 lg:grid-cols-3">
                {report.strategies.map((strategy) => (
                  <StrategyCard key={strategy.key} strategy={strategy} start={report.starting_bankroll_units} />
                ))}
              </div>
              {chart.length > 1 ? (
                <section className="panel p-4">
                  <h2 className="font-semibold">Paper bankroll by settled bet</h2>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chart}>
                        <CartesianGrid stroke="#e1e7e4" vertical={false} />
                        <XAxis dataKey="bet" />
                        <YAxis domain={["auto", "auto"]} />
                        <Tooltip />
                        <Legend />
                        {report.strategies.map((strategy, index) => (
                          <Line key={strategy.key} type="monotone" dataKey={strategy.key} name={strategy.name} stroke={COLORS[index % COLORS.length]} dot={false} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ) : null}
              <section>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 className="text-lg font-semibold">Bets</h2>
                  <select value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm">
                    <option value="all">All strategies</option>
                    {report.strategies.map((strategy) => (
                      <option key={strategy.key} value={strategy.key}>
                        {strategy.name}
                      </option>
                    ))}
                  </select>
                </div>
                {bets.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState title="No paper bets yet" body="Generate predictions for today or press Run bot for today. Bets need a fresh price from one of your bookmakers." />
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Match</th>
                          <th className="px-3 py-2">Strategy</th>
                          <th className="px-3 py-2">Bet</th>
                          <th className="px-3 py-2">Price</th>
                          <th className="px-3 py-2">Stake</th>
                          <th className="px-3 py-2">Result</th>
                          <th className="px-3 py-2">CLV</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {bets.map((bet) => (
                          <tr key={bet.id}>
                            <td className="px-3 py-2">
                              <Link href={`/matches/${bet.fixture_id}`} className="font-medium text-tide">
                                {bet.match}
                              </Link>
                              <p className="text-xs text-slate-500">
                                {bet.league} · {formatWhen(bet.kickoff_at)}
                              </p>
                            </td>
                            <td className="px-3 py-2 text-xs">{report.strategies.find((item) => item.key === bet.strategy)?.name ?? bet.strategy}</td>
                            <td className="px-3 py-2">
                              <p className="font-medium capitalize">{bet.selection}</p>
                              <p className="text-xs text-slate-500">
                                {MARKET_LABEL[bet.market]} · {formatProbability(bet.probability)} · edge {(bet.edge * 100).toFixed(1)}%
                              </p>
                            </td>
                            <td className="px-3 py-2">
                              <p className="num">{formatOdds(bet.price)}</p>
                              <p className="text-xs text-slate-500">{bet.bookmaker}</p>
                            </td>
                            <td className="num px-3 py-2">{bet.stake_units.toFixed(2)} u</td>
                            <td className={`num px-3 py-2 ${tone(bet.profit_units)}`}>
                              {bet.result ? `${bet.result} ${bet.score ?? ""} (${bet.profit_units! > 0 ? "+" : ""}${bet.profit_units!.toFixed(2)})` : "open"}
                            </td>
                            <td className={`num px-3 py-2 ${tone(bet.clv)}`}>{bet.clv === null ? "—" : `${(bet.clv * 100).toFixed(1)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </QueryView>
      </div>
    </Shell>
  );
}

function StrategyCard({ strategy, start }: { strategy: PaperStrategy; start: number }) {
  return (
    <section className="panel p-4 text-sm">
      <h2 className="font-semibold">{strategy.name}</h2>
      <p className="mt-1 text-xs text-slate-500">{strategy.rule}</p>
      <p className={`num mt-3 text-2xl font-semibold ${tone(strategy.profit_units)}`}>
        {strategy.bankroll_units.toFixed(2)} u
      </p>
      <p className="text-xs text-slate-500">
        from {start} u · {strategy.profit_units >= 0 ? "+" : ""}
        {strategy.profit_units.toFixed(2)} u
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Bets</dt>
        <dd className="num">
          {strategy.bets} ({strategy.open} open)
        </dd>
        <dt className="text-slate-500">Won</dt>
        <dd className="num">
          {strategy.won} of {strategy.settled}
        </dd>
        <dt className="text-slate-500">ROI</dt>
        <dd className="num">{formatInterval(strategy.roi)}</dd>
        <dt className="text-slate-500">CLV ({strategy.with_clv})</dt>
        <dd className="num">{formatInterval(strategy.clv)}</dd>
        <dt className="text-slate-500">Max drawdown</dt>
        <dd className="num">{strategy.max_drawdown_units.toFixed(2)} u</dd>
      </dl>
    </section>
  );
}
