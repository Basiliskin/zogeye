import { describe, expect, it } from "vitest";
import { domRules } from "./dom-rules.js";
import type { Finding, PageFact } from "../../models.js";

const page = (partial: Partial<PageFact>): PageFact => ({
  url: "https://example.com/",
  scheme: "https:",
  insecurePasswordForm: false,
  mixedContent: [],
  scriptsWithoutSri: [],
  stylesheetsWithoutSri: [],
  iframesWithoutSandbox: [],
  blankLinksWithoutNoopener: [],
  inlineEventHandlerSamples: [],
  javascriptUriSamples: [],
  autocompleteOnSensitiveFields: [],
  ...partial,
});

const run = (fact: PageFact): string[] =>
  domRules()
    .flatMap((rule) => rule.evaluate({ page: fact }))
    .map((f: Finding) => f.ruleId);

describe("domRules", () => {
  it("is silent for a clean page fact", () => {
    expect(run(page({}))).toHaveLength(0);
  });

  it("flags insecure password form and mixed content", () => {
    const found = run(
      page({
        insecurePasswordForm: true,
        mixedContent: ["http://cdn.example.com/a.js"],
      }),
    );
    expect(found).toContain("dom.insecure-password-form");
    expect(found).toContain("dom.mixed-content");
  });

  it("flags missing SRI, unsandboxed iframes and javascript: URIs", () => {
    const found = run(
      page({
        scriptsWithoutSri: ["https://cdn.other/x.js"],
        iframesWithoutSandbox: ["https://ads.other/frame"],
        javascriptUriSamples: ["javascript:void(0)"],
      }),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "dom.script-without-sri",
        "dom.iframe-without-sandbox",
        "dom.javascript-uri",
      ]),
    );
  });

  it("flags an unsafe referrer policy", () => {
    expect(run(page({ metaReferrer: "unsafe-url" }))).toContain(
      "dom.unsafe-referrer-policy",
    );
    expect(run(page({ metaReferrer: "no-referrer" }))).not.toContain(
      "dom.unsafe-referrer-policy",
    );
  });
});
