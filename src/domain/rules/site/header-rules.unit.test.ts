import { describe, expect, it } from "vitest";
import { headerRules } from "./header-rules.js";
import type { AnalysisContext, Finding, RequestFact } from "../../models.js";

const req = (partial: Partial<RequestFact>): RequestFact => ({
  url: "https://example.com/",
  method: "GET",
  timestamp: 0,
  ...partial,
});

function run(context: AnalysisContext): Finding[] {
  return headerRules().flatMap((rule) => rule.evaluate(context));
}

const ids = (findings: Finding[]): string[] => findings.map((f) => f.ruleId);

describe("headerRules", () => {
  it("flags a document response missing HSTS, CSP and frame protection", () => {
    const found = ids(
      run({ request: req({ source: "document", responseHeaders: {} }) }),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "header.missing-hsts",
        "header.missing-csp",
        "header.missing-frame-protection",
        "header.missing-nosniff",
      ]),
    );
  });

  it("stays silent when the document is fully hardened", () => {
    const found = run({
      request: req({
        source: "document",
        responseHeaders: {
          "strict-transport-security": "max-age=63072000",
          "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        },
      }),
    });
    expect(found).toHaveLength(0);
  });

  it("detects unsafe-inline in CSP script-src", () => {
    const found = ids(
      run({
        request: req({
          responseHeaders: {
            "content-security-policy": "script-src 'self' 'unsafe-inline'",
          },
        }),
      }),
    );
    expect(found).toContain("header.csp-unsafe-directives");
  });

  it("flags insecure and SameSite=None cookies", () => {
    const found = ids(
      run({
        request: req({
          responseHeaders: {
            "set-cookie": "sid=x; SameSite=None\nprefs=y",
          },
        }),
      }),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "cookie.missing-secure",
        "cookie.samesite-none-without-secure",
        "cookie.missing-samesite",
        "cookie.session-without-httponly",
      ]),
    );
  });

  it("flags server version disclosure and null-origin CORS", () => {
    const found = ids(
      run({
        request: req({
          responseHeaders: {
            server: "nginx/1.25.3",
            "x-powered-by": "Express",
            "access-control-allow-origin": "null",
            "access-control-allow-credentials": "true",
          },
        }),
      }),
    );
    expect(found).toContain("header.server-version-disclosure");
    expect(found).toContain("header.cors-null-origin-with-credentials");
  });
});
