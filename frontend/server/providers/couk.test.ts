import { describe, expect, it } from "vitest";
import { estimatedCollection, parseExtraRows, parseMainRows, rowQuotes } from "@/server/providers/couk";

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

describe("football-data.co.uk per-book quotes", () => {
  const kickoff = new Date(Date.UTC(2024, 9, 19, 14, 0));
  const row = {
    PSH: "2.00", PSD: "3.50", PSA: "4.00", "P>2.5": "1.90", "P<2.5": "1.95",
    PSCH: "1.95", PSCD: "3.60", PSCA: "4.20", "PC>2.5": "1.85", "PC<2.5": "2.00",
    B365CH: "1.90", B365CD: "3.50", B365CA: "",
    BFECH: "1.98", BFECD: "3.70", BFECA: "4.40",
  };

  it("keeps complete markets per book and phase with closing stamped at kick-off", () => {
    const quotes = rowQuotes(row, kickoff, ["early", "closing"], false);
    const keys = quotes.map((quote) => `${quote.book}:${quote.phase}`);
    expect(keys).toEqual(["pinnacle:early", "pinnacle:closing", "betfair_exchange:closing"]);
    const closing = quotes.find((quote) => quote.book === "pinnacle" && quote.phase === "closing")!;
    expect(closing).toMatchObject({ home: 1.95, over: 1.85, under: 2, capturedAt: kickoff, estimated: true });
    expect(quotes.find((quote) => quote.book === "betfair_exchange")).toMatchObject({ over: null, under: null });
  });

  it("estimates history collection times and leaves fetched early prices to the fetch time", () => {
    const saturday = new Date(Date.UTC(2024, 9, 19, 14, 0));
    expect(estimatedCollection(saturday).toISOString()).toBe("2024-10-18T16:00:00.000Z");
    const [early] = rowQuotes(row, kickoff, ["early"], true);
    expect(early).toMatchObject({ capturedAt: null, estimated: false });
  });
});
