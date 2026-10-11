/** Operator commands: `npm run cli -- <command> [--date YYYY-MM-DD] [--seasons N] [--steps a,b]`. */

import { randomUUID } from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import readline from "node:readline";
import { getSettings } from "@/server/config";
import { closeDb, getDb } from "@/server/db/client";
import { migrate } from "@/server/db/migrate";
import { parseDate, todayUtc } from "@/server/http";
import { ALL_STEPS, runDaily, type DailyStep } from "@/server/services/daily";
import { seedDemo } from "@/server/services/demo";
import { importHistory } from "@/server/services/history";
import { createPredictionRun } from "@/server/services/predictions";
import { seedReference } from "@/server/services/reference";
import { countUsers, setUser } from "@/server/services/users";

// WSL often has no IPv6 route, and Node's 250 ms per-address default is too short for a remote Neon host.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    output._writeToOutput = (text: string) => {
      if (!prompted) {
        output.output.write(text);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const settings = getSettings();
  const sql = getDb();
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  switch (command) {
    case "migrate":
      print({ applied: await migrate(sql, (line) => console.error(line)) });
      break;
    case "seed-reference":
      await seedReference(sql, settings);
      print({ ok: true });
      break;
    case "import-history": {
      await seedReference(sql, settings);
      const seasons = Number(option(args, "seasons") ?? settings.historySeasons);
      print(await importHistory(sql, settings, seasons, (label, found) => console.error(`${found ? "loaded" : "missing"} ${label}`)));
      break;
    }
    case "predict": {
      const scopeDate = parseDate(option(args, "date")) ?? todayUtc();
      const { batch } = await createPredictionRun(sql, settings, {
        scopeDate,
        leagueId: null,
        idempotencyKey: `cli-${randomUUID()}`,
        refresh: args.includes("--refresh"),
        timeBudgetSeconds: Number(option(args, "budget") ?? 600),
      });
      print({ public_id: batch.public_id, status: batch.status, warnings: batch.warnings.length, diagnostics: batch.diagnostics });
      break;
    }
    case "daily": {
      const steps = (option(args, "steps")?.split(",") ?? ALL_STEPS) as DailyStep[];
      print(await runDaily(sql, settings, steps, parseDate(option(args, "date")) ?? todayUtc()));
      break;
    }
    case "seed-user": {
      if (!settings.dashboardUsername || !settings.dashboardPassword) throw new Error("Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD first.");
      const result = await setUser(sql, settings.dashboardUsername, settings.dashboardPassword);
      print({ username: result.username, created: result.created, users: await countUsers(sql) });
      break;
    }
    case "set-user": {
      const username = option(args, "username");
      if (!username) throw new Error("Usage: set-user --username NAME");
      const password = await askHidden(`New password for ${username}: `);
      if (password !== (await askHidden("Repeat password: "))) throw new Error("Passwords do not match.");
      const result = await setUser(sql, username, password);
      print({ username: result.username, created: result.created, users: await countUsers(sql) });
      break;
    }
    case "seed-demo":
      print(await seedDemo(sql, settings));
      break;
    default:
      console.error("commands: migrate | seed-reference | import-history [--seasons N] | predict [--date D] [--refresh] | daily [--steps s] [--date D] | seed-demo | seed-user | set-user --username NAME");
      process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
