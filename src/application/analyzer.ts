// src/application/analyzer.ts
import type {
  AnalysisContext,
  Finding,
  Report,
  RuleProvider,
  Severity,
} from "../domain/models.js";

const weights: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 5,
  high: 20,
  critical: 50,
};

export class Analyzer {
  constructor(private readonly rules: RuleProvider) {}

  analyzeContexts(contexts: AnalysisContext[]): Finding[] {
    const findings: Finding[] = [];

    for (const context of contexts) {
      for (const rule of this.rules.all()) {
        findings.push(...rule.evaluate(context));
      }
    }

    return dedupe(findings);
  }

  createReport(findings: Finding[], facts: Report["facts"]): Report {
    const riskScore = findings.reduce(
      (sum, findingItem) => sum + weights[findingItem.severity],
      0,
    );

    return {
      generatedAt: Date.now(),
      riskScore,
      exposure: exposureFromScore(riskScore),
      findings,
      facts,
    };
  }
}

function exposureFromScore(score: number): Report["exposure"] {
  if (score <= 10) return "low";
  if (score <= 50) return "medium";
  if (score <= 150) return "high";
  return "critical";
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();

  return findings.filter((item) => {
    const key = [item.ruleId, item.details, item.evidence ?? ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
