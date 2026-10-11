import { describe, expect, it } from "vitest";
import { groupPicks } from "./pick-tabs";
import type { DailyPick } from "@/lib/types";

function pick(market_key: string, selection: string, line: string | null = null): DailyPick {
  return {
    fixture_id: 1,
    match: "A vs B",
    home: "A",
    away: "B",
    league: "L",
    kickoff_at: null,
    market_key,
    market_name: null,
    selection,
    line,
    model_probability: "0.7",
    implied_probability: "0.7",
    decimal_odds: "1.40",
    captured_at: null,
    bookmaker: null,
    data_quality: null,
    sample_size: 0,
    sample_note: "",
    disagreement: false,
    conservative: true,
    data_origin: "provider",
  };
}

describe("groupPicks", () => {
  it("splits picks by market and line and keeps empty core tabs", () => {
    const tabs = groupPicks([
      pick("over_under_goals", "over", "1.50"),
      pick("over_under_goals", "over", "2.50"),
      pick("match_result", "home"),
      pick("btts", "no"),
    ]);
    const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab.total]));
    expect(byId.all).toBe(4);
    expect(byId["over-1-5"]).toBe(1);
    expect(byId["over-2-5"]).toBe(1);
    expect(byId.home).toBe(1);
    expect(byId.away).toBe(0);
    expect(byId["btts-no"]).toBe(1);
    expect(byId.draw).toBeUndefined();
  });
});
