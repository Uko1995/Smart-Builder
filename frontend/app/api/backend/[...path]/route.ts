import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["health", "ready"]);

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.some((segment) => segment === ".." || segment.includes("\\") || segment.includes("/"))) {
    return NextResponse.json(
      { error: { code: "bad_path", message: "That path is not allowed." } },
      { status: 400 },
    );
  }
  const backend = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const base = new URL(backend);
  const incoming = new URL(request.url);
  const target = new URL(`/${path.join("/")}${incoming.search}`, base);
  if (target.origin !== base.origin) {
    return NextResponse.json(
      { error: { code: "bad_path", message: "That path is not allowed." } },
      { status: 400 },
    );
  }
  const token = (await cookies()).get("spl_session")?.value;
  if (!PUBLIC_PATHS.has(path[0]) && !token) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Authentication is required." } },
      { status: 401 },
    );
  }
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const idempotency = request.headers.get("idempotency-key");
  if (idempotency) headers.set("idempotency-key", idempotency);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.text() : undefined,
    cache: "no-store",
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
