/** Manual CSV import. Rows are validated and labelled with their declared origin. */

import Papa from "papaparse";
import type { Settings } from "@/server/config";
import type { Sql } from "@/server/db/client";
import { parseUtc } from "@/server/providers/parsing";
import { seedReference } from "@/server/services/reference";
import { attachOddsByExternalId, upsertNormalizedFixture, upsertStatistics } from "@/server/services/store";

const FIXTURE_COLUMNS = ["external_id", "league", "season", "kickoff_utc", "home_team", "away_team", "status", "data_origin"];
const ODDS_COLUMNS = ["fixture_external_id", "bookmaker_key", "market_key", "selection", "decimal_odds", "captured_at_utc", "data_origin"];
const ALLOWED_ORIGINS = new Set(["manual", "synthetic_demo"]);
const ALLOWED_BOOKS = new Set(["bet9ja", "sportybet", "onexbet", "demo_book"]);
const STATUSES = new Set(["scheduled", "completed", "postponed", "cancelled", "unknown"]);

export class ImportErrorSet extends Error {
  constructor(public errors: string[]) {
    super(errors.join("; "));
  }
}

class Rollback extends Error {}

type Row = Record<string, string>;

function readFrame(raw: string, required: string[]): Row[] {
  const parsed = Papa.parse<Row>(raw.replace(/^\ufeff/, ""), { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() });
  if (parsed.errors.length && !parsed.data.length) throw new ImportErrorSet([`CSV could not be read: ${parsed.errors[0].message}`]);
  const columns = new Set(parsed.meta.fields ?? []);
  const missing = required.filter((column) => !columns.has(column)).sort();
  if (missing.length) throw new ImportErrorSet([`missing columns: ${missing.join(", ")}`]);
  if (!parsed.data.length) throw new ImportErrorSet(["the file has no data rows"]);
  return parsed.data;
}

function present(value: string | undefined): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function optionalInt(value: string | undefined): number | null {
  if (!present(value)) return null;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`expected an integer, got ${value}`);
  return number;
}

function optionalDecimal(value: string | undefined, places: number): string | null {
  if (!present(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`expected a decimal, got ${value}`);
  return number.toFixed(places);
}

async function inTransaction(sql: Sql, body: (tx: Sql) => Promise<{ written: number; errors: string[] }>) {
  let outcome: { written: number; errors: string[] } = { written: 0, errors: [] };
  try {
    await sql.begin(async (tx) => {
      outcome = await body(tx as unknown as Sql);
      if (outcome.errors.length) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (outcome.errors.length) throw new ImportErrorSet(outcome.errors);
  return outcome.written;
}

export async function importFixturesCsv(sql: Sql, settings: Settings, raw: string) {
  await seedReference(sql, settings);
  const rows = readFrame(raw, FIXTURE_COLUMNS);
  const written = await inTransaction(sql, async (tx) => {
    const errors: string[] = [];
    let count = 0;
    for (const [index, row] of rows.entries()) {
      try {
        const origin = String(row.data_origin).trim();
        if (!ALLOWED_ORIGINS.has(origin)) throw new Error("data_origin must be manual or synthetic_demo");
        const status = String(row.status).trim();
        if (!STATUSES.has(status)) throw new Error("status is not recognised");
        const fixture = await upsertNormalizedFixture(tx, {
          providerKey: origin === "manual" ? "manual" : "synthetic_demo",
          externalId: row.external_id.trim(),
          leagueExternalId: row.league.trim(),
          leagueName: row.league.trim(),
          country: null,
          seasonName: row.season.trim(),
          kickoff: parseUtc(row.kickoff_utc.trim()),
          homeExternalId: row.home_team.trim(),
          homeName: row.home_team.trim(),
          awayExternalId: row.away_team.trim(),
          awayName: row.away_team.trim(),
          status,
          homeGoals: optionalInt(row.home_goals),
          awayGoals: optionalInt(row.away_goals),
          htHomeGoals: optionalInt(row.ht_home_goals),
          htAwayGoals: optionalInt(row.ht_away_goals),
          dataOrigin: origin,
        });
        if (["home_corners", "away_corners", "home_cards", "away_cards", "home_xg", "away_xg"].some((name) => present(row[name]))) {
          await upsertStatistics(
            tx,
            fixture.id,
            {
              home_corners: optionalInt(row.home_corners),
              away_corners: optionalInt(row.away_corners),
              home_cards: optionalInt(row.home_cards),
              away_cards: optionalInt(row.away_cards),
              home_xg: optionalDecimal(row.home_xg, 3),
              away_xg: optionalDecimal(row.away_xg, 3),
            },
            "manual_import",
          );
        }
        count += 1;
      } catch (error) {
        errors.push(`row ${index + 2}: ${(error as Error).message}`);
      }
    }
    return { written: count, errors };
  });
  return { written, label: "imported rows keep the data_origin from the file" };
}

export async function importOddsCsv(sql: Sql, settings: Settings, raw: string) {
  await seedReference(sql, settings);
  const rows = readFrame(raw, ODDS_COLUMNS);
  const written = await inTransaction(sql, async (tx) => {
    const errors: string[] = [];
    let count = 0;
    for (const [index, row] of rows.entries()) {
      try {
        const origin = String(row.data_origin).trim();
        const book = String(row.bookmaker_key).trim();
        if (!ALLOWED_ORIGINS.has(origin)) throw new Error("data_origin must be manual or synthetic_demo");
        if (!ALLOWED_BOOKS.has(book)) throw new Error("bookmaker_key is not one of the supported books");
        if (book === "demo_book" && origin !== "synthetic_demo") throw new Error("demo_book only accepts synthetic_demo rows");
        const odds = Number(row.decimal_odds);
        if (!Number.isFinite(odds) || odds <= 1) throw new Error("decimal_odds must be a number greater than 1");
        const externalId = row.fixture_external_id.trim();
        const result = await attachOddsByExternalId(tx, externalId, {
          providerKey: origin === "manual" ? "manual" : "synthetic_demo",
          fixtureExternalId: externalId,
          homeName: "",
          awayName: "",
          kickoff: new Date(),
          bookmakerKey: book,
          bookmakerName: book,
          providerMarketKey: "manual",
          marketKey: row.market_key.trim(),
          selection: row.selection.trim(),
          line: optionalDecimal(row.line, 2),
          decimalOdds: odds.toFixed(4),
          capturedAt: parseUtc(row.captured_at_utc.trim()),
          mappingStatus: origin === "manual" ? "manual" : "verified",
          dataOrigin: origin,
        });
        if (result !== "written" && result !== "duplicate") throw new Error(`odds were not attached (${result}). Import the fixture first.`);
        count += 1;
      } catch (error) {
        errors.push(`row ${index + 2}: ${(error as Error).message}`);
      }
    }
    return { written: count, errors };
  });
  return { written };
}
