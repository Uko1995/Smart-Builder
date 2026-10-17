import { describe, expect, it } from "vitest";
import { decide, settle, type PaperInput } from "@/server/services/paper";

const at = new Date("2026-10-15T09:00:00Z");
const prices = (...values: number[]) => values.map((price) => ({ price, book: "1xBet", capturedAt: at }));

describe("paper strategies", () => {
  const input: PaperInput = { market: "1x2", model: [0.5, 0.28, 0.22], sharp: [0.45, 0.28, 0.27], prices: prices(2.0, 3.4, 4.2) };

  it("sharp value bets where the bookmaker pays more than the sharp fair chance", () => {
    const decision = decide("sharp_value", input);
    expect(decision?.selection).toBe(2);
    expect(decision?.edge).toBeCloseTo(0.27 * 4.2 - 1, 9);
    expect(decision?.stakeFraction).toBeGreaterThan(0);
  });

  it("model value uses the model and skips when nothing clears 5%", () => {
    expect(decide("model_value", { ...input, model: [0.55, 0.25, 0.2] })?.selection).toBe(0);
    expect(decide("model_value", { ...input, model: [0.48, 0.28, 0.24] })).toBeNull();
    expect(decide("model_value", { ...input, model: null })).toBeNull();
  });

  it("favourites need a clear favourite and a playable price, staked flat", () => {
    expect(decide("favourites", input)).toBeNull();
    const strong = decide("favourites", { ...input, sharp: [0.7, 0.18, 0.12], prices: prices(1.35, 5, 8) });
    expect(strong).toMatchObject({ selection: 0, stakeFraction: 0.01 });
    expect(decide("favourites", { ...input, sharp: [0.85, 0.1, 0.05], prices: prices(1.15, 7, 12) })).toBeNull();
  });

  it("ignores selections without a price", () => {
    const decision = decide("sharp_value", { ...input, prices: [prices(2)[0], null, null] });
    expect(decision).toBeNull();
  });
});

describe("paper settlement", () => {
  it("grades match result and over/under 2.5", () => {
    expect(settle("1x2", "home", 2, 1)).toBe(true);
    expect(settle("1x2", "draw", 1, 1)).toBe(true);
    expect(settle("1x2", "away", 1, 1)).toBe(false);
    expect(settle("ou25", "over", 2, 1)).toBe(true);
    expect(settle("ou25", "under", 2, 1)).toBe(false);
    expect(settle("ou25", "over", null, 1)).toBeNull();
  });
});
