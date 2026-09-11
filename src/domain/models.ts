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
  responseBody?: string | undefined;
  body?: string | undefined;
  source?: string | undefined;
  timestamp: number;
  /** Wall-clock time from send to response, in milliseconds, when measured. */
  durationMs?: number | undefined;
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

/**
 * Deterministic snapshot of the current page's DOM, collected by the
 * page-scan content script. Every field is a plain, observable fact — no
 * heuristics that need network access to external resources.
 */
export interface PageFact {
  url: string;
  scheme: string;
  insecurePasswordForm: boolean;
  mixedContent: string[];
  scriptsWithoutSri: string[];
  stylesheetsWithoutSri: string[];
  iframesWithoutSandbox: string[];
  blankLinksWithoutNoopener: string[];
  inlineEventHandlerSamples: string[];
  javascriptUriSamples: string[];
  autocompleteOnSensitiveFields: string[];
  metaReferrer?: string | undefined;
}

export interface AnalysisContext {
  request?: RequestFact | undefined;
  file?: FileFact | undefined;
  dependency?: DependencyFact | undefined;
  page?: PageFact | undefined;
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
