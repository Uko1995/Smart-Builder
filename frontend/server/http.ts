import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(error: unknown, requestId?: string): NextResponse {
  if (error instanceof ApiError) {
    return json({ error: { code: error.code, message: error.message, request_id: requestId ?? null } }, error.status);
  }
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    return json({ error: { code: "invalid_request", message, request_id: requestId ?? null } }, 422);
  }
  console.error("unhandled API error", error);
  return json({ error: { code: "internal_error", message: "The server could not complete the request.", request_id: requestId ?? null } }, 500);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string | null | undefined, field = "scope_date"): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ApiError(422, "invalid_request", `${field} must be a date in YYYY-MM-DD format.`);
  }
  return value;
}

export function parseOptionalNumber(value: string | null, field: string): number | null {
  if (value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ApiError(422, "invalid_request", `${field} must be a number.`);
  return number;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const moment = new Date(`${day}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

export function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const moment = value instanceof Date ? value : new Date(value);
  return moment.toISOString().replace(/\.000Z$/, "Z").replace("Z", "+00:00");
}
