// src/domain/rules/site/dom-rules.ts
// Deterministic checks over a DOM snapshot (PageFact) of the current page.
import type { PageFact, Rule } from "../../models.js";
import { defineRule, finding } from "../../rule-factory.js";

const UNSAFE_REFERRER = /unsafe-url|no-referrer-when-downgrade|^$/i;

function list(page: PageFact, key: keyof PageFact): string[] {
  const value = page[key];
  return Array.isArray(value) ? value : [];
}

function sample(values: string[]): string {
  return values.slice(0, 5).join("\n");
}

export function domRules(): Rule[] {
  return [
    defineRule(
      "dom.insecure-password-form",
      "critical",
      "Password field on an insecure page or form",
      (context, rule) => {
        const page = context.page;
        if (!page?.insecurePasswordForm) return [];

        return [
          finding(
            rule,
            "A password input is served over HTTP or submits to an insecure/cross-origin action",
            page.url,
          ),
        ];
      },
    ),

    defineRule(
      "dom.mixed-content",
      "high",
      "HTTPS page loads resources over HTTP",
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "mixedContent");
        if (!items.length) return [];

        return [finding(rule, `${items.length} mixed-content resource(s)`, sample(items))];
      },
    ),

    defineRule(
      "dom.script-without-sri",
      "medium",
      "Cross-origin script has no Subresource Integrity hash",
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "scriptsWithoutSri");
        if (!items.length) return [];

        return [
          finding(rule, `${items.length} external script(s) without integrity=`, sample(items)),
        ];
      },
    ),

    defineRule(
      "dom.stylesheet-without-sri",
      "low",
      "Cross-origin stylesheet has no Subresource Integrity hash",
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "stylesheetsWithoutSri");
        if (!items.length) return [];

        return [
          finding(rule, `${items.length} external stylesheet(s) without integrity=`, sample(items)),
        ];
      },
    ),

    defineRule(
      "dom.iframe-without-sandbox",
      "low",
      "Cross-origin iframe has no sandbox attribute",
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "iframesWithoutSandbox");
        if (!items.length) return [];

        return [finding(rule, `${items.length} unsandboxed cross-origin iframe(s)`, sample(items))];
      },
    ),

    defineRule(
      "dom.target-blank-without-noopener",
      "low",
      'Link uses target="_blank" without rel="noopener"',
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "blankLinksWithoutNoopener");
        if (!items.length) return [];

        return [
          finding(rule, `${items.length} target="_blank" link(s) missing rel=noopener`, sample(items)),
        ];
      },
    ),

    defineRule(
      "dom.inline-event-handler",
      "low",
      "Inline event handler attributes are present",
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "inlineEventHandlerSamples");
        if (!items.length) return [];

        return [
          finding(rule, `Inline on* handlers weaken CSP (${items.length}+ found)`, sample(items)),
        ];
      },
    ),

    defineRule(
      "dom.javascript-uri",
      "medium",
      'javascript: URI used in an href / src',
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "javascriptUriSamples");
        if (!items.length) return [];

        return [finding(rule, `${items.length} javascript: URI(s)`, sample(items))];
      },
    ),

    defineRule(
      "dom.sensitive-field-autocomplete",
      "info",
      "Password / payment field allows autocomplete",
      (context, rule) => {
        const page = context.page;
        if (!page) return [];

        const items = list(page, "autocompleteOnSensitiveFields");
        if (!items.length) return [];

        return [
          finding(rule, `${items.length} sensitive field(s) without autocomplete="off"`, sample(items)),
        ];
      },
    ),

    defineRule(
      "dom.unsafe-referrer-policy",
      "low",
      "Referrer policy leaks full URLs cross-origin",
      (context, rule) => {
        const page = context.page;
        if (page?.metaReferrer === undefined) return [];

        if (!UNSAFE_REFERRER.test(page.metaReferrer.trim())) return [];

        return [
          finding(rule, `<meta name="referrer"> is "${page.metaReferrer}"`, page.url),
        ];
      },
    ),
  ];
}
