import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "@/server/db/client";

const MIGRATIONS_DIR = path.join(process.cwd(), "server", "db", "migrations");

export async function migrate(sql: Sql, log: (line: string) => void = () => undefined): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name varchar(200) PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    log(`applied ${file}`);
    ran.push(file);
  }
  return ran;
}
