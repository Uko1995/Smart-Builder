import { secretsMatch } from "@/server/auth";
import { getSettings } from "@/server/config";
import { getDb } from "@/server/db/client";
import { ApiError, errorResponse, json } from "@/server/http";
import { ALL_STEPS, runDaily, type DailyStep } from "@/server/services/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. `?steps=odds,predict` runs a subset. */
export async function GET(request: Request) {
  try {
    const settings = getSettings();
    const header = request.headers.get("authorization") ?? "";
    if (!settings.cronSecret || !secretsMatch(header, `Bearer ${settings.cronSecret}`)) {
      throw new ApiError(401, "unauthorized", "Cron secret is missing or wrong.");
    }
    const requested = new URL(request.url).searchParams.get("steps");
    const steps = requested
      ? requested.split(",").filter((step): step is DailyStep => (ALL_STEPS as string[]).includes(step))
      : ALL_STEPS;
    return json(await runDaily(getDb(), settings, steps));
  } catch (error) {
    return errorResponse(error);
  }
}
