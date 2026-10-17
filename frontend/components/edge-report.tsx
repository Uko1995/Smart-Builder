import { EmptyState } from "@/components/indicators";
import { formatInterval } from "@/components/value-board";
import { formatOdds, formatWhen } from "@/lib/format";
import type { BetRecord, EdgeBacktestSummary, EdgeSegment, Interval } from "@/lib/types";

const MARKET_LABEL: Record<string, string> = { "1x2": "Match result", ou25: "Over/under 2.5" };
const BASIS_LABEL: Record<string, string> = { best_early: "Best price", bet365_early: "Bet365", best_closing: "Best closing" };
const SOURCE_LABEL: Record<string, string> = { model: "Goals model", elo: "Elo", blend: "Blend", market: "Market only (control)" };

function tone(value: Interval | null | undefined): string {
  if (!value) return "text-slate-500";
  if (value.low > 0) return "text-emerald-700 font-medium";
  if (value.high < 0) return "text-rose-700";
  return "text-slate-700";
}

function delta(value: { minus_closing: Interval | null } | undefined): string {
  const m = value?.minus_closing;
  return m ? `${m.estimate >= 0 ? "+" : ""}${m.estimate.toFixed(4)} [${m.low.toFixed(4)}, ${m.high.toFixed(4)}]` : "—";
}

