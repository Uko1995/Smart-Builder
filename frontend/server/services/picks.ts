/** Daily high-probability priced picks. Not accumulators. */

import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import { deviggedProbability } from "@/server/engine/markets";
import { iso } from "@/server/http";
import { MARKET_BY_KEY } from "@/server/markets/registry";
import { effectiveSettings, type EffectiveSettings } from "@/server/services/reference";
import type { BatchRow } from "@/server/services/predictions";

export const PICK_MARKETS = new Set(["match_result", "double_chance", "btts", "over_under_goals", "draw_no_bet", "asian_handicap"]);
export const OVERLAPPING_MARKETS = new Set(["double_chance"]);
export const MIN_DECIMAL_ODDS = 1.2;
export const DISAGREEMENT_GAP = 0.15;
export const CONSERVATIVE_FLOOR = 0.6;
export const PICKS_LIMIT = 30;
export const TERMINAL_FOR_PICKS = ["succeeded", "succeeded_with_warnings", "no_qualifying_slips"];
const PICK_LINES = new Set(["1.50", "2.50", "3.50"]);

export function lineKey(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : Number(value).toFixed(2);
}

export function isTrivialSelection(marketKey: string, line: string | number | null, decimalOdds: number | null): boolean {
  if (!PICK_MARKETS.has(marketKey)) return true;
  if (decimalOdds !== null && decimalOdds < MIN_DECIMAL_ODDS) return true;
  if (marketKey === "over_under_goals") return !PICK_LINES.has(lineKey(line));
  if (marketKey === "asian_handicap" && (line === null || line === undefined)) return true;
  return false;
}

export async function latestBatchForDate(db: Db, scope: string): Promise<BatchRow | null> {
  const [row] = await db<BatchRow[]>`
    SELECT * FROM prediction_batches
    WHERE scope_date = ${scope} AND status IN ${db(TERMINAL_FOR_PICKS)}
    ORDER BY started_at DESC LIMIT 1`;
  return row ?? null;
}

/** Reference prices published twice a week rather than live bookmaker prices. */
export const REFERENCE_BOOKS = new Set(["market_average"]);

export function freshnessLimitMs(bookmakerKey: string | null, config: EffectiveSettings): number {
  return REFERENCE_BOOKS.has(bookmakerKey ?? "")
    ? Number(config.reference_odds_freshness_hours) * 3_600_000
    : Number(config.odds_freshness_minutes) * 60_000;
}

/** Latest price per (fixture, bookmaker, market, line, selection), grouped as sibling prices for de-vigging. */
export async function latestOddsGroups(db: Db, fixtureIds: number[]): Promise<Map<string, Map<string, number>>> {
  const grouped = new Map<string, Map<string, number>>();
  if (!fixtureIds.length) return grouped;
  const rows = await db<{ fixture_id: number; bookmaker_id: number; market_key: string; line: string | null; selection: string; decimal_odds: string }[]>`
    SELECT DISTINCT ON (fixture_id, bookmaker_id, market_key, line, selection) fixture_id, bookmaker_id, market_key, line, selection, decimal_odds
    FROM odds_snapshots WHERE fixture_id IN ${db(fixtureIds)}
    ORDER BY fixture_id, bookmaker_id, market_key, line, selection, captured_at DESC`;
  for (const row of rows) {
    const key = `${row.fixture_id}|${row.bookmaker_id}|${row.market_key}|${lineKey(row.line)}`;
    const group = grouped.get(key) ?? new Map<string, number>();
    group.set(row.selection, Number(row.decimal_odds));
    grouped.set(key, group);
  }
  return grouped;
}

export function impliedFor(
  fixtureId: number,
  bookmakerId: number | null,
  marketKey: string,
  line: string | null,
  decimalOdds: number,
  groups: Map<string, Map<string, number>>,
): number {
  if (OVERLAPPING_MARKETS.has(marketKey)) return deviggedProbability(decimalOdds, [decimalOdds]);
  const siblings = groups.get(`${fixtureId}|${bookmakerId}|${marketKey}|${lineKey(line)}`);
  const prices = siblings ? [...siblings.values()] : [];
  if (!prices.includes(decimalOdds)) prices.push(decimalOdds);
  return deviggedProbability(decimalOdds, prices);
}

