// src/domain/rules/graphql-rules.ts
import type { RequestFact, Rule } from "../models.js";
import { defineRule, finding, filePatternRule } from "../rule-factory.js";
import { headerValue, isInsecureHttpUrl, parseUrlSafe } from "../web-utils.js";

const GRAPHQL_PATH = /graphql/i;
const GRAPHQL_BODY =
  /("(query|mutation|operationName|variables)"\s*:|\b(query|mutation|subscription)\s*[({])/i;
const GRAPHQL_INTROSPECTION = /__schema|introspection/i;

function decodedUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isGraphqlRequest(request: RequestFact): boolean {
  const url = parseUrlSafe(request.url);

  if (url && GRAPHQL_PATH.test(url.pathname)) {
    return true;
  }

  const contentType = headerValue(request.requestHeaders, "content-type") ?? "";

  if (contentType.includes("application/graphql")) {
    return true;
  }

  if (request.body && GRAPHQL_BODY.test(request.body)) {
    return true;
  }

  if (GRAPHQL_BODY.test(request.url)) {
    return true;
  }

  return false;
}

export function graphQlRules(): Rule[] {
  return [
    defineRule(
      "graphql.use-secure-http",
      "high",
      "GraphQL HTTP endpoint should use HTTPS",
      (context, rule) => {
        const request = context.request;
        if (!request || !isGraphqlRequest(request)) return [];

        const url = parseUrlSafe(request.url);

        if (url && isInsecureHttpUrl(url)) {
          return [finding(rule, "GraphQL endpoint used HTTP", request.url)];
        }

        return [];
      },
    ),

    defineRule(
      "graphql.no-query-in-get-url",
      "medium",
      "Avoid passing GraphQL queries in GET URLs",
      (context, rule) => {
        const request = context.request;
        if (!request || !isGraphqlRequest(request)) return [];
        if (request.method.toUpperCase() !== "GET") return [];

        if (/[?&]query=/i.test(decodedUrl(request.url))) {
          return [
            finding(
              rule,
              "GraphQL query passed via GET URL",
              request.url.split("?")[0],
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "graphql.no-mutation-via-get",
      "high",
      "Do not send GraphQL mutations via GET",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];
        if (request.method.toUpperCase() !== "GET") return [];

        const urlText = decodedUrl(request.url);

        if (/[?&]query=[^&]*mutation/i.test(urlText)) {
          return [
            finding(
              rule,
              "GraphQL mutation passed via GET URL",
              request.url.split("?")[0],
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "graphql.no-introspection-in-requests",
      "medium",
      "GraphQL introspection should be disabled in production",
      (context, rule) => {
        const request = context.request;
        if (!request || !isGraphqlRequest(request)) return [];

        const urlText = decodedUrl(request.url);
        const bodyText = request.body ?? "";

        if (
          GRAPHQL_INTROSPECTION.test(urlText) ||
          GRAPHQL_INTROSPECTION.test(bodyText)
        ) {
          return [
            finding(
              rule,
              "GraphQL introspection usage detected",
              request.url.split("?")[0],
            ),
          ];
        }

        return [];
      },
    ),
  ];
}

export function graphQlStaticRules(): Rule[] {
  return [
    filePatternRule(
      "static.graphql-http-endpoint",
      "medium",
      "GraphQL endpoint should use HTTPS",
      /["'`]http:\/\/[^"'`]*graphql/i,
      "HTTP GraphQL endpoint detected",
    ),

    filePatternRule(
      "static.graphql-introspection",
      "medium",
      "GraphQL introspection detected",
      /__schema|introspectionQuery/i,
      "GraphQL introspection detected",
    ),

    filePatternRule(
      "static.graphql-deprecated-subscription-transport",
      "medium",
      "Avoid deprecated subscriptions-transport-ws",
      /subscriptions-transport-ws/i,
      "subscriptions-transport-ws reference detected",
    ),
  ];
}
