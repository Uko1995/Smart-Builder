/** The scheduled job: refresh data, generate today's predictions, settle finished matches, prune old rows. */

import type { Settings } from "@/server/config";
import type { Sql } from "@/server/db/client";
import { addDays, todayUtc } from "@/server/http";
import { refreshProviders, type RefreshScope } from "@/server/services/ingestion";
import { createPredictionRun, PredictionRequestError, pruneOldPredictions } from "@/server/services/predictions";
import { seedReference } from "@/server/services/reference";
import { settleCompleted } from "@/server/services/settlement";

export type DailyStep = "fixtures" | "odds" | "predict" | "settle" | "prune";

export const ALL_STEPS: DailyStep[] = ["fixtures", "odds", "predict", "settle", "prune"];

export async function runDaily(sql: Sql, settings: Settings, steps: DailyStep[] = ALL_STEPS, scope = todayUtc()) {
  await seedReference(sql, settings);
  const report: Record<string, unknown> = { scope_date: scope };
  const refresh = async (kind: RefreshScope, from: string, to: string) => {
    const runs = await refreshProviders(sql, settings, { dateFrom: from, dateTo: to, scope: kind });
    return runs.map((run) => ({ id: run.id, status: run.status }));
  };
  if (steps.includes("fixtures")) report.fixtures = await refresh("fixtures", addDays(scope, -10), addDays(scope, 1));
  if (steps.includes("odds")) report.odds = await refresh("odds", scope, addDays(scope, 1));
  if (steps.includes("settle")) report.settled = await settleCompleted(sql);
  if (steps.includes("predict")) {
    try {
      const { batch } = await createPredictionRun(sql, settings, {
        scopeDate: scope,
        leagueId: null,
        idempotencyKey: `cron-${scope}-${Date.now()}`,
        refresh: false,
        timeBudgetSeconds: settings.predictionTimeBudgetCapSeconds,
      });
      report.prediction = { public_id: batch.public_id, status: batch.status, diagnostics: batch.diagnostics };
    } catch (error) {
      if (!(error instanceof PredictionRequestError)) throw error;
      report.prediction = { status: "failed", code: error.code, message: error.message };
    }
  }
  if (steps.includes("prune")) report.pruned = await pruneOldPredictions(sql, settings.predictionRetentionDays);
  return report;
}
