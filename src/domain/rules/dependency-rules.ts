// src/domain/rules/dependency-rules.ts
import type { Rule, Severity } from "../models.js";
import { defineRule, finding } from "../rule-factory.js";

interface DependencyCheck {
  name: string;
  severity: Severity;
  kind: "deprecated" | "version";
  below?: string;
  reason: string;
}

const checks: DependencyCheck[] = [
  {
    name: "moment",
    severity: "medium",
    kind: "deprecated",
    reason:
      "Moment is in maintenance mode; prefer Intl, Temporal, date-fns, or Day.js.",
  },
  {
    name: "request",
    severity: "high",
    kind: "deprecated",
    reason:
      "The request package is deprecated; use fetch or a maintained HTTP client.",
  },
  {
    name: "axios",
    severity: "high",
    kind: "version",
    below: "0.21.4",
    reason: "Axios below 0.21.4 misses known security fixes.",
  },
  {
    name: "lodash",
    severity: "high",
    kind: "version",
    below: "4.17.21",
    reason: "Lodash below 4.17.21 misses prototype pollution fixes.",
  },
  {
    name: "jquery",
    severity: "medium",
    kind: "version",
    below: "3.5.0",
    reason: "jQuery below 3.5.0 misses XSS-related fixes.",
  },
  {
    name: "angular",
    severity: "high",
    kind: "deprecated",
    reason: "AngularJS 1.x is end-of-life; migrate to a supported framework.",
  },
  {
    name: "subscriptions-transport-ws",
    severity: "medium",
    kind: "deprecated",
    reason:
      "subscriptions-transport-ws is deprecated; use graphql-ws for GraphQL subscriptions over WebSocket.",
  },
];

function parseVersion(range: string): string | null {
  const match = range.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function isBelow(version: string, target: string): boolean {
  const left = version.split(".").map(Number);
  const right = target.split(".").map(Number);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart < rightPart;
    }
  }

  return false;
}

export function dependencyRules(): Rule[] {
  return checks.map((check) =>
    defineRule(
      `dep.${check.name}`,
      check.severity,
      `Dependency check: ${check.name}`,
      (context, rule) => {
        const dependency = context.dependency;
        if (!dependency || dependency.name.toLowerCase() !== check.name) {
          return [];
        }

        if (check.kind === "deprecated") {
          return [
            finding(
              rule,
              `${dependency.name}@${dependency.range} is flagged: ${check.reason}`,
              dependency.source,
            ),
          ];
        }

        const version = parseVersion(dependency.range);
        if (version && check.below && isBelow(version, check.below)) {
          return [
            finding(
              rule,
              `${dependency.name}@${dependency.range} is below ${check.below}: ${check.reason}`,
              dependency.source,
            ),
          ];
        }

        return [];
      },
    ),
  );
}
