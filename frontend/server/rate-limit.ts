import type { Db } from "@/server/db/client";
import { ApiError } from "@/server/http";

/** Sliding-window limit stored in Postgres, because serverless instances share no memory. */
export async function enforceRateLimit(db: Db, bucket: string, limit: number, windowSeconds: number, label: string): Promise<void> {
  await db`DELETE FROM rate_limit_hits WHERE hit_at < now() - make_interval(secs => ${windowSeconds * 2})`;
  const [row] = await db<{ hits: number; oldest: Date | null }[]>`
    SELECT count(*)::int AS hits, min(hit_at) AS oldest
    FROM rate_limit_hits
    WHERE bucket = ${bucket} AND hit_at > now() - make_interval(secs => ${windowSeconds})
  `;
  if (row.hits >= limit) {
    const retry = row.oldest ? Math.max(1, Math.ceil(windowSeconds - (Date.now() - row.oldest.getTime()) / 1000)) : windowSeconds;
    throw new ApiError(429, "rate_limited", `${label} Retry in ${retry} seconds.`);
  }
  await db`INSERT INTO rate_limit_hits (bucket) VALUES (${bucket})`;
}
