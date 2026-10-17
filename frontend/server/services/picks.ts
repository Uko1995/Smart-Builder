/** Shared helpers for priced selections: batch lookup, price freshness and de-vigged sibling prices. */

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
