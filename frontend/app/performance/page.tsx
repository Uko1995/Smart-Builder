"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { formatWhen } from "@/lib/format";
import type { MetricGroup, PerformanceReport } from "@/lib/types";
import { useQuery } from "@/lib/use-query";

export default function PerformancePage() {
  const query = useQuery<PerformanceReport>("/api/v1/performance");
  const report = query.data;
  const chart = chartRows(report?.settled_real);

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Model performance</p>
      <h1 className="text-3xl font-semibold">Scores from settled predictions</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">
        Brier score and log loss appear only when a market has enough settled outcomes. Synthetic matches are counted apart from recorded ones.
      </p>
      <div className="mt-6">
        <QueryView status={query.status} error={query.error}>
          {report ? (
            <div className="space-y-6">
              <Group title="Recorded matches" group={report.settled_real} />
              <Group title="Synthetic demonstration matches" group={report.settled_synthetic} />
              {chart.length === 0 ? (
                <EmptyState
                  title="No calibration chart"
                  body="The chart is drawn from markets that already have a stored Brier score. A small sample does not get a plotted number."
                />
              ) : (
                <section className="panel p-4">
                  <h2 className="font-semibold">Brier score by market</h2>
                  <p className="mt-1 text-sm text-slate-600">Lower is closer to the outcomes. The sample size is on each bar’s market.</p>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart}>
                        <CartesianGrid stroke="#e1e7e4" vertical={false} />
                        <XAxis dataKey="market" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="brier" fill="#6b8f3c" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
              <section className="panel p-4 text-sm">
                <h2 className="font-semibold">Simulated unit returns</h2>
                <p className="mt-2 text-slate-700">
                  Status {report.simulated_returns.status.replaceAll("_", " ")} · observations {report.simulated_returns.observations}
                </p>
                {report.simulated_returns.note ? <p className="mt-1 text-slate-600">{report.simulated_returns.note}</p> : null}
                {report.simulated_returns.status === "simulated" ? (
                  <p className="mt-1">
                    Profit {report.simulated_returns.profit_units} units · max drawdown {report.simulated_returns.max_drawdown_units} units ·{" "}
                    {report.simulated_returns.stake}
                  </p>
                ) : null}
                <p className="mt-2 text-slate-500">{report.simulated_returns.disclaimer || report.disclaimer}</p>
              </section>
              <section>
                <h2 className="text-lg font-semibold">Evaluation runs</h2>
                {report.evaluation_runs.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState title="No evaluation run stored" body="Chronological evaluation is started from Data and settings, and it skips synthetic rows." />
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {report.evaluation_runs.map((run) => (
                      <li key={run.id} className="panel px-4 py-3 text-sm">
                        <p className="font-medium">
                          Run {run.id} · {run.status}
                        </p>
                        <p className="text-slate-500">{formatWhen(run.finished_at || run.started_at)}</p>
                        {run.notes ? <p className="mt-1 text-slate-600">{run.notes}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </QueryView>
      </div>
    </Shell>
  );
}

function Group({ title, group }: { title: string; group: MetricGroup }) {
  return (
    <section className="panel p-4 text-sm">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-slate-600">
        {group.status.replaceAll("_", " ")} · {group.observations} settled prediction(s)
      </p>
      {group.by_market ? (
        <ul className="mt-3 space-y-1">
          {Object.entries(group.by_market).map(([market, score]) => (
            <li key={market}>
              {market.replaceAll("_", " ")} · {score.observations} observations
              {score.status === "estimated" && score.brier_score !== undefined && score.log_loss !== undefined
                ? ` · Brier ${score.brier_score.toFixed(4)} · log loss ${score.log_loss.toFixed(4)}`
                : " · metric withheld"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-slate-500">Metrics stay hidden until the stored sample is large enough.</p>
      )}
    </section>
  );
}

function chartRows(group: MetricGroup | undefined) {
  if (!group?.by_market) return [];
  return Object.entries(group.by_market)
    .filter(([, score]) => score.status === "estimated" && typeof score.brier_score === "number")
    .map(([market, score]) => ({
      market: `${market} (n=${score.observations})`,
      brier: score.brier_score as number,
    }));
}
