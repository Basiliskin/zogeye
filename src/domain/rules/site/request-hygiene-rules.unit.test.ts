import { describe, expect, it } from "vitest";
import { requestHygieneRules } from "./request-hygiene-rules.js";
import type { Finding, RequestFact } from "../../models.js";

const req = (partial: Partial<RequestFact>): RequestFact => ({
  url: "https://example.com/",
  method: "GET",
  timestamp: 0,
  ...partial,
});

const run = (request: RequestFact): string[] =>
  requestHygieneRules()
    .flatMap((rule) => rule.evaluate({ request }))
    .map((f: Finding) => f.ruleId);

describe("requestHygieneRules", () => {
  it("detects a JWT in the URL", () => {
    expect(
      run(
        req({
          url: "https://api.example.com/x?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcd",
        }),
      ),
    ).toContain("req.jwt-in-url");
  });

  it("detects basic-auth credentials in the URL", () => {
    expect(run(req({ url: "https://user:s3cret@api.example.com/x" }))).toContain(
      "req.basic-auth-in-url",
    );
  });

  it("detects session tokens and PII in query params", () => {
    const found = run(
      req({ url: "https://api.example.com/x?jsessionid=abc&email=a@b.com" }),
    );
    expect(found).toContain("req.session-token-in-url");
    expect(found).toContain("req.pii-in-query");
  });

  it("flags an Authorization header sent over http", () => {
    expect(
      run(
        req({
          url: "http://api.example.com/x",
          requestHeaders: { authorization: "Bearer abc" },
        }),
      ),
    ).toContain("req.authorization-over-http");
  });

  it("is quiet for a clean HTTPS request", () => {
    expect(run(req({ url: "https://api.example.com/users/42" }))).toHaveLength(0);
  });
});
