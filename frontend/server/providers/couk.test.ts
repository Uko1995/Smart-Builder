import { describe, expect, it } from "vitest";
import { parseExtraRows, parseMainRows } from "@/server/providers/couk";

const mainRow = {
  Div: "E0",
  Date: "17/10/2026",
  Time: "15:00",
  HomeTeam: "Arsenal",
  AwayTeam: "Chelsea",
  AvgH: "1.85",
  AvgD: "3.70",
  AvgA: "4.40",
  "Avg>2.5": "1.72",
  "Avg<2.5": "2.12",
};

describe("football-data.co.uk average prices", () => {
  it("reads 1X2 and over/under 2.5 from the main fixtures file", () => {
    const [match] = parseMainRows([mainRow], null, null, true);
    expect(match.prices).toEqual([
      { marketKey: "match_result", selection: "home", line: null, decimalOdds: "1.8500" },
      { marketKey: "match_result", selection: "draw", line: null, decimalOdds: "3.7000" },
      { marketKey: "match_result", selection: "away", line: null, decimalOdds: "4.4000" },
      { marketKey: "over_under_goals", selection: "over", line: "2.50", decimalOdds: "1.7200" },
      { marketKey: "over_under_goals", selection: "under", line: "2.50", decimalOdds: "2.1200" },
    ]);
  });

  it("skips a market with a missing selection and ignores prices unless asked", () => {
    const [partial] = parseMainRows([{ ...mainRow, AvgD: "" }], null, null, true);
    expect(partial.prices.map((item) => item.marketKey)).toEqual(["over_under_goals", "over_under_goals"]);
    expect(parseMainRows([mainRow], null)[0].prices).toEqual([]);
  });

  it("never attaches prices to completed matches", () => {
    const [match] = parseMainRows([{ ...mainRow, FTHG: "2", FTAG: "1" }], null, null, true);
    expect(match.prices).toEqual([]);
  });

  it("reads 1X2 from the extra-leagues fixtures file", () => {
    const row = { Country: "Brazil", League: "Serie A", Date: "18/10/2026", Time: "20:00", Home: "Flamengo", Away: "Santos", AvgH: "1.50", AvgD: "4.10", AvgA: "6.50" };
    const [match] = parseExtraRows([row], null, null, true);
    expect(match.fixture.leagueExternalId).toBe("BRA");
    expect(match.prices.map((item) => item.selection)).toEqual(["home", "draw", "away"]);
  });
});
