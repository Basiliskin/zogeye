// src/domain/rules/site/header-rules.ts
// Deterministic checks over HTTP response headers and Set-Cookie of the
// current page (its main document, captured via chrome.webRequest) and of
// the XHR/fetch responses it makes.
import type { Rule } from "../../models.js";
import { defineRule, finding } from "../../rule-factory.js";
import {
  cspDirective,
  hasResponse,
  isDocumentRequest,
  isHttpsRequest,
  looksLikeSessionCookie,
  maxAgeSeconds,
  parseSetCookie,
  requestHeader,
  responseHeader,
} from "./site-utils.js";

const SIX_MONTHS_SECONDS = 15_552_000;

const SERVER_VERSION = /\d+\.\d+/;

export function headerRules(): Rule[] {
  return [
    defineRule(
      "header.missing-hsts",
      "high",
      "HTTPS pages must send Strict-Transport-Security",
      (context, rule) => {
        const request = context.request;
        if (
          !request ||
          !isDocumentRequest(request) ||
          !isHttpsRequest(request)
        ) {
          return [];
        }

        if (responseHeader(request, "strict-transport-security")) return [];

        return [
          finding(
            rule,
            "No Strict-Transport-Security header on document response",
            request.url,
          ),
        ];
      },
    ),

    defineRule(
      "header.weak-hsts",
      "low",
      "Strict-Transport-Security max-age is short",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const value = responseHeader(request, "strict-transport-security");
        if (!value) return [];

        const seconds = maxAgeSeconds(value);
        if (seconds === undefined || seconds >= SIX_MONTHS_SECONDS) return [];

        return [
          finding(rule, `HSTS max-age is ${seconds}s (< 180 days)`, value),
        ];
      },
    ),

    defineRule(
      "header.missing-csp",
      "medium",
      "Document response has no Content-Security-Policy",
      (context, rule) => {
        const request = context.request;
        if (!request || !isDocumentRequest(request)) return [];

        if (
          responseHeader(request, "content-security-policy") ||
          responseHeader(request, "content-security-policy-report-only")
        ) {
          return [];
        }

        return [
          finding(rule, "No Content-Security-Policy header", request.url),
        ];
      },
    ),

    defineRule(
      "header.csp-unsafe-directives",
      "medium",
      "Content-Security-Policy allows unsafe-inline / unsafe-eval",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const policy = responseHeader(request, "content-security-policy");
        if (!policy) return [];

        const scriptSrc =
          cspDirective(policy, "script-src") ??
          cspDirective(policy, "default-src");
        if (scriptSrc === undefined) return [];

        const unsafe = ["'unsafe-inline'", "'unsafe-eval'"].filter((token) =>
          scriptSrc.includes(token),
        );
        if (!unsafe.length) return [];

        return [
          finding(
            rule,
            `script-src allows ${unsafe.join(" and ")}`,
            scriptSrc.slice(0, 160),
          ),
        ];
      },
    ),

    defineRule(
      "header.missing-nosniff",
      "low",
      "Response is missing X-Content-Type-Options: nosniff",
      (context, rule) => {
        const request = context.request;
        if (!request || !hasResponse(request)) return [];

        const contentType = (
          responseHeader(request, "content-type") ?? ""
        ).toLowerCase();
        const sniffable =
          isDocumentRequest(request) ||
          contentType.includes("text/html") ||
          contentType.includes("application/javascript") ||
          contentType.includes("text/javascript");
        if (!sniffable) return [];

        const value = responseHeader(request, "x-content-type-options");
        if (value?.toLowerCase().includes("nosniff")) return [];

        return [
          finding(rule, "No X-Content-Type-Options: nosniff", request.url),
        ];
      },
    ),

    defineRule(
      "header.missing-frame-protection",
      "medium",
      "Document can be framed (no X-Frame-Options / frame-ancestors)",
      (context, rule) => {
        const request = context.request;
        if (!request || !isDocumentRequest(request)) return [];

        if (responseHeader(request, "x-frame-options")) return [];

        const policy = responseHeader(request, "content-security-policy");
        if (policy && cspDirective(policy, "frame-ancestors") !== undefined) {
          return [];
        }

        return [
          finding(
            rule,
            "No clickjacking protection on document response",
            request.url,
          ),
        ];
      },
    ),

    defineRule(
      "header.server-version-disclosure",
      "low",
      "Response headers disclose server / framework versions",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const disclosures: string[] = [];

        const server = responseHeader(request, "server");
        if (server && SERVER_VERSION.test(server)) {
          disclosures.push(`server: ${server}`);
        }

        for (const name of [
          "x-powered-by",
          "x-aspnet-version",
          "x-aspnetmvc-version",
          "x-generator",
          "x-runtime",
        ]) {
          const value = responseHeader(request, name);
          if (value) disclosures.push(`${name}: ${value}`);
        }

        if (!disclosures.length) return [];

        return [
          finding(rule, disclosures.join(", ").slice(0, 200), request.url),
        ];
      },
    ),

    defineRule(
      "header.sensitive-response-cacheable",
      "medium",
      "Authenticated response is not marked no-store",
      (context, rule) => {
        const request = context.request;
        if (!request || !hasResponse(request)) return [];

        const authenticated =
          requestHeader(request, "authorization") !== undefined ||
          responseHeader(request, "set-cookie") !== undefined;
        if (!authenticated) return [];

        const cacheControl = (
          responseHeader(request, "cache-control") ?? ""
        ).toLowerCase();
        if (
          cacheControl.includes("no-store") ||
          cacheControl.includes("private")
        ) {
          return [];
        }

        return [
          finding(
            rule,
            "Authenticated response lacks Cache-Control: no-store / private",
            request.url,
          ),
        ];
      },
    ),

    defineRule(
      "header.cors-null-origin-with-credentials",
      "critical",
      "CORS allows the null origin with credentials",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const origin = responseHeader(request, "access-control-allow-origin");
        const credentials = responseHeader(
          request,
          "access-control-allow-credentials",
        );

        if (
          origin?.toLowerCase() === "null" &&
          credentials?.toLowerCase() === "true"
        ) {
          return [
            finding(
              rule,
              "Access-Control-Allow-Origin: null with credentials",
              request.url,
            ),
          ];
        }

        return [];
      },
    ),

    ...cookieRules(),
  ];
}

