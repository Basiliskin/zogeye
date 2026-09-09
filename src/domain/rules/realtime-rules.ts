// src/domain/rules/realtime-rules.ts
import type { Rule } from "../models.js";
import { defineRule, finding, filePatternRule } from "../rule-factory.js";
import {
  isInsecureHttpUrl,
  isInsecureWsUrl,
  parseUrlSafe,
} from "../web-utils.js";

const REALTIME_SOURCES = new Set([
  "websocket",
  "websocket-send",
  "websocket-message",
  "eventsource",
  "sse-message",
]);

export function realtimeRules(): Rule[] {
  return [
    defineRule(
      "realtime.secure-transport",
      "high",
      "Realtime transports should use secure URLs",
      (context, rule) => {
        const request = context.request;
        if (!request || !REALTIME_SOURCES.has(request.source ?? "")) return [];

        const url = parseUrlSafe(request.url);
        if (!url) return [];

        if (isInsecureWsUrl(url)) {
          return [
            finding(rule, "Insecure WebSocket URL detected", request.url),
          ];
        }

        if (isInsecureHttpUrl(url)) {
          return [
            finding(rule, "Insecure SSE/EventSource URL detected", request.url),
          ];
        }

        return [];
      },
    ),

    defineRule(
      "realtime.no-insecure-graphql-subscription",
      "critical",
      "GraphQL subscriptions must not use insecure WebSocket URLs",
      (context, rule) => {
        const request = context.request;
        if (!request || !(request.source ?? "").startsWith("websocket"))
          return [];

        const url = parseUrlSafe(request.url);
        if (!url || !isInsecureWsUrl(url)) return [];

        if (/graphql/i.test(url.pathname + url.search)) {
          return [
            finding(
              rule,
              "Insecure GraphQL WebSocket endpoint detected",
              request.url,
            ),
          ];
        }

        return [];
      },
    ),
  ];
}

export function realtimeStaticRules(): Rule[] {
  return [
    filePatternRule(
      "static.use-wss-websocket",
      "high",
      "Use wss:// for WebSocket",
      /new\s+WebSocket\s*\(\s*["'`]ws:\/\//i,
      "Insecure WebSocket URL detected",
    ),

    filePatternRule(
      "static.use-https-eventsource",
      "medium",
      "Use HTTPS for EventSource",
      /new\s+EventSource\s*\(\s*["'`]http:\/\//i,
      "Insecure EventSource URL detected",
    ),

    filePatternRule(
      "static.websocket-usage",
      "info",
      "WebSocket usage detected",
      /new\s+WebSocket\s*\(/,
      "WebSocket usage detected",
    ),

    filePatternRule(
      "static.eventsource-usage",
      "info",
      "SSE usage detected",
      /new\s+EventSource\s*\(/,
      "EventSource usage detected",
    ),
  ];
}
