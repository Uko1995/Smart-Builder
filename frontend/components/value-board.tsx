import Link from "next/link";
import { EmptyState } from "@/components/indicators";
import { formatOdds, formatProbability, formatWhen } from "@/lib/format";
import type { Interval, ValueBoard } from "@/lib/types";

const MARKET_LABEL: Record<string, string> = { "1x2": "Match result", ou25: "Over/under 2.5" };
const SOURCE_LABEL: Record<string, string> = { model: "Goals model", elo: "Elo", blend: "Model + market blend" };

export function formatInterval(value: Interval | null | undefined, digits = 1): string {
  if (!value) return "—";
  const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
  return `${pct(value.estimate)} [${pct(value.low)}, ${pct(value.high)}]`;
}

export function ValueBoardView({ board }: { board: ValueBoard }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">Expected-value bets</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">{board.note}</p>
      {board.backtest ? (
        <p className="mt-1 text-xs text-slate-500">
          Backtest #{board.backtest.id} ({board.backtest.test_seasons.join(", ")}) · {board.approved_segments.length} approved segment(s) ·
          threshold {formatProbability(board.threshold)} edge · bankroll {board.bankroll_units} units
        </p>
      ) : null}
      {board.bets.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title={board.approved_segments.length ? "No bet clears the threshold today" : "No proven edge, so no bets"}
            body={
              board.approved_segments.length
                ? `${board.candidates_checked} priced market(s) were checked in approved segments. None had enough expected value at the best available price.`
                : "Betting where the model has not beaten the closing line loses the margin in the long run. See Performance for the backtest."
            }
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Match</th>
                <th className="px-4 py-2">Bet</th>
                <th className="px-4 py-2">Edge</th>
                <th className="px-4 py-2">Best price</th>
                <th className="px-4 py-2">Stake</th>
                <th className="px-4 py-2">Backtest CLV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {board.bets.map((bet) => (
                <tr key={`${bet.fixture_id}-${bet.market}`}>
                  <td className="px-4 py-2">
                    <Link href={`/matches/${bet.fixture_id}`} className="font-medium text-tide">
                      {bet.match}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {bet.league} · {formatWhen(bet.kickoff_at)}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    <p className="font-medium capitalize">{bet.selection}</p>
                    <p className="text-xs text-slate-500">
                      {MARKET_LABEL[bet.market] ?? bet.market} · {SOURCE_LABEL[bet.source] ?? bet.source} {formatProbability(bet.probability)}
                    </p>
                  </td>
                  <td className="num px-4 py-2 font-medium text-emerald-700">+{(bet.edge * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2">
                    <p className="num font-medium">{formatOdds(bet.price)}</p>
                    <p className="text-xs text-slate-500">
                      {bet.bookmaker} · {formatWhen(bet.price_captured_at)}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    <p className="num font-medium">{bet.stake_units.toFixed(2)} u</p>
                    <p className="text-xs text-slate-500">{(bet.stake_fraction * 100).toFixed(2)}% of bankroll</p>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {formatInterval(bet.backtest_clv)}
                    <p>{bet.backtest_bets} backtest bets</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