function cookieRules(): Rule[] {
  return [
    defineRule(
      "cookie.missing-secure",
      "high",
      "Set-Cookie is missing the Secure attribute",
      (context, rule) => {
        const request = context.request;
        if (!request || !isHttpsRequest(request)) return [];

        const raw = responseHeader(request, "set-cookie");
        if (!raw) return [];

        const insecure = parseSetCookie(raw).filter(
          (cookie) => cookie.name && !cookie.attributes.has("secure"),
        );
        if (!insecure.length) return [];

        return [
          finding(
            rule,
            `Cookie(s) set without Secure: ${insecure.map((c) => c.name).join(", ")}`,
            request.url,
          ),
        ];
      },
    ),

    defineRule(
      "cookie.samesite-none-without-secure",
      "high",
      "SameSite=None cookie is not marked Secure",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const raw = responseHeader(request, "set-cookie");
        if (!raw) return [];

        const offenders = parseSetCookie(raw).filter(
          (cookie) =>
            cookie.sameSite === "none" && !cookie.attributes.has("secure"),
        );
        if (!offenders.length) return [];

        return [
          finding(
            rule,
            `SameSite=None without Secure: ${offenders.map((c) => c.name).join(", ")}`,
            request.url,
          ),
        ];
      },
    ),

    defineRule(
      "cookie.missing-samesite",
      "low",
      "Set-Cookie has no SameSite attribute",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const raw = responseHeader(request, "set-cookie");
        if (!raw) return [];

        const offenders = parseSetCookie(raw).filter(
          (cookie) => cookie.name && cookie.sameSite === undefined,
        );
        if (!offenders.length) return [];

        return [
          finding(
            rule,
            `Cookie(s) without SameSite: ${offenders.map((c) => c.name).join(", ")}`,
            request.url,
          ),
        ];
      },
    ),

    defineRule(
      "cookie.session-without-httponly",
      "high",
      "Session cookie is readable from JavaScript (no HttpOnly)",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const raw = responseHeader(request, "set-cookie");
        if (!raw) return [];

        const offenders = parseSetCookie(raw).filter(
          (cookie) =>
            looksLikeSessionCookie(cookie.name) &&
            !cookie.attributes.has("httponly"),
        );
        if (!offenders.length) return [];

        return [
          finding(
            rule,
            `Session-like cookie without HttpOnly: ${offenders.map((c) => c.name).join(", ")}`,
            request.url,
          ),
        ];
      },
    ),
  ];
}