type PickSource = {
  fixture_id: number;
  market_key: string;
  selection: string;
  line: string | null;
  probability: string;
  elo_probability: string | null;
  data_quality: string | null;
  sample_size: number;
  decimal_odds: string;
  captured_at: Date;
  odds_origin: string;
  bookmaker: string | null;
  bookmaker_id: number | null;
  bookmaker_key: string | null;
  kickoff_at: Date;
  home: string | null;
  away: string | null;
  league: string | null;
};

export type DailyPick = ReturnType<typeof pickPayload>;

function pickPayload(row: PickSource, implied: number) {
  const model = Number(row.probability);
  const gap = Math.abs(model - implied);
  const market = MARKET_BY_KEY[row.market_key];
  return {
    fixture_id: row.fixture_id,
    match: row.home === null || row.away === null ? null : `${row.home} vs ${row.away}`,
    home: row.home,
    away: row.away,
    league: row.league,
    kickoff_at: iso(row.kickoff_at),
    market_key: row.market_key,
    market_name: market ? market.displayName : null,
    selection: row.selection,
    line: row.line,
    model_probability: row.probability,
    elo_probability: row.elo_probability,
    implied_probability: implied.toFixed(8),
    decimal_odds: row.decimal_odds,
    captured_at: iso(row.captured_at),
    bookmaker: row.bookmaker,
    reference_price: REFERENCE_BOOKS.has(row.bookmaker_key ?? ""),
    data_quality: row.data_quality,
    sample_size: row.sample_size,
    sample_note: `Sample quality ${row.data_quality ?? "—"}; ${row.sample_size} league matches in the window.`,
    disagreement: gap > DISAGREEMENT_GAP,
    conservative: model >= CONSERVATIVE_FLOOR && implied >= CONSERVATIVE_FLOOR,
    data_origin: row.odds_origin,
  };
}

export async function dailyPicks(db: Db, settings: Settings, scope: string, limit: number | null = PICKS_LIMIT) {
  const config = await effectiveSettings(db, settings);
  const minProbability = Number(config.min_pick_probability);
  const batch = await latestBatchForDate(db, scope);
  if (batch === null) {
    return { scope_date: scope, min_probability: String(minProbability), batch: null, picks: [], returned: 0, eligible: 0, note: "Generate predictions for this date first." };
  }
  const rows = await db<PickSource[]>`
    SELECT p.fixture_id, p.market_key, p.selection, p.line, p.probability, p.elo_probability, p.data_quality, p.sample_size,
           o.decimal_odds, o.captured_at, o.data_origin AS odds_origin, b.name AS bookmaker,
           o.bookmaker_id, b.key AS bookmaker_key, f.kickoff_at, h.name AS home, a.name AS away, l.name AS league
    FROM predictions p
    JOIN odds_snapshots o ON o.id = p.odds_snapshot_id
    JOIN fixtures f ON f.id = p.fixture_id
    LEFT JOIN bookmakers b ON b.id = o.bookmaker_id
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN leagues l ON l.id = f.league_id
    WHERE p.batch_id = ${batch.id} AND p.probability >= ${minProbability} AND p.implementation_status = 'supported'`;
  const now = Date.now();
  const groups = await latestOddsGroups(db, [...new Set(rows.map((row) => row.fixture_id))]);
  const picks: DailyPick[] = [];
  for (const row of rows) {
    if (now - row.captured_at.getTime() > freshnessLimitMs(row.bookmaker_key, config)) continue;
    const odds = Number(row.decimal_odds);
    if (isTrivialSelection(row.market_key, row.line, odds)) continue;
    picks.push(pickPayload(row, impliedFor(row.fixture_id, row.bookmaker_id, row.market_key, row.line, odds, groups)));
  }
  picks.sort(
    (a, b) =>
      Number(b.implied_probability) - Number(a.implied_probability) ||
      Number(b.model_probability) - Number(a.model_probability) ||
      (a.kickoff_at ?? "").localeCompare(b.kickoff_at ?? "") ||
      a.market_key.localeCompare(b.market_key) ||
      a.selection.localeCompare(b.selection),
  );
  const returned = limit === null ? picks : picks.slice(0, limit);
  return {
    scope_date: scope,
    min_probability: String(minProbability),
    batch: { public_id: batch.public_id, status: batch.status, started_at: iso(batch.started_at) },
    picks: returned,
    returned: returned.length,
    eligible: picks.length,
    note:
      "Ranked by de-vigged bookmaker probability. Model probability is a second opinion, not a guarantee. " +
      "Market-average prices are published about twice a week; check the live price before staking.",
  };
}
