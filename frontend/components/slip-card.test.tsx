import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SlipCard } from "./slip-card";
import type { Slip } from "@/lib/types";

const slip: Slip = {
  public_id: "slip-1",
  strategy: "balanced_value",
  label: "Balanced value",
  combined_odds: "12.50",
  selection_count: 1,
  joint_probability: "0.31",
  joint_probability_method: "scoreline_joint",
  expected_value: "0.120",
  ev_status: "estimated",
  preparation_status: "ready_for_review",
  review_status: "pending",
  review_note: null,
  booking_code: null,
  booking_bookmaker: null,
  warnings: ["Selections in different matches are treated as independent."],
  diagnostics: { omitted: { higher_odds: "Combined odds stayed below 10." } },
  selections: [
    {
      position: 1,
      fixture_id: 4,
      match: "Harbor City vs Lowfield United",
      kickoff_at: "2026-10-10T15:00:00+00:00",
      market_key: "match_result",
      market_name: "Match result",
      selection: "home",
      line: null,
      probability: "0.48",
      fair_odds: "2.08",
      decimal_odds: "2.20",
      captured_at: "2026-10-09T12:00:00+00:00",
      bookmaker_key: "demo_book",
      bookmaker_name: "Demo Book (synthetic)",
      mapping_status: "verified",
      data_origin: "synthetic_demo",
      rationale: "Home win from the stored scoreline.",
      odds_changed: true,
      latest_decimal_odds: "2.40",
    },
  ],
  disclaimer: "Verify every selection and price on the bookmaker.",
};

describe("SlipCard", () => {
  it("shows the stored slip, the synthetic label, and the omitted strategy", () => {
    const onExport = vi.fn();
    render(<SlipCard slip={slip} onExport={onExport} onDecision={() => undefined} />);
    expect(screen.getByText("Balanced value")).toBeInTheDocument();
    expect(screen.getByText("12.50")).toBeInTheDocument();
    expect(screen.getByText("Synthetic demo")).toBeInTheDocument();
    expect(screen.getByText(/higher odds: Combined odds stayed below 10/)).toBeInTheDocument();
    expect(screen.getByText(/newest stored price/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Export" }).click();
    expect(onExport).toHaveBeenCalledOnce();
  });
});
