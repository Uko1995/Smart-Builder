import { describe, expect, it } from "vitest";
import { devig, power, proportional, shin } from "@/server/engine/devig";
import { bootstrapRatio, chooseBet, closingLineValue, fitPool, kellyStake, mulberry32, pool, PINNACLE_CUTOFF } from "@/server/engine/edge";
import { addBlend, applyControl, benchmark, betStats, quotePrices, simulate, type BacktestRecord } from "@/server/services/backtest";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("margin removal", () => {
  const odds = [1.9, 3.6, 4.4];

  it("returns probabilities that sum to one for every method", () => {
    for (const method of [proportional, power, shin]) {
      const probabilities = method(odds) as number[];
      expect(sum(probabilities)).toBeCloseTo(1, 9);
      probabilities.forEach((p, index) => expect(p).toBeLessThan(1 / odds[index]));
    }
  });

  it("shifts more margin onto longshots than the proportional method", () => {
    const flat = proportional(odds) as number[];
    const curved = power(odds) as number[];
    const shins = shin(odds) as number[];
    expect(curved[0]).toBeGreaterThan(flat[0]);
    expect(curved[2]).toBeLessThan(flat[2]);
    expect(shins[0]).toBeGreaterThan(flat[0]);
  });

  it("leaves a margin-free book unchanged and rejects invalid prices", () => {
    expect(devig([2, 2])).toEqual([0.5, 0.5].map((p) => expect.closeTo(p, 9)));
    expect(devig([1, 2])).toBeNull();
  });
});

describe("staking and closing-line value", () => {
  it("sizes quarter Kelly with a cap and no stake without edge", () => {
    expect(kellyStake(0.55, 2)).toBeCloseTo(0.25 * 0.1, 9);
    expect(kellyStake(0.9, 2)).toBe(0.05);
    expect(kellyStake(0.45, 2)).toBe(0);
  });

  it("measures the taken price against the fair closing probability", () => {
    expect(closingLineValue(2.2, 0.5)).toBeCloseTo(0.1, 9);
    expect(closingLineValue(1.8, 0.5)).toBeCloseTo(-0.1, 9);
  });

  it("picks the single best-value selection above the threshold", () => {
    const choice = chooseBet(
      [
        { selection: 0, probability: 0.5, price: 2.1 },
        { selection: 1, probability: 0.3, price: 3.8 },
        { selection: 2, probability: 0.2, price: 4 },
      ],
      0.05,
    );
    expect(choice?.selection).toBe(1);
    expect(choice?.edge).toBeCloseTo(0.14, 9);
    expect(chooseBet([{ selection: 0, probability: 0.5, price: 2.08 }], 0.05)).toBeNull();
  });
});

describe("bootstrap and pooling", () => {
  it("brackets the sample mean and is reproducible", () => {
    const random = mulberry32(1);
    const values = Array.from({ length: 400 }, () => random() - 0.4);
    const first = bootstrapRatio(values, null);
    const second = bootstrapRatio(values, null);
    expect(first).toEqual(second);
    expect(first!.low).toBeLessThan(first!.estimate);
    expect(first!.high).toBeGreaterThan(first!.estimate);
    expect(first!.estimate).toBeCloseTo(sum(values) / values.length, 9);
    expect(first!.low).toBeGreaterThan(0);
  });

  it("puts weight on an informative source and none on noise", () => {
    const random = mulberry32(3);
    const rows = Array.from({ length: 2000 }, () => {
      const p = 0.2 + 0.6 * random();
      const outcome = random() < p ? 0 : 1;
      const noise = 0.2 + 0.6 * random();
      return { sources: [[p, 1 - p], [noise, 1 - noise]], outcome };
    });
    const weights = fitPool(rows) as number[];
    expect(weights[0]).toBeGreaterThan(0.7);
    expect(weights[1]).toBeLessThan(0.15);
    expect(sum(pool([[0.6, 0.4], [0.5, 0.5]], [1, 0]))).toBeCloseTo(1, 9);
    expect(pool([[0.6, 0.4], [0.5, 0.5]], [1, 0])[0]).toBeCloseTo(0.6, 9);
  });
});

