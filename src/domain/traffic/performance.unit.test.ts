import { describe, expect, it } from "vitest";
import { findSlowRequests, isStaticResource } from "./performance.js";
import type { Finding, RequestFact } from "../models.js";

const req = (partial: Partial<RequestFact>): RequestFact => ({
  url: "https://api.example.com/v1/thing",
  method: "GET",
  timestamp: 0,
  ...partial,
});

const ids = (findings: Finding[]): string[] => findings.map((f) => f.ruleId);

describe("isStaticResource", () => {
  it("matches by extension and content-type", () => {
    expect(isStaticResource(req({ url: "https://x.test/app.js" }))).toBe(true);
    expect(isStaticResource(req({ url: "https://x.test/a.png?v=2" }))).toBe(true);
    expect(
      isStaticResource(
        req({ responseHeaders: { "content-type": "font/woff2" } }),
      ),
    ).toBe(true);
  });

  it("does not match API endpoints", () => {
    expect(
      isStaticResource(
        req({
          url: "https://api.test/users",
          responseHeaders: { "content-type": "application/json" },
        }),
      ),
    ).toBe(false);
  });
});

describe("findSlowRequests", () => {
  it("returns nothing without timing data", () => {
    expect(findSlowRequests([req({}), req({})])).toEqual([]);
  });

  it("excludes slow static assets", () => {
    const findings = findSlowRequests([
      req({ url: "https://x.test/huge.png", durationMs: 9000 }),
    ]);
    expect(findings).toEqual([]);
  });

  it("flags an absolute-slow API call by tier", () => {
    const findings = findSlowRequests([
      req({ url: "https://api.test/report", durationMs: 9000 }),
    ]);
    expect(findings[0]?.ruleId).toBe("perf.slow-request");
    expect(findings[0]?.severity).toBe("high");
  });

  it("flags a relative outlier against its peers", () => {
    const fast = Array.from({ length: 6 }, (_, i) =>
      req({ url: `https://api.test/list/${i}`, durationMs: 100 }),
    );
    const slow = req({ url: "https://api.test/slow", durationMs: 900 });

    const found = ids(findSlowRequests([...fast, slow]));
    expect(found).toContain("perf.slow-outlier");
  });

  it("lists the slowest calls as info when nothing crosses a threshold", () => {
    const requests = [
      req({ url: "https://api.test/a", durationMs: 210 }),
      req({ url: "https://api.test/b", durationMs: 180 }),
      req({ url: "https://api.test/c", durationMs: 120 }),
    ];
    const found = findSlowRequests(requests);
    expect(found).toHaveLength(1);
    expect(found[0]?.ruleId).toBe("perf.slowest");
    expect(found[0]?.severity).toBe("info");
  });

  it("is deterministic regardless of input order", () => {
    const a = req({ url: "https://api.test/a", durationMs: 5000 });
    const b = req({ url: "https://api.test/b", durationMs: 200 });
    expect(findSlowRequests([a, b])).toEqual(findSlowRequests([b, a]));
  });
});
