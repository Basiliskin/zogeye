// src/domain/rules/network-rules.ts
import type { Rule } from "../models.js";
import { defineRule, finding } from "../rule-factory.js";
import { headerValue, isInsecureHttpUrl, parseUrlSafe } from "../web-utils.js";

function hasJsonLikeBody(body?: string): boolean {
  if (!body) return false;

  const value = body.trim();
  return value.startsWith("{") || value.startsWith("[");
}

export function networkRules(): Rule[] {
  return [
    defineRule(
      "net.https-only",
      "high",
      "API traffic should use HTTPS",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const url = parseUrlSafe(request.url);
        if (url && isInsecureHttpUrl(url)) {
          return [finding(rule, "HTTP endpoint detected", request.url)];
        }

        return [];
      },
    ),

    defineRule(
      "net.no-credentials-in-url",
      "critical",
      "Credentials must not be passed in URL",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const regex =
          /([?&])(api[_-]?key|token|access[_-]?token|password|secret|client[_-]?secret|authorization)=/i;

        if (regex.test(request.url)) {
          return [
            finding(
              rule,
              "Sensitive query parameter detected",
              request.url.split("?")[0],
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "net.no-mutation-via-get",
      "medium",
      "Mutations should not use GET",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const url = parseUrlSafe(request.url);

        if (
          url &&
          request.method.toUpperCase() === "GET" &&
          /(create|update|delete|remove|save|edit)/i.test(url.pathname)
        ) {
          return [
            finding(
              rule,
              "GET request appears to perform a mutation",
              request.url,
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "net.json-content-type-for-json-body",
      "low",
      "JSON body should declare application/json",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const method = request.method.toUpperCase();
        if (!["POST", "PUT", "PATCH"].includes(method)) return [];
        if (!hasJsonLikeBody(request.body)) return [];

        const contentType =
          headerValue(request.requestHeaders, "content-type") ?? "";

        if (!contentType.toLowerCase().includes("application/json")) {
          return [
            finding(
              rule,
              "JSON-like body sent without application/json content type",
              request.url,
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "net.no-wildcard-cors-with-credentials",
      "critical",
      "Wildcard CORS with credentials is unsafe",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const allowOrigin = headerValue(
          request.responseHeaders,
          "access-control-allow-origin",
        );
        const allowCredentials = headerValue(
          request.responseHeaders,
          "access-control-allow-credentials",
        );

        if (allowOrigin === "*" && allowCredentials?.toLowerCase() === "true") {
          return [
            finding(
              rule,
              "Response allows any origin with credentials",
              request.url,
            ),
          ];
        }

        return [];
      },
    ),
  ];
}
