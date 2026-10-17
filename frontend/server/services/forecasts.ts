/** Per-match predictions for a date: the latest stored probabilities for the headline markets. */

import type { Db } from "@/server/db/client";
import { addDays, iso } from "@/server/http";

const MARKETS: Record<string, string[]> = { match_result: ["home", "draw", "away"], over_under_goals: ["over", "under"], btts: ["yes", "no"] };

type Row = {
  fixture_id: number;
  kickoff_at: Date;
  status: string;
  league: string | null;
  home: string | null;
  away: string | null;
  home_goals: number | null;
  away_goals: number | null;
  market_key: string;
  selection: string;
  probability: string;
  elo_probability: string | null;
  implied_probability: string | null;
};

export type Forecast = { selection: string; model: number; elo: number | null; market: number | null; best: number };

/**
 * `best` is the de-margined bookmaker probability when a price is stored, otherwise the model.
 * The closing-line backtest found the market more accurate than the model in every league.
 */
export async function forecastBoard(db: Db, scope: string) {
  const start = new Date(`${scope}T00:00:00Z`);
  const end = new Date(`${addDays(scope, 1)}T00:00:00Z`);
  const rows = await db<Row[]>`
    WITH latest AS (
      SELECT p.fixture_id, max(p.batch_id) AS batch_id FROM predictions p
      JOIN fixtures f ON f.id = p.fixture_id
      WHERE f.kickoff_at >= ${start} AND f.kickoff_at < ${end}
      GROUP BY p.fixture_id
    )
    SELECT f.id AS fixture_id, f.kickoff_at, f.status, l.name AS league, h.name AS home, a.name AS away, f.home_goals, f.away_goals,
           p.market_key, p.selection, p.probability, p.elo_probability, p.implied_probability
    FROM predictions p
    JOIN latest ON latest.fixture_id = p.fixture_id AND latest.batch_id = p.batch_id
    JOIN fixtures f ON f.id = p.fixture_id
    LEFT JOIN leagues l ON l.id = f.league_id
    LEFT JOIN teams h ON h.id = f.home_team_id
    LEFT JOIN teams a ON a.id = f.away_team_id
    WHERE p.implementation_status = 'supported'
      AND (p.market_key IN ('match_result', 'btts') OR (p.market_key = 'over_under_goals' AND p.line = 2.5))
    ORDER BY f.kickoff_at, f.id`;
  const matches = new Map<
    number,
    {
      fixture_id: number;
      kickoff_at: string | null;
      status: string;
      league: string | null;
      home: string | null;
      away: string | null;
      score: string | null;
      markets: Record<string, Forecast[]>;
    }
  >();
  for (const row of rows) {
    const order = MARKETS[row.market_key];
    if (!order || !order.includes(row.selection)) continue;
    const match = matches.get(row.fixture_id) ?? {
      fixture_id: row.fixture_id,
      kickoff_at: iso(row.kickoff_at),
      status: row.status,
      league: row.league,
      home: row.home,
      away: row.away,
      score: row.home_goals === null || row.away_goals === null ? null : `${row.home_goals}–${row.away_goals}`,
      markets: {},
    };
    const model = Number(row.probability);
    const market = row.implied_probability === null ? null : Number(row.implied_probability);
    (match.markets[row.market_key] ??= []).push({
      selection: row.selection,
      model,
      elo: row.elo_probability === null ? null : Number(row.elo_probability),
      market,
      best: market ?? model,
    });
    matches.set(row.fixture_id, match);
  }
  for (const match of matches.values()) {
    for (const [key, list] of Object.entries(match.markets)) list.sort((a, b) => MARKETS[key].indexOf(a.selection) - MARKETS[key].indexOf(b.selection));
  }
  return {
    scope_date: scope,
    matches: [...matches.values()],
    note: "Best estimate uses the bookmaker price with its margin removed when one is stored, because it has been more accurate than the model. Model and Elo are shown alongside. These are probabilities, not betting advice.",
  };
}
