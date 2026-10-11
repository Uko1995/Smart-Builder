// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brierScore, logLoss, simulateUnitReturns } from "@/server/engine/evaluate";
import { deriveGoalMarkets, deviggedProbability, fairOdds, goalPredicate, sumWhere, unitsToNumber } from "@/server/engine/markets";
import { matrixSum, scorelineMatrix, tau } from "@/server/engine/scoreline";
import { iso } from "@/server/http";
import { normalizeTeamName, nameSimilarity } from "@/server/providers/names";
import { grade } from "@/server/services/settlement";

describe("scoreline model", () => {
  it("is a probability distribution", () => {
    const matrix = scorelineMatrix(1.6, 1.1, -0.08);
    expect(matrixSum(matrix)).toBeCloseTo(1, 10);
    expect(matrix.flat().every((value) => value >= 0)).toBe(true);
  });

  it("applies the Dixon-Coles low-score correction only to 0-0, 0-1, 1-0 and 1-1", () => {
    expect(tau(0, 0, 1.5, 1.2, -0.1)).toBeCloseTo(1 + 1.5 * 1.2 * 0.1);
    expect(tau(2, 1, 1.5, 1.2, -0.1)).toBe(1);
  });

  it("rejects non-positive rates", () => {
    expect(() => scorelineMatrix(0, 1)).toThrow();
  });

  it("derives complementary goal markets", () => {
    const entries = deriveGoalMarkets(scorelineMatrix(1.4, 1.2, -0.05));
    const find = (market: string, selection: string, line: number | null = null) =>
      unitsToNumber(entries.find((item) => item.marketKey === market && item.selection === selection && item.line === line)!.units);
    expect(find("match_result", "home") + find("match_result", "draw") + find("match_result", "away")).toBeCloseTo(1, 6);
    expect(find("over_under_goals", "over", 2.5) + find("over_under_goals", "under", 2.5)).toBeCloseTo(1, 6);
    expect(find("btts", "yes") + find("btts", "no")).toBeCloseTo(1, 6);
  });

  it("sums cells that satisfy a predicate", () => {
    const matrix = scorelineMatrix(1.3, 0.9);
    const over = sumWhere(matrix, goalPredicate("over_under_goals", "over", 1.5)!);
    const under = sumWhere(matrix, goalPredicate("over_under_goals", "under", 1.5)!);
    expect(over + under).toBeCloseTo(1, 10);
  });
});

describe("prices", () => {
  it("removes the bookmaker margin proportionally", () => {
    const prices = [1.9, 1.9];
    expect(deviggedProbability(1.9, prices)).toBeCloseTo(0.5, 8);
    expect(deviggedProbability(1.5, [1.5])).toBeCloseTo(1 / 1.5, 8);
  });

  it("formats fair odds from probability units", () => {
    expect(fairOdds(50_000_000)).toBe("2.0000");
    expect(fairOdds(0)).toBeNull();
  });
});

describe("evaluation metrics", () => {
  it("matches hand-computed Brier and log loss", () => {
    expect(brierScore([1, 0], [0.8, 0.3])).toBeCloseTo((0.04 + 0.09) / 2);
    expect(logLoss([1, 0], [0.8, 0.3])).toBeCloseTo(-(Math.log(0.8) + Math.log(0.7)) / 2);
  });

  it("reports no return without priced settlements", () => {
    const result = simulateUnitReturns([]) as Record<string, unknown>;
    expect(result.status).toBe("insufficient_data");
  });
});

describe("settlement", () => {
  const facts = {
    full: { home: 2, away: 1 },
    half: { home: 0, away: 0 },
    corners: { home: null, away: null },
    cards: { home: null, away: null },
  };

  it("grades goal markets from the final score", () => {
    expect(grade({ market_key: "match_result", selection: "home", line: null }, facts)).toBe("won");
    expect(grade({ market_key: "over_under_goals", selection: "over", line: "2.50" }, facts)).toBe("won");
    expect(grade({ market_key: "btts", selection: "no", line: null }, facts)).toBe("lost");
    expect(grade({ market_key: "first_half_result", selection: "draw", line: null }, facts)).toBe("won");
  });

  it("voids draw-no-bet on a draw and leaves missing stats unsettled", () => {
    expect(grade({ market_key: "draw_no_bet", selection: "home", line: null }, { ...facts, full: { home: 1, away: 1 } })).toBe("void");
    expect(grade({ market_key: "match_corners", selection: "over", line: "9.50" }, facts)).toBeNull();
  });
});

describe("helpers", () => {
  it("serialises timestamps like the original API", () => {
    expect(iso(new Date("2026-10-10T11:30:00Z"))).toBe("2026-10-10T11:30:00+00:00");
    expect(iso(null)).toBeNull();
  });

  it("matches team names across providers", () => {
    expect(normalizeTeamName("Manchester United FC")).toBe("manchester united");
    expect(nameSimilarity("Manchester United FC", "Man United")).toBeGreaterThanOrEqual(0.7);
    expect(nameSimilarity("Manchester United", "Manchester City")).toBeLessThan(0.85);
    expect(nameSimilarity("Athletic Bilbao", "Ath Bilbao")).toBeGreaterThanOrEqual(0.7);
  });
});
