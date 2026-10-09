import { NextResponse } from "next/server";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Enter a username and password." } },
      { status: 422 },
    );
  }
  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const response = await fetch(`${backend}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({ error: { message: "Login failed." } }));
  if (!response.ok || !payload.access_token) {
    return NextResponse.json(payload, { status: response.status || 401 });
  }
  const next = NextResponse.json({ ok: true });
  next.cookies.set("spl_session", payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: payload.expires_in ?? 60 * 60 * 12,
  });
  return next;
}
