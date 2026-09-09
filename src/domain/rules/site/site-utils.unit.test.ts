import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SOURCE,
  cspDirective,
  hasResponse,
  isCrossHost,
  isDocumentRequest,
  isHttpsRequest,
  looksLikeSessionCookie,
  maxAgeSeconds,
  parseSetCookie,
  requestHeader,
  responseHeader,
} from "./site-utils.js";
import type { RequestFact } from "../../models.js";

const req = (partial: Partial<RequestFact>): RequestFact => ({
  url: "https://example.com/",
  method: "GET",
  timestamp: 0,
  ...partial,
});

describe("site-utils", () => {
  it("isDocumentRequest / isHttpsRequest classify by source and scheme", () => {
    expect(isDocumentRequest(req({ source: "document" }))).toBe(true);
    expect(isDocumentRequest(req({ source: "fetch" }))).toBe(false);
    expect(isHttpsRequest(req({ url: "https://a.test/" }))).toBe(true);
    expect(isHttpsRequest(req({ url: "http://a.test/" }))).toBe(false);
  });

  it("responseHeader / requestHeader are case-insensitive", () => {
    const r = req({
      responseHeaders: { "x-frame-options": "DENY" },
      requestHeaders: { authorization: "Bearer x" },
    });
    expect(responseHeader(r, "X-Frame-Options")).toBe("DENY");
    expect(requestHeader(r, "Authorization")).toBe("Bearer x");
  });

  it("hasResponse and DOCUMENT_SOURCE", () => {
    expect(DOCUMENT_SOURCE).toBe("document");
    expect(hasResponse(req({ responseStatus: 200 }))).toBe(true);
    expect(hasResponse(req({}))).toBe(false);
  });

  it("cspDirective reads a directive value and falls through", () => {
    const policy = "default-src 'self'; script-src 'self' 'unsafe-inline'";
    expect(cspDirective(policy, "script-src")).toContain("'unsafe-inline'");
    expect(cspDirective(policy, "frame-ancestors")).toBeUndefined();
  });

  it("maxAgeSeconds parses HSTS max-age", () => {
    expect(maxAgeSeconds("max-age=31536000; includeSubDomains")).toBe(31536000);
    expect(maxAgeSeconds("includeSubDomains")).toBeUndefined();
  });

  it("parseSetCookie splits newline-joined cookies and flags", () => {
    const cookies = parseSetCookie(
      "sid=abc; Path=/; HttpOnly\nprefs=x; SameSite=None",
    );
    expect(cookies).toHaveLength(2);
    expect(cookies[0]?.name).toBe("sid");
    expect(cookies[0]?.attributes.has("httponly")).toBe(true);
    expect(cookies[1]?.sameSite).toBe("none");
  });

  it("looksLikeSessionCookie / isCrossHost", () => {
    expect(looksLikeSessionCookie("JSESSIONID")).toBe(true);
    expect(looksLikeSessionCookie("theme")).toBe(false);
    expect(isCrossHost("https://a.test/x", "https://cdn.other/y")).toBe(true);
    expect(isCrossHost("https://a.test/x", "https://a.test/z")).toBe(false);
  });
});
