import type { DailyPick } from "@/lib/types";

export const ALL_TAB_LIMIT = 30;

export type PickTab = {
  id: string;
  label: string;
  /** Core tabs stay visible with a zero count; the rest appear only when they have picks. */
  core: boolean;
  matches: (pick: DailyPick) => boolean;
};

function selection(market: string, value: string) {
  return (pick: DailyPick) => pick.market_key === market && pick.selection === value;
}

function goals(side: "over" | "under", line: number) {
  return (pick: DailyPick) =>
    pick.market_key === "over_under_goals" && pick.selection === side && Number(pick.line) === line;
}

export const PICK_TABS: PickTab[] = [
  { id: "home", label: "Home wins", core: true, matches: selection("match_result", "home") },
  { id: "away", label: "Away wins", core: true, matches: selection("match_result", "away") },
  { id: "draw", label: "Draws", core: false, matches: selection("match_result", "draw") },
  { id: "over-1-5", label: "Over 1.5", core: true, matches: goals("over", 1.5) },
  { id: "over-2-5", label: "Over 2.5", core: true, matches: goals("over", 2.5) },
  { id: "over-3-5", label: "Over 3.5", core: false, matches: goals("over", 3.5) },
  { id: "under-1-5", label: "Under 1.5", core: false, matches: goals("under", 1.5) },
  { id: "under-2-5", label: "Under 2.5", core: true, matches: goals("under", 2.5) },
  { id: "under-3-5", label: "Under 3.5", core: true, matches: goals("under", 3.5) },
  { id: "btts-yes", label: "BTTS Yes", core: true, matches: selection("btts", "yes") },
  { id: "btts-no", label: "BTTS No", core: false, matches: selection("btts", "no") },
  { id: "dc-1x", label: "Home or draw", core: false, matches: selection("double_chance", "home_or_draw") },
  { id: "dc-x2", label: "Draw or away", core: false, matches: selection("double_chance", "draw_or_away") },
  { id: "dc-12", label: "Home or away", core: false, matches: selection("double_chance", "home_or_away") },
  { id: "dnb-home", label: "DNB home", core: false, matches: selection("draw_no_bet", "home") },
  { id: "dnb-away", label: "DNB away", core: false, matches: selection("draw_no_bet", "away") },
  { id: "handicap", label: "Handicaps", core: false, matches: (pick) => pick.market_key === "asian_handicap" },
];

export type PickTabView = { id: string; label: string; picks: DailyPick[]; total: number };

/** Picks arrive ranked; each tab keeps that order. "All" shows the top {@link ALL_TAB_LIMIT}. */
export function groupPicks(picks: DailyPick[]): PickTabView[] {
  const tabs: PickTabView[] = [
    { id: "all", label: "All", picks: picks.slice(0, ALL_TAB_LIMIT), total: picks.length },
  ];
  for (const tab of PICK_TABS) {
    const matched = picks.filter(tab.matches);
    if (tab.core || matched.length > 0) {
      tabs.push({ id: tab.id, label: tab.label, picks: matched, total: matched.length });
    }
  }
  return tabs;
}
