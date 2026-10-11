/** Clearly labelled synthetic fixtures. These are not real matches or prices. */

import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import { addDays } from "@/server/http";
import { seedReference } from "@/server/services/reference";
import { attachOdds, upsertNormalizedFixture } from "@/server/services/store";

const TEAMS: [string, string, number, number][] = [
  ["harbor", "Harbor City", 1.3, 0.82],
  ["lantern", "Red Lantern", 1.15, 0.9],
  ["quarry", "North Quarry", 1.05, 0.98],
  ["eastmill", "Eastmill", 0.95, 1.05],
  ["dock", "Silver Dock", 0.88, 1.12],
  ["lowfield", "Lowfield United", 0.78, 1.22],
];

/** Small seeded generator so the demo league is the same on every run. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rate: number, random: () => number): number {
  const limit = Math.exp(-rate);
  let k = 0;
  let product = random();
  while (product > limit) {
    k += 1;
    product *= random();
  }
  return k;
}

function at(day: string, hour: number): Date {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
}

export async function seedDemo(db: Db, settings: Settings, today = new Date().toISOString().slice(0, 10)) {
  await seedReference(db, settings);
  const random = mulberry32(20261009);
  const year = today.slice(0, 4);
  const base = {
    providerKey: "synthetic_demo",
    leagueExternalId: "spl-demo",
    leagueName: "SPL Demo League (synthetic)",
    country: "Demo",
    seasonName: `${year}-demo`,
    htHomeGoals: null,
    htAwayGoals: null,
    dataOrigin: "synthetic_demo",
  };
  let written = 0;
  let matchNo = 0;
  let day = addDays(today, -80);
  for (let round = 0; round < 2; round += 1) {
    for (const [homeIndex, home] of TEAMS.entries()) {
      for (const [awayIndex, away] of TEAMS.entries()) {
        if (homeIndex === awayIndex) continue;
        matchNo += 1;
        await upsertNormalizedFixture(db, {
          ...base,
          externalId: `demo-r${round}-${matchNo}`,
          kickoff: at(day, 15),
          homeExternalId: home[0],
          homeName: home[1],
          awayExternalId: away[0],
          awayName: away[1],
          status: "completed",
          homeGoals: poisson(Math.max(0.2, 1.35 * home[2] * away[3]), random),
          awayGoals: poisson(Math.max(0.2, 1.1 * away[2] * home[3]), random),
        });
        written += 1;
        day = addDays(day, 1);
        if (day >= today) day = addDays(today, -2);
      }
    }
  }
  const upcoming: string[] = [];
  const pairs: [number, number][] = [
    [0, 5],
    [1, 4],
    [2, 3],
    [0, 4],
  ];
  const tomorrow = addDays(today, 1);
  for (const [offset, [homeIndex, awayIndex]] of pairs.entries()) {
    const home = TEAMS[homeIndex];
    const away = TEAMS[awayIndex];
    const externalId = `demo-upcoming-${offset}`;
    const kickoff = at(tomorrow, 15 + offset);
    await upsertNormalizedFixture(db, {
      ...base,
      externalId,
      kickoff,
      homeExternalId: home[0],
      homeName: home[1],
      awayExternalId: away[0],
      awayName: away[1],
      status: "scheduled",
      homeGoals: null,
      awayGoals: null,
    });
    upcoming.push(externalId);
    const captured = new Date();
    const cache = new Map<string, number | string>();
    for (const [selection, price] of [
      ["home", "2.2000"],
      ["draw", "3.4000"],
      ["away", "4.1000"],
    ]) {
      await attachOdds(
        db,
        {
          providerKey: "synthetic_demo",
          fixtureExternalId: externalId,
          homeName: home[1],
          awayName: away[1],
          kickoff,
          bookmakerKey: "demo_book",
          bookmakerName: "Demo Book (synthetic)",
          providerMarketKey: "synthetic_h2h",
          marketKey: "match_result",
          selection,
          line: null,
          decimalOdds: price,
          capturedAt: captured,
          mappingStatus: "verified",
          dataOrigin: "synthetic_demo",
        },
        cache,
      );
    }
  }
  return { label: "synthetic demonstration data", completed_matches: written, upcoming_external_ids: upcoming, scope_date: tomorrow };
}
