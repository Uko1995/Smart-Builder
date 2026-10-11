import { cookies } from "next/headers";
import { dispatch } from "@/server/api/router";
import { SESSION_COOKIE } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  return dispatch(request, path, token);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
