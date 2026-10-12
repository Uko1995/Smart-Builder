import { describe, expect, it } from "vitest";
import { buildLeagueElo, eloSelectionProbability, EloPool, fitOrderedLogit, goalMultiplier, logitProbabilities, type EloSample } from "@/server/engine/elo";
import { calibrationReport } from "@/server/engine/evaluate";
import type { HistoricalMatch } from "@/server/engine/strengths";

const DAY = 86_400_000;

function season(strong: string, weak: string[], start: number, rounds: number): HistoricalMatch[] {
  const matches: HistoricalMatch[] = [];
  let day = 0;
  const teams = [strong, ...weak];
  for (let round = 0; round < rounds; round += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        day += 1;
        const strongHome = home === strong;
        const strongAway = away === strong;
        matches.push({
          matchId: `${round}-${home}-${away}`,
          leagueId: "L",
          kickoff: start + day * DAY,
          homeId: home,
          awayId: away,
          homeGoals: strongHome ? 3 : day % 3 === 0 ? 1 : 0,
          awayGoals: strongAway ? 2 : day % 4 === 0 ? 1 : 0,
        });
      }
    }
  }
  return matches;
}

describe("Elo", () => {
  it("scales K by goal difference like World Football Elo", () => {
    expect(goalMultiplier(0)).toBe(1);
    expect(goalMultiplier(1)).toBe(1);
    expect(goalMultiplier(-2)).toBe(1.5);
    expect(goalMultiplier(3)).toBe(1.75);
  });

  it("is zero-sum between the two teams", () => {
    const pool = new EloPool();
    pool.update({ matchId: "1", leagueId: "L", kickoff: 0, homeId: "a", awayId: "b", homeGoals: 2, awayGoals: 0 });
    const ratings = (pool as unknown as { teams: Map<string, { rating: number }> }).teams;
    expect((ratings.get("a")?.rating ?? 0) + (ratings.get("b")?.rating ?? 0)).toBeCloseTo(3000, 9);
  });

  it("fits an ordered logit whose probabilities sum to one and rise with the rating gap", () => {
    const samples: EloSample[] = [];
    for (let index = 0; index < 900; index += 1) {
      const x = (index % 30) / 15 - 1;
      const y = index % 7 === 0 ? 1 : x + (index % 5) / 5 - 0.4 > 0 ? 2 : 0;
      samples.push({ x, y: y as 0 | 1 | 2 });
    }
    const fit = fitOrderedLogit(samples);
    expect(fit).not.toBeNull();
    const low = logitProbabilities(fit!, -0.5);
    const high = logitProbabilities(fit!, 0.5);
    expect(low.home + low.draw + low.away).toBeCloseTo(1, 9);
    expect(high.home).toBeGreaterThan(low.home);
    expect(high.away).toBeLessThan(low.away);
  });

  it("rates a dominant team as the favourite and only uses matches before the cutoff", () => {
    const history = season("top", ["b", "c", "d", "e", "f"], 0, 12);
    const cutoff = history[history.length - 1].kickoff + DAY;
    const elo = buildLeagueElo([...history, { ...history[0], matchId: "future", kickoff: cutoff + DAY, homeGoals: 0, awayGoals: 9 }], cutoff);
    expect(elo.pool.matches).toBe(history.length);
    const home = elo.predict("top", "b", cutoff);
    const away = elo.predict("b", "top", cutoff);
    expect(home).not.toBeNull();
    expect(home!.home).toBeGreaterThan(0.6);
    expect(away!.away).toBeGreaterThan(away!.home);
    expect(elo.predict("top", "unknown", cutoff)).toBeNull();
  });

  it("maps 1X2 probabilities onto result-family selections", () => {
    const p = { home: 0.5, draw: 0.3, away: 0.2 };
    expect(eloSelectionProbability(p, "match_result", "draw")).toBe(0.3);
    expect(eloSelectionProbability(p, "double_chance", "home_or_draw")).toBeCloseTo(0.8, 12);
    expect(eloSelectionProbability(p, "draw_no_bet", "away")).toBeCloseTo(0.2 / 0.7, 12);
    expect(eloSelectionProbability(p, "btts", "yes")).toBeNull();
  });
});

describe("calibration report", () => {
  it("buckets settled rows and compares sources on the same rows only", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      marketKey: index % 2 ? "match_result" : "btts",
      probability: index < 20 ? 0.75 : 0.35,
      implied: index < 30 ? 0.7 : null,
      elo: null,
      priced: index % 4 !== 0,
      won: index < 20 ? index % 4 !== 3 : index % 3 === 0,
    }));
    const report = calibrationReport(rows, 0.6);
    expect(report.status).toBe("estimated");
    expect(report.buckets.map((bucket) => [bucket.low, bucket.observations])).toEqual([
      [0.3, 20],
      [0.7, 20],
    ]);
    expect(report.buckets[1].hit_rate).toBe(0.75);
    expect(report.picks.observations).toBe(15);
    expect(report.model_vs_market.observations).toBe(30);
    expect(report.model_vs_elo.status).toBe("insufficient_data");
  });
});
