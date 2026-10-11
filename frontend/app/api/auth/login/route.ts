import { NextResponse } from "next/server";
import { z } from "zod";
import { createToken, SESSION_COOKIE } from "@/server/auth";
import { assertRuntimeSecrets, getSettings } from "@/server/config";
import { getDb } from "@/server/db/client";
import { errorResponse } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { authenticate, bootstrapFromEnv } from "@/server/services/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Enter a username and password." } },
      { status: 422 },
    );
  }
  try {
    const settings = getSettings();
    assertRuntimeSecrets(settings);
    const db = getDb();
    await enforceRateLimit(db, `login:${clientAddress(request)}`, 8, 60, "Too many login attempts.");
    await bootstrapFromEnv(db, settings);
    const username = await authenticate(db, parsed.data.username, parsed.data.password);
    if (username === null) {
      return NextResponse.json(
        { error: { code: "invalid_credentials", message: "Invalid username or password." } },
        { status: 401 },
      );
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, await createToken(settings, username), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: settings.sessionHours * 3600,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
