import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PickCard } from "./pick-card";
import type { DailyPick } from "@/lib/types";

const pick: DailyPick = {
  fixture_id: 4,
  match: "Harbor City vs Lowfield United",
  home: "Harbor City",
  away: "Lowfield United",
  league: "Premier Research",
  kickoff_at: "2026-10-10T15:00:00+00:00",
  market_key: "match_result",
  market_name: "Match result",
  selection: "home",
  line: null,
  model_probability: "0.62",
  implied_probability: "0.61",
  decimal_odds: "1.55",
  captured_at: "2026-10-09T12:00:00+00:00",
  bookmaker: "1xBet",
  data_quality: "0.8000",
  sample_size: 40,
  sample_note: "Sample quality 0.8000; 40 league matches in the window.",
  disagreement: false,
  conservative: true,
  data_origin: "provider",
};

describe("PickCard", () => {
  it("shows book and model probabilities, not accumulator odds", () => {
    render(<PickCard pick={pick} />);
    expect(screen.getByText("Harbor City vs Lowfield United")).toBeInTheDocument();
    expect(screen.getByText("61.0%")).toBeInTheDocument();
    expect(screen.getByText("62.0%")).toBeInTheDocument();
    expect(screen.getByText("1.55")).toBeInTheDocument();
    expect(screen.getByText("Both ≥ 60%")).toBeInTheDocument();
    expect(screen.queryByText(/joint/i)).not.toBeInTheDocument();
  });
});
