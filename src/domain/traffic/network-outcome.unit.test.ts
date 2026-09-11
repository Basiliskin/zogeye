import { describe, expect, it } from "vitest";
import { hasNetworkOutcome } from "./network-outcome.js";
import type { RequestFact } from "../models.js";

const request = (partial: Partial<RequestFact>): RequestFact => ({
  url: "https://api.example.test/data",
  method: "GET",
  timestamp: 0,
  ...partial,
});

describe("hasNetworkOutcome", () => {
  it("accepts calls with an HTTP response status", () => {
    expect(hasNetworkOutcome(request({ responseStatus: 204 }))).toBe(true);
  });

  it("accepts explicitly failed calls", () => {
    expect(hasNetworkOutcome(request({ source: "fetch-error" }))).toBe(true);
    expect(hasNetworkOutcome(request({ source: "xhr-error" }))).toBe(true);
  });

  it("rejects request-only captures", () => {
    expect(hasNetworkOutcome(request({ source: "sendBeacon" }))).toBe(false);
    expect(hasNetworkOutcome(request({ source: "websocket" }))).toBe(false);
  });
});
