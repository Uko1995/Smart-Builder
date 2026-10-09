import { describe, expect, it } from "vitest";
import { formatOdds, formatProbability, formatSigned, readApiError, runStatusLabel } from "./format";

describe("formatters", () => {
  it("renders odds and probabilities without inventing a number", () => {
    expect(formatOdds(null)).toBe("—");
    expect(formatOdds("2.2")).toBe("2.20");
    expect(formatProbability("0.4")).toBe("40.0%");
    expect(formatSigned(-0.1)).toBe("-0.100");
    expect(formatSigned(0.25)).toBe("+0.250");
    expect(formatSigned("nope")).toBe("—");
  });

  it("reads the API error envelope", () => {
    expect(readApiError({ error: { message: "Authentication is required." } }, 401)).toBe("Authentication is required.");
    expect(readApiError(null, 500)).toBe("Request failed (500).");
  });

  it("names every stored run status", () => {
    expect(runStatusLabel("running").tone).toBe("running");
    expect(runStatusLabel("succeeded").tone).toBe("ok");
    expect(runStatusLabel("succeeded_with_warnings").tone).toBe("warn");
    expect(runStatusLabel("failed").tone).toBe("bad");
    expect(runStatusLabel("insufficient_data").label).toBe("Insufficient data");
    expect(runStatusLabel("no_qualifying_slips").label).toBe("No qualifying slips");
    expect(runStatusLabel(null).tone).toBe("idle");
  });
});