export function BetRecordView({ record }: { record: BetRecord }) {
  const { overall } = record;
  return (
    <section className="panel p-4 text-sm">
      <h2 className="font-semibold">Recorded bets: closing-line value</h2>
      <p className="mt-1 max-w-3xl text-slate-600">{record.note}</p>
      {overall.bets === 0 ? (
        <div className="mt-3">
          <EmptyState title="No bets recorded" body="Bets are recorded only when the expected-value board shows one, which needs an approved segment." />
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Mean CLV ({overall.with_closing_price} with a close)</p>
              <p className={`num mt-1 ${tone(overall.clv)}`}>{formatInterval(overall.clv, 2)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Profit ({overall.settled} settled)</p>
              <p className="num mt-1">{overall.profit_units.toFixed(2)} units</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">ROI</p>
              <p className={`num mt-1 ${tone(overall.roi)}`}>{formatInterval(overall.roi)}</p>
            </div>
          </div>
          <table className="mt-4 w-full text-left">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-4">Segment</th>
                <th className="py-1 pr-4">Bets</th>
                <th className="py-1 pr-4">CLV [95% CI]</th>
                <th className="py-1 pr-4">Profit</th>
                <th className="py-1">ROI [95% CI]</th>
              </tr>
            </thead>
            <tbody>
              {record.segments.map((segment) => (
                <tr key={segment.segment_key} className="border-t border-line">
                  <td className="py-1 pr-4">{segment.segment_key}</td>
                  <td className="num py-1 pr-4">{segment.bets}</td>
                  <td className={`num py-1 pr-4 ${tone(segment.clv)}`}>{formatInterval(segment.clv, 2)}</td>
                  <td className="num py-1 pr-4">{segment.profit_units.toFixed(2)}</td>
                  <td className={`num py-1 ${tone(segment.roi)}`}>{formatInterval(segment.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="mt-4 w-full text-left">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-4">Match</th>
                <th className="py-1 pr-4">Bet</th>
                <th className="py-1 pr-4">Price taken</th>
                <th className="py-1 pr-4">Recorded</th>
                <th className="py-1 pr-4">CLV</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {record.bets.map((bet) => (
                <tr key={bet.id} className="border-t border-line">
                  <td className="py-1 pr-4">{bet.match}</td>
                  <td className="py-1 pr-4 capitalize">
                    {bet.selection} · {MARKET_LABEL[bet.market] ?? bet.market}
                  </td>
                  <td className="num py-1 pr-4">
                    {formatOdds(bet.price)} <span className="text-xs text-slate-500">{bet.bookmaker}</span>
                  </td>
                  <td className="py-1 pr-4 text-xs">{formatWhen(bet.recorded_at)}</td>
                  <td className="num py-1 pr-4">{bet.clv === null ? "awaiting close" : `${(bet.clv * 100).toFixed(1)}%`}</td>
                  <td className="py-1">{bet.result ? `${bet.result} (${bet.profit_units?.toFixed(2)} u)` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function SegmentTable({ rows }: { rows: EdgeSegment[] }) {
  return (
    <table className="mt-3 w-full text-left">
      <thead className="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-1 pr-4">League</th>
          <th className="py-1 pr-4">Market</th>
          <th className="py-1 pr-4">Source</th>
          <th className="py-1 pr-4">Price</th>
          <th className="py-1 pr-4">Bets</th>
          <th className="py-1 pr-4">CLV [95% CI]</th>
          <th className="py-1 pr-4">ROI [95% CI]</th>
          <th className="py-1 pr-4">Control CLV</th>
          <th className="py-1">Approved</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.segment_key} className="border-t border-line">
            <td className="py-1 pr-4">{row.league}</td>
            <td className="py-1 pr-4">{MARKET_LABEL[row.market] ?? row.market}</td>
            <td className="py-1 pr-4">{SOURCE_LABEL[row.source] ?? row.source}</td>
            <td className="py-1 pr-4">{BASIS_LABEL[row.price_basis] ?? row.price_basis}</td>
            <td className="num py-1 pr-4">{row.bets}</td>
            <td className={`num py-1 pr-4 ${tone(row.clv)}`}>{formatInterval(row.clv)}</td>
            <td className={`num py-1 pr-4 ${tone(row.roi)}`}>{formatInterval(row.roi)}</td>
            <td className="num py-1 pr-4">{row.control_clv === null ? "—" : `${(row.control_clv * 100).toFixed(1)}%`}</td>
            <td className="py-1">{row.approved ? "yes" : "no"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EdgeBacktestView({ summary }: { summary: EdgeBacktestSummary }) {
  if (!summary.backtest) {
    return <EmptyState title="No edge backtest" body="Run `npm run cli -- backtest` to measure the model against the closing line." />;
  }
  const { backtest } = summary;
  const approved = summary.approved ?? [];
  return (
    <section className="panel p-4 text-sm">
      <h2 className="font-semibold">Backtest against the closing line (#{backtest.id})</h2>
      <p className="mt-1 text-slate-500">
        {backtest.config.test_seasons?.join(", ")} · run {formatWhen(backtest.created_at)}
      </p>
      <p className={`mt-3 ${approved.length ? "text-slate-800" : "font-medium text-rose-800"}`}>
        {approved.length
          ? `${approved.length} segment(s) show positive closing-line value with a 95% interval above zero, held in ${backtest.config.confirmation_from}, and beat the market-only control. Only these get bets.`
          : "Nothing we forecast beats the closing line. No league or market passed the interval, confirmation and control tests, so no expected-value bets are shown."}
      </p>
      <p className="mt-1 text-slate-600">
        {backtest.multiple_testing.segments_with_enough_bets} segments were tested; about{" "}
        {backtest.multiple_testing.expected_false_passes_at_2_5_percent} would pass by chance. {backtest.multiple_testing.passing_clv_rule} passed the
        interval test, {backtest.multiple_testing.beating_control} of those beat the market-only control, and {backtest.multiple_testing.approved} passed
        every test.
      </p>
      <h3 className="mt-4 font-medium">Log loss against the close (all leagues)</h3>
      <p className="text-slate-600">Source minus closing on the same matches. Below zero would mean beating the close.</p>
      <table className="mt-2 w-full text-left">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1 pr-4">Market</th>
            <th className="py-1 pr-4">Matches</th>
            <th className="py-1 pr-4">Closing</th>
            <th className="py-1 pr-4">Model Δ</th>
            <th className="py-1 pr-4">Elo Δ</th>
            <th className="py-1 pr-4">Blend Δ</th>
            <th className="py-1">Early market Δ</th>
          </tr>
        </thead>
        <tbody>
          {(summary.log_loss ?? []).map((row) => (
            <tr key={row.market_key} className="border-t border-line">
              <td className="py-1 pr-4">{MARKET_LABEL[row.market_key] ?? row.market_key}</td>
              <td className="num py-1 pr-4">{row.matches ?? "—"}</td>
              <td className="num py-1 pr-4">{row.closing?.toFixed(4) ?? "—"}</td>
              <td className="num py-1 pr-4">{delta(row.model)}</td>
              <td className="num py-1 pr-4">{delta(row.elo)}</td>
              <td className="num py-1 pr-4">{delta(row.blend)}</td>
              <td className="num py-1">{delta(row.market)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="mt-4 font-medium">Betting rule, all leagues</h3>
      <SegmentTable rows={summary.aggregate ?? []} />
      <h3 className="mt-4 font-medium">Strongest league segments</h3>
      <p className="text-slate-600">Ranked by the lower end of the CLV interval.</p>
      <SegmentTable rows={summary.leaders ?? []} />
    </section>
  );
}
