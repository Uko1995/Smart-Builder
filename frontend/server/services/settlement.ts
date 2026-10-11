/** Settle stored predictions from recorded results. Missing stats stay unsettled. */

import type { Db } from "@/server/db/client";
import { countPredicate, goalPredicate } from "@/server/engine/markets";
import { upsertStatistics } from "@/server/services/store";

const GOAL_MARKETS = new Set([
  "match_result",
  "double_chance",
  "draw_no_bet",
  "over_under_goals",
  "btts",
  "asian_handicap",
  "asian_handicap_integer",
  "correct_score",
  "team_total_home",
  "team_total_away",
]);
const HALF_MARKETS = new Set(["first_half_result", "first_half_over_under"]);
const CORNER_MARKETS = new Set(["match_corners", "team_corners_home", "team_corners_away"]);
const CARD_MARKETS = new Set(["match_cards", "team_cards_home", "team_cards_away"]);

type Score = { home: number | null; away: number | null };
type GradeInput = { market_key: string; selection: string; line: string | null };
type Facts = { full: Score; half: Score; corners: Score; cards: Score };

function gradeGoals(prediction: GradeInput, score: Score): string | null {
  const { home, away } = score;
  if (home === null || away === null) return null;
  const line = prediction.line === null ? null : Number(prediction.line);
  if (prediction.market_key === "draw_no_bet") {
    if (home === away) return "void";
    const won = (prediction.selection === "home" && home > away) || (prediction.selection === "away" && away > home);
    return won ? "won" : "lost";
  }
  if (prediction.market_key === "asian_handicap_integer" && line !== null) {
    if (prediction.selection === "home" && home + line === away) return "void";
    if (prediction.selection === "away" && away - line === home) return "void";
  }
  const predicate = goalPredicate(prediction.market_key, prediction.selection, line);
  if (predicate === null) return null;
  return predicate(home, away) ? "won" : "lost";
}

export function grade(prediction: GradeInput, facts: Facts): string | null {
  if (GOAL_MARKETS.has(prediction.market_key)) return gradeGoals(prediction, facts.full);
  if (HALF_MARKETS.has(prediction.market_key)) return gradeGoals(prediction, facts.half);
  const counts = CORNER_MARKETS.has(prediction.market_key) ? facts.corners : CARD_MARKETS.has(prediction.market_key) ? facts.cards : null;
  if (counts === null || counts.home === null || counts.away === null) return null;
  const predicate = countPredicate(prediction.market_key, prediction.selection, prediction.line === null ? null : Number(prediction.line));
  if (predicate === null) return null;
  return predicate(counts.home, counts.away) ? "won" : "lost";
}

type FactRow = {
  home_goals: number | null;
  away_goals: number | null;
  ht_home_goals: number | null;
  ht_away_goals: number | null;
  home_corners: number | null;
  away_corners: number | null;
  home_cards: number | null;
  away_cards: number | null;
};

async function loadFacts(db: Db, fixtureId: number): Promise<Facts | null> {
  const [row] = await db<FactRow[]>`
    SELECT f.home_goals, f.away_goals, f.ht_home_goals, f.ht_away_goals, s.home_corners, s.away_corners, s.home_cards, s.away_cards
    FROM fixtures f LEFT JOIN match_statistics s ON s.fixture_id = f.id WHERE f.id = ${fixtureId}`;
  if (!row) return null;
  return {
    full: { home: row.home_goals, away: row.away_goals },
    half: { home: row.ht_home_goals, away: row.ht_away_goals },
    corners: { home: row.home_corners, away: row.away_corners },
    cards: { home: row.home_cards, away: row.away_cards },
  };
}

async function settleFixture(db: Db, fixtureId: number, onlyUnsettled: boolean): Promise<number> {
  const facts = await loadFacts(db, fixtureId);
  if (facts === null) return 0;
  const predictions = await db<(GradeInput & { id: number })[]>`
    SELECT id, market_key, selection, line FROM predictions
    WHERE fixture_id = ${fixtureId} ${onlyUnsettled ? db`AND outcome IS NULL` : db``}`;
  const byOutcome = new Map<string, number[]>();
  for (const prediction of predictions) {
    const outcome = grade(prediction, facts);
    if (outcome === null) continue;
    byOutcome.set(outcome, [...(byOutcome.get(outcome) ?? []), prediction.id]);
  }
  let graded = 0;
  for (const [outcome, ids] of byOutcome) {
    await db`UPDATE predictions SET outcome = ${outcome}, settled_at = now() WHERE id IN ${db(ids)}`;
    graded += ids.length;
  }
  return graded;
}

export async function recordResult(
  db: Db,
  fixtureId: number,
  result: {
    home_goals: number;
    away_goals: number;
    ht_home_goals?: number | null;
    ht_away_goals?: number | null;
    home_corners?: number | null;
    away_corners?: number | null;
    home_cards?: number | null;
    away_cards?: number | null;
  },
) {
  const updated = await db`
    UPDATE fixtures SET home_goals = ${result.home_goals}, away_goals = ${result.away_goals},
      ht_home_goals = ${result.ht_home_goals ?? null}, ht_away_goals = ${result.ht_away_goals ?? null},
      status = 'completed', updated_at = now()
    WHERE id = ${fixtureId}`;
  if (!updated.count) throw new Error("fixture not found");
  if ([result.home_corners, result.away_corners, result.home_cards, result.away_cards].some((value) => value !== null && value !== undefined)) {
    await upsertStatistics(db, fixtureId, result, "recorded_result");
  }
  return { fixture_id: fixtureId, predictions_graded: await settleFixture(db, fixtureId, false) };
}

/** Grade priced predictions whose fixtures have since been completed by a data refresh. */
export async function settleCompleted(db: Db): Promise<{ fixtures: number; graded: number }> {
  const fixtures = await db<{ fixture_id: number }[]>`
    SELECT DISTINCT p.fixture_id FROM predictions p JOIN fixtures f ON f.id = p.fixture_id
    WHERE p.outcome IS NULL AND p.odds_snapshot_id IS NOT NULL AND f.status = 'completed'
      AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL`;
  let graded = 0;
  for (const { fixture_id } of fixtures) graded += await settleFixture(db, fixture_id, true);
  return { fixtures: fixtures.length, graded };
}
