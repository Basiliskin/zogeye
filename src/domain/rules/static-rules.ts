// src/domain/rules/static-rules.ts
import type { Rule, Severity } from "../models.js";
import { defineRule, finding } from "../rule-factory.js";

function evidenceFor(content: string, regex: RegExp): string | undefined {
  const match = content.match(regex);
  return match ? match[0].slice(0, 160) : undefined;
}

function fileDetails(path: string, message: string): string {
  return `${path}: ${message}`;
}

function patternRule(
  id: string,
  severity: Severity,
  title: string,
  regex: RegExp,
  message: string,
): Rule {
  return defineRule(id, severity, title, (context, rule) => {
    const file = context.file;
    if (!file) return [];

    const evidence = evidenceFor(file.content, regex);
    if (!evidence) return [];

    return [finding(rule, fileDetails(file.path, message), evidence)];
  });
}

export function staticRules(): Rule[] {
  return [
    patternRule(
      "static.no-eval",
      "high",
      "Do not use eval",
      /\beval\s*\(/,
      "eval() usage detected",
    ),

    patternRule(
      "static.no-document-write",
      "medium",
      "Do not use document.write",
      /\bdocument\.write\s*\(/,
      "document.write usage detected",
    ),

    patternRule(
      "static.no-inner-html",
      "high",
      "Avoid assigning innerHTML",
      /\.innerHTML\s*=/,
      "innerHTML assignment detected",
    ),

    patternRule(
      "static.no-http-endpoints",
      "medium",
      "Use HTTPS endpoints",
      /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
      "HTTP endpoint detected",
    ),

    patternRule(
      "static.no-hardcoded-secret",
      "critical",
      "Do not hardcode secrets",
      /(api[_-]?key|secret|password|token|authorization)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-+.\/=]{12,}['"]/i,
      "Possible hardcoded secret detected",
    ),

    patternRule(
      "static.no-wildcard-postmessage",
      "high",
      "postMessage must not use wildcard target origin",
      /\.postMessage\s*\([^,]+,\s*['"]\*['"]/,
      "postMessage with wildcard origin detected",
    ),

    patternRule(
      "static.no-localstorage-auth",
      "high",
      "Do not store auth tokens in localStorage",
      /localStorage\.set(?:Item)?\s*\(\s*['"](token|access_token|auth_token|jwt|authorization)['"]/i,
      "Auth token stored in localStorage detected",
    ),

    patternRule(
      "static.known-outdated-library-reference",
      "medium",
      "Known outdated library reference",
      /(from\s+['"]moment['"]|require\s*\(\s*['"]moment['"]\)|from\s+['"]request['"]|require\s*\(\s*['"]request['"]\))/i,
      "Known outdated library reference detected",
    ),
  ];
}
