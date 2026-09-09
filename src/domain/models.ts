// src/domain/models.ts
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  details: string;
  evidence?: string | undefined;
}

export interface RequestFact {
  url: string;
  method: string;
  requestHeaders?: Record<string, string> | undefined;
  responseStatus?: number | undefined;
  responseHeaders?: Record<string, string> | undefined;
  body?: string | undefined;
  source?: string | undefined;
  timestamp: number;
}

export interface FileFact {
  path: string;
  content: string;
}

export interface DependencyFact {
  name: string;
  range: string;
  source: string;
}

export interface AnalysisContext {
  request?: RequestFact | undefined;
  file?: FileFact | undefined;
  dependency?: DependencyFact | undefined;
}

export interface Rule {
  id: string;
  severity: Severity;
  title: string;
  evaluate: (context: AnalysisContext) => Finding[];
}

export interface RuleProvider {
  all(): Rule[];
}

export interface Report {
  generatedAt: number;
  riskScore: number;
  exposure: "low" | "medium" | "high" | "critical";
  findings: Finding[];
  facts: {
    requests: number;
    files: number;
    dependencies: number;
  };
}
