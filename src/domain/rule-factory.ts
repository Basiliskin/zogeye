// src/domain/rule-factory.ts
import type { AnalysisContext, Finding, Rule, Severity } from "./models.js";

export function defineRule(
  id: string,
  severity: Severity,
  title: string,
  evaluate: (context: AnalysisContext, rule: Rule) => Finding[],
): Rule {
  const rule: Rule = {
    id,
    severity,
    title,
    evaluate: (context) => evaluate(context, rule),
  };

  return rule;
}

export function finding(
  rule: Rule,
  details: string,
  evidence?: string,
): Finding {
  const result: Finding = {
    ruleId: rule.id,
    severity: rule.severity,
    title: rule.title,
    details,
  };

  if (evidence !== undefined) {
    result.evidence = evidence;
  }

  return result;
}

export function evidenceFor(
  content: string,
  regex: RegExp,
): string | undefined {
  const match = content.match(regex);
  return match ? match[0].slice(0, 160) : undefined;
}

export function filePatternRule(
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

    return [finding(rule, `${file.path}: ${message}`, evidence)];
  });
}
