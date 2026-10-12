"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/indicators";
import { QueryView } from "@/components/query-view";
import { Shell } from "@/components/shell";
import { formatProbability, formatWhen } from "@/lib/format";
import type { CalibrationReport, HeadToHead, MetricGroup, PerformanceReport } from "@/lib/types";
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
              {report.calibration ? <Calibration report={report.calibration} /> : null}
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

function percent(value: number | null): string {
  return value === null ? "—" : formatProbability(value);
}

function HeadToHeadLine({ label, otherLabel, result }: { label: string; otherLabel: string; result: HeadToHead }) {
  if (result.status !== "estimated" || !result.model || !result.other) {
    return (
      <li>
        {label}: needs 20 settled rows with both opinions (have {result.observations}).
      </li>
    );
  }
  const better = result.model.brier_score <= result.other.brier_score ? "Model" : otherLabel;
  return (
    <li>
      {label} on {result.observations} rows: model Brier {result.model.brier_score.toFixed(4)} vs {otherLabel.toLowerCase()}{" "}
      {result.other.brier_score.toFixed(4)} · log loss {result.model.log_loss.toFixed(4)} vs {result.other.log_loss.toFixed(4)} ·{" "}
      <span className="font-medium">{better} closer</span>
    </li>
  );
}

function Calibration({ report }: { report: CalibrationReport }) {
  const chart = report.buckets.map((bucket) => ({
    band: `${Math.round(bucket.low * 100)}–${Math.round(bucket.high * 100)}%`,
    predicted: bucket.mean_probability,
    actual: bucket.hit_rate,
    n: bucket.observations,
  }));
  return (
    <section className="panel p-4 text-sm">
      <h2 className="font-semibold">Calibration: do the percentages come true?</h2>
      <p className="mt-1 text-slate-600">
        {report.observations} settled selection(s) in the pick markets. A well-calibrated 70% call wins about 70% of the time. {report.note}
      </p>
      <p className="mt-2">
        Picks (priced, model ≥ {formatProbability(report.min_pick_probability)}): {report.picks.observations} settled · expected{" "}
        {percent(report.picks.mean_probability)} · actual {percent(report.picks.hit_rate)}
      </p>
      {chart.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="Nothing settled yet" body="Predictions are graded after their matches finish and a data refresh records the result." />
        </div>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart}>
              <CartesianGrid stroke="#e1e7e4" vertical={false} />
              <XAxis dataKey="band" />
              <YAxis domain={[0, 1]} tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} />
              <Tooltip formatter={(value, name) => [formatProbability(Number(value)), name === "actual" ? "Won" : "Model said"]} />
              <Legend formatter={(name) => (name === "actual" ? "Won" : "Model said")} />
              <Bar dataKey="actual" fill="#6b8f3c" radius={[6, 6, 0, 0]} />
              <Line dataKey="predicted" stroke="#0f766e" strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <ul className="mt-3 space-y-1">
        <HeadToHeadLine label="Model vs bookmaker" otherLabel="Bookmaker" result={report.model_vs_market} />
        <HeadToHeadLine label="Model vs Elo" otherLabel="Elo" result={report.model_vs_elo} />
      </ul>
      {Object.keys(report.by_market).length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-4">Market</th>
                <th className="py-1 pr-4">Settled</th>
                <th className="py-1 pr-4">Expected</th>
                <th className="py-1 pr-4">Won</th>
                <th className="py-1 pr-4">Picks</th>
                <th className="py-1 pr-4">Picks expected</th>
                <th className="py-1">Picks won</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.by_market).map(([market, row]) => (
                <tr key={market} className="border-t border-line">
                  <td className="py-1 pr-4">{market.replaceAll("_", " ")}</td>
                  <td className="py-1 pr-4">{row.all.observations}</td>
                  <td className="py-1 pr-4">{percent(row.all.mean_probability)}</td>
                  <td className="py-1 pr-4">{percent(row.all.hit_rate)}</td>
                  <td className="py-1 pr-4">{row.picks.observations}</td>
                  <td className="py-1 pr-4">{percent(row.picks.mean_probability)}</td>
                  <td className="py-1">{percent(row.picks.hit_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
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
