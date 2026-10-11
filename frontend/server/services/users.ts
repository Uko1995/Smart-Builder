import type { Settings } from "@/server/config";
import type { Db } from "@/server/db/client";
import { hashPassword, verifyPassword } from "@/server/passwords";

export const MIN_PASSWORD_LENGTH = 12;

type UserRow = { id: number; username: string; password_hash: string; is_active: boolean };

/** A fixed hash so a login for an unknown user costs the same time as a wrong password. */
let dummyHash: Promise<string> | null = null;

export async function setUser(db: Db, username: string, password: string): Promise<{ username: string; created: boolean }> {
  const name = username.trim();
  if (!name || name.length > 80) throw new Error("Username must be 1 to 80 characters.");
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const hash = await hashPassword(password);
  const [row] = await db<{ created: boolean }[]>`
    INSERT INTO users (username, password_hash) VALUES (${name}, ${hash})
    ON CONFLICT ON CONSTRAINT uq_users_username DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true, updated_at = now()
    RETURNING (xmax = 0) AS created`;
  return { username: name, created: row.created };
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM users WHERE is_active`;
  return row.count;
}

/** First login on an empty table copies DASHBOARD_USERNAME / DASHBOARD_PASSWORD in, if they are set. */
export async function bootstrapFromEnv(db: Db, settings: Settings): Promise<void> {
  if (!settings.dashboardUsername || !settings.dashboardPassword) return;
  if ((await countUsers(db)) > 0) return;
  await setUser(db, settings.dashboardUsername, settings.dashboardPassword);
}

export async function authenticate(db: Db, username: string, password: string): Promise<string | null> {
  const [user] = await db<UserRow[]>`SELECT id, username, password_hash, is_active FROM users WHERE username = ${username.trim()}`;
  if (!user || !user.is_active) {
    dummyHash ??= hashPassword("timing-equaliser-password");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, user.password_hash))) return null;
  await db`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  return user.username;
}

export async function isActiveUser(db: Db, username: string): Promise<boolean> {
  const [row] = await db<{ ok: boolean }[]>`SELECT is_active AS ok FROM users WHERE username = ${username}`;
  return Boolean(row?.ok);
}
