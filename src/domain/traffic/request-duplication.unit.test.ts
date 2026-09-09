import { describe, expect, it } from "vitest";
import { findRequestDuplication } from "./request-duplication.js";
import type { Finding, RequestFact } from "../models.js";

const req = (partial: Partial<RequestFact>): RequestFact => ({
  url: "https://api.example.com/v1/thing",
  method: "GET",
  timestamp: 0,
  ...partial,
});

const ids = (findings: Finding[]): string[] => findings.map((f) => f.ruleId);

const series = (
  count: number,
  step: number,
  partial: Partial<RequestFact> = {},
): RequestFact[] =>
  Array.from({ length: count }, (_, i) =>
    req({ ...partial, timestamp: i * step }),
  );

describe("findRequestDuplication — storms", () => {
  it("stays quiet for a single call", () => {
    expect(findRequestDuplication([req({})])).toEqual([]);
  });

  it("reads exactly two tightly-spaced calls as the StrictMode shape", () => {
    const found = findRequestDuplication([
      req({ timestamp: 0 }),
      req({ timestamp: 40 }),
    ]);
    expect(ids(found)).toEqual(["client.strict-mode-double-invoke"]);
    expect(found[0]?.severity).toBe("info");
  });

  it("ignores two calls spaced far apart (deliberate user actions)", () => {
    expect(
      findRequestDuplication([
        req({ timestamp: 0 }),
        req({ timestamp: 5_000 }),
      ]),
    ).toEqual([]);
  });

  it("flags three-plus identical calls in a burst as a storm", () => {
    const found = findRequestDuplication(series(5, 50));
    expect(ids(found)).toContain("client.request-storm");
    expect(found[0]?.severity).toBe("low");
  });

  it("scales storm severity with the burst count", () => {
    expect(findRequestDuplication(series(6, 20))[0]?.severity).toBe("medium");
    expect(findRequestDuplication(series(15, 20))[0]?.severity).toBe("high");
  });

  it("normalises cache-buster params so calls collapse to one signature", () => {
    const found = findRequestDuplication([
      req({ url: "https://api.test/x?_=1", timestamp: 0 }),
      req({ url: "https://api.test/x?_=2", timestamp: 30 }),
      req({ url: "https://api.test/x?_=3", timestamp: 60 }),
    ]);
    expect(ids(found)).toContain("client.request-storm");
  });

  it("does not merge genuinely different endpoints", () => {
    expect(
      findRequestDuplication([
        req({ url: "https://api.test/a", timestamp: 0 }),
        req({ url: "https://api.test/b", timestamp: 20 }),
        req({ url: "https://api.test/c", timestamp: 40 }),
      ]),
    ).toEqual([]);
  });

  it("excludes static assets and stream frames", () => {
    expect(findRequestDuplication(series(5, 20, { url: "https://x.test/a.js" }))).toEqual(
      [],
    );
    expect(
      findRequestDuplication(series(5, 20, { source: "websocket-message" })),
    ).toEqual([]);
  });

  it("is order-independent", () => {
    const s = series(4, 100);
    expect(findRequestDuplication(s)).toEqual(
      findRequestDuplication([...s].reverse()),
    );
  });
});

describe("findRequestDuplication — retry jitter", () => {
  it("flags fixed-cadence retries after a retryable status", () => {
    const found = findRequestDuplication([
      req({ timestamp: 0, responseStatus: 503 }),
      req({ timestamp: 1_000, responseStatus: 503 }),
      req({ timestamp: 2_000, responseStatus: 503 }),
      req({ timestamp: 3_000, responseStatus: 200 }),
    ]);
    expect(ids(found)).toContain("retry.jitter-missing");
    expect(found.find((f) => f.ruleId === "retry.jitter-missing")?.severity).toBe(
      "medium",
    );
  });

  it("flags a clean exponential backoff with no jitter", () => {
    const found = findRequestDuplication([
      req({ timestamp: 0, responseStatus: 429 }),
      req({ timestamp: 1_000, responseStatus: 429 }),
      req({ timestamp: 3_000, responseStatus: 429 }),
      req({ timestamp: 7_000, responseStatus: 429 }),
    ]);
    expect(ids(found)).toContain("retry.jitter-missing");
  });

  it("does not flag retries whose spacing is already jittered", () => {
    const found = findRequestDuplication([
      req({ timestamp: 0, responseStatus: 503 }),
      req({ timestamp: 900, responseStatus: 503 }),
      req({ timestamp: 2_600, responseStatus: 503 }),
      req({ timestamp: 3_050, responseStatus: 200 }),
    ]);
    expect(ids(found)).not.toContain("retry.jitter-missing");
  });

  it("flags a del-less retry loop as high severity", () => {
    const found = findRequestDuplication([
      req({ timestamp: 0, responseStatus: 500 }),
      req({ timestamp: 30, responseStatus: 500 }),
      req({ timestamp: 60, responseStatus: 500 }),
      req({ timestamp: 90, responseStatus: 500 }),
    ]);
    expect(ids(found)).toContain("retry.no-delay");
    expect(found.find((f) => f.ruleId === "retry.no-delay")?.severity).toBe(
      "high",
    );
  });

  it("needs retry evidence — success responses on a fixed cadence are not retries", () => {
    const found = findRequestDuplication([
      req({ timestamp: 0, responseStatus: 200 }),
      req({ timestamp: 30_000, responseStatus: 200 }),
      req({ timestamp: 60_000, responseStatus: 200 }),
    ]);
    expect(ids(found)).not.toContain("retry.jitter-missing");
  });

  it("treats missing responses (network failures) as retry evidence", () => {
    const found = findRequestDuplication([
      req({ timestamp: 0 }),
      req({ timestamp: 2_000 }),
      req({ timestamp: 4_000 }),
      req({ timestamp: 6_000 }),
    ]);
    expect(ids(found)).toContain("retry.jitter-missing");
  });
});
