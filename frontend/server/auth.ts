import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Settings } from "@/server/config";

export const SESSION_COOKIE = "spl_session";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function secretsMatch(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function key(settings: Settings): Uint8Array {
  return new TextEncoder().encode(settings.authSecret);
}

export async function createToken(settings: Settings, username: string, now = new Date()): Promise<string> {
  const issued = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(issued)
    .setExpirationTime(issued + settings.sessionHours * 3600)
    .sign(key(settings));
}

export async function decodeToken(settings: Settings, token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, key(settings), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new Error("invalid session");
    }
    return payload.sub;
  } catch {
    throw new Error("invalid session");
  }
}
