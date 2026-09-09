// src/domain/rules/site/request-hygiene-rules.ts
// Deterministic checks over the shape of requests the current page makes:
// secrets in URLs, PII in query strings, credentials sent over cleartext.
import type { Rule } from "../../models.js";
import { defineRule, finding } from "../../rule-factory.js";
import { parseUrlSafe } from "../../web-utils.js";
import { requestHeader } from "./site-utils.js";

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;
const BASIC_AUTH_IN_URL = /\/\/[^/\s:@]+:[^/\s:@]+@/;
const SESSION_PARAM =
  /[?&/;](sid|sessionid|session_id|phpsessid|jsessionid|access_token|auth_token|id_token|refresh_token)[=/]/i;
const PII_PARAM =
  /[?&](email|e[_-]?mail|ssn|phone|msisdn|dob|birthdate|passport|creditcard|card_number|cvv)=[^&\s]/i;

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function requestHygieneRules(): Rule[] {
  return [
    defineRule(
      "req.jwt-in-url",
      "high",
      "A JWT is passed in the request URL",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        if (JWT.test(decoded(request.url))) {
          return [
            finding(
              rule,
              "JWT found in URL (logged by proxies / history)",
              request.url.split("?")[0],
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "req.basic-auth-in-url",
      "critical",
      "Credentials are embedded in the request URL",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        if (BASIC_AUTH_IN_URL.test(request.url)) {
          return [
            finding(
              rule,
              "user:password@host credentials in URL",
              request.url.replace(/\/\/[^@]+@/, "//***:***@"),
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "req.session-token-in-url",
      "medium",
      "A session or OAuth token is passed as a URL parameter",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        if (SESSION_PARAM.test(decoded(request.url))) {
          return [
            finding(
              rule,
              "Session / OAuth token in URL parameter",
              request.url.split("?")[0],
            ),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "req.pii-in-query",
      "medium",
      "Personal data is sent in the query string",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const match = PII_PARAM.exec(decoded(request.url));
        if (!match) return [];

        return [
          finding(
            rule,
            `Query parameter "${match[1]}" carries personal data`,
            request.url.split("?")[0],
          ),
        ];
      },
    ),

    defineRule(
      "req.authorization-over-http",
      "high",
      "An Authorization header is sent over cleartext HTTP",
      (context, rule) => {
        const request = context.request;
        if (!request) return [];

        const url = parseUrlSafe(request.url);
        if (url?.protocol !== "http:") return [];
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          return [];
        }

        if (requestHeader(request, "authorization") === undefined) return [];

        return [
          finding(
            rule,
            "Authorization header sent to an http:// endpoint",
            request.url,
          ),
        ];
      },
    ),
  ];
}
