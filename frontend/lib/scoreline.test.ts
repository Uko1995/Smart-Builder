import { describe, expect, it } from "vitest";
import { topScorelines } from "./scoreline";

describe("topScorelines", () => {
  it("keeps the highest stored cells and drops empty input", () => {
    const matrix = [
      [0.1, 0.2],
      [0.5, 0],
    ];
    expect(topScorelines(matrix, 2)).toEqual([
      { score: "1-0", probability: 0.5 },
      { score: "0-1", probability: 0.2 },
    ]);
    expect(topScorelines(null)).toEqual([]);
  });
});
