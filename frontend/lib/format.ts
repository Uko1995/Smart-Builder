export function formatOdds(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toFixed(2);
}

export function formatProbability(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${(number * 100).toFixed(1)}%`;
}

export function formatSigned(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "—";
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${number.toFixed(3)}`;
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

export function readApiError(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: string } }).error?.message;
    if (message) return message;
  }
  return `Request failed (${status}).`;
}

export type RunTone = "idle" | "running" | "ok" | "warn" | "bad" | "muted";

export function runStatusLabel(status: string | null | undefined): { label: string; tone: RunTone; detail: string } {
  switch (status) {
    case "running":
      return { label: "Run in progress", tone: "running", detail: "The result is not ready until the stored status changes." };
    case "succeeded":
      return { label: "Completed", tone: "ok", detail: "Predictions and qualifying slips were stored." };
    case "succeeded_with_warnings":
      return { label: "Completed with warnings", tone: "warn", detail: "A result was stored, and some markets or samples need attention." };
    case "failed":
      return { label: "Failed", tone: "bad", detail: "The run did not produce a prediction batch." };
    case "insufficient_data":
      return { label: "Insufficient data", tone: "muted", detail: "The available history was not enough to estimate the fixtures." };
    case "no_qualifying_slips":
      return { label: "No qualifying slips", tone: "warn", detail: "Predictions may exist, but no slip met the odds and quality rules." };
    default:
      return { label: "No run yet", tone: "idle", detail: "Generate predictions when you want a stored result for this date." };
  }
}
