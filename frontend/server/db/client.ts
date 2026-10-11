import postgres from "postgres";
import { getSettings } from "@/server/config";

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
export type Db = Sql | Tx;

const globalForDb = globalThis as unknown as { __splSql?: Sql };

export function getDb(): Sql {
  if (globalForDb.__splSql) return globalForDb.__splSql;
  const settings = getSettings();
  const sql = postgres(settings.databaseUrl, {
    max: process.env.VERCEL ? 3 : 8,
    idle_timeout: 20,
    connect_timeout: 15,
    // Neon's pooled endpoint runs PgBouncer in transaction mode.
    prepare: false,
    onnotice: () => undefined,
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => value.toString(),
        parse: (value: string) => Number(value),
      },
      date: {
        to: 1082,
        from: [1082],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
    },
  }) as unknown as Sql;
  globalForDb.__splSql = sql;
  return sql;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__splSql) {
    await globalForDb.__splSql.end({ timeout: 5 });
    globalForDb.__splSql = undefined;
  }
}