describe("backtest benchmark and simulation", () => {
  const quote = (home: number, draw: number, away: number) => ({ home, draw, away, over: null, under: null });

  it("uses Pinnacle before the cutoff and the exchange after", () => {
    const closing = new Map([
      ["pinnacle", quote(2, 3.5, 4)],
      ["betfair_exchange", quote(2.1, 3.6, 4.2)],
    ]);
    expect(benchmark(closing, "1x2", PINNACLE_CUTOFF - 1)?.source).toBe("pinnacle");
    expect(benchmark(closing, "1x2", PINNACLE_CUTOFF)?.source).toBe("betfair_exchange");
    expect(benchmark(closing, "ou25", PINNACLE_CUTOFF)).toBeNull();
    expect(quotePrices(quote(2, 3.5, 4), "1x2")).toEqual([2, 3.5, 4]);
  });

  it("bets only above the threshold and books profit and CLV", () => {
    const record: BacktestRecord = {
      fixtureId: 1,
      leagueId: 9,
      season: 2021,
      kickoff: Date.UTC(2021, 9, 1),
      market: "1x2",
      outcome: 0,
      sources: { model: [0.6, 0.25, 0.15] },
      close: [0.55, 0.27, 0.18],
      closeSource: "pinnacle",
      prices: { best_early: [2, 3.6, 6] },
    };
    const bets = simulate([record], 0.05).get("9|1x2|model|best_early")!;
    expect(bets).toHaveLength(1);
    expect(bets[0].stake).toBeCloseTo(100 * 0.05, 9);
    expect(bets[0].profit).toBeCloseTo(bets[0].stake, 9);
    expect(bets[0].clv).toBeCloseTo(0.1, 9);
    expect(simulate([{ ...record, season: 2019 }], 0.05).size).toBe(0);
  });

  it("fits blend weights only on earlier seasons", () => {
    const random = mulberry32(5);
    const records: BacktestRecord[] = [];
    for (const season of [2019, 2020]) {
      for (let i = 0; i < 300; i += 1) {
        const p = 0.2 + 0.6 * random();
        records.push({
          fixtureId: i,
          leagueId: 1,
          season,
          kickoff: Date.UTC(season, 8, 1),
          market: "ou25",
          outcome: random() < p ? 0 : 1,
          sources: { model: [p, 1 - p], market: [0.5, 0.5] },
          close: [p, 1 - p],
          closeSource: "pinnacle",
          prices: {},
        });
      }
    }
    const weights = addBlend(records);
    expect(weights.ou25[2019]).toBeNull();
    expect(weights.ou25[2020]).not.toBeNull();
    expect(records.filter((record) => record.season === 2019).every((record) => !record.sources.blend)).toBe(true);
    expect(records.filter((record) => record.season === 2020).every((record) => record.sources.blend)).toBe(true);
  });
});

describe("segment approval", () => {
  const bets = (count: number, clv: number, season = 2025) =>
    Array.from({ length: count }, (_, index) => ({ season, stake: 1, profit: index % 2 ? 1 : -1, clv: clv + (index % 3) * 0.001, price: 2, edge: 0.06 }));

  it("rejects a segment whose edge the market-only control already has", () => {
    const segments = {
      "1|1x2|blend|best_early": betStats(bets(150, 0.03), 2025),
      "1|1x2|market|best_early": betStats(bets(150, 0.05), 2025),
      "2|1x2|model|best_early": betStats(bets(150, 0.03), 2025),
      "2|1x2|market|best_early": betStats(bets(150, 0.0), 2025),
      "3|1x2|model|best_early": betStats(bets(150, -0.01), 2025),
    };
    applyControl(segments);
    expect(segments["1|1x2|blend|best_early"].passes_clv_rule).toBe(true);
    expect(segments["1|1x2|blend|best_early"].approved).toBe(false);
    expect(segments["2|1x2|model|best_early"].approved).toBe(true);
    expect(segments["3|1x2|model|best_early"].approved).toBe(false);
    expect(segments["1|1x2|market|best_early"].approved).toBe(false);
  });

  it("needs the edge to hold in the confirmation season", () => {
    const segments = { "4|ou25|model|bet365_early": betStats(bets(150, 0.03, 2022), 2025) };
    applyControl(segments);
    expect(segments["4|ou25|model|bet365_early"].holds_in_confirmation).toBe(false);
    expect(segments["4|ou25|model|bet365_early"].approved).toBe(false);
  });
});
