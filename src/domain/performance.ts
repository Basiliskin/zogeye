// src/domain/performance.ts
// Deterministic latency analysis over captured requests: which API / socket
// calls responded slowly, both in absolute terms and relative to their peers.
// Static assets (scripts, styles, images, fonts, media) are excluded so the
// signal is about application traffic, not page weight.
import type { Finding, RequestFact, Severity } from "./models.js";
import { parseUrlSafe } from "./web-utils.js";

const STATIC_EXTENSION =
  /\.(js|mjs|cjs|css|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|flac|wasm|map|pdf)$/i;

const STATIC_CONTENT_TYPE =
  /^(image\/|font\/|video\/|audio\/|text\/css|text\/javascript|application\/javascript|application\/font)/i;

const ABSOLUTE_TIERS: { min: number; severity: Severity }[] = [
  { min: 8000, severity: "high" },
  { min: 3000, severity: "medium" },
  { min: 1000, severity: "low" },
];

const OUTLIER_MIN_SAMPLES = 5;
const OUTLIER_MEDIAN_MULTIPLE = 3;
const OUTLIER_MIN_MS = 500;
const SLOWEST_COUNT = 3;
const SLOWEST_REPORT_MIN_MS = 200;

export function isStaticResource(request: RequestFact): boolean {
  const contentType = request.responseHeaders?.["content-type"] ?? "";
  if (STATIC_CONTENT_TYPE.test(contentType)) return true;

  const pathname = parseUrlSafe(request.url)?.pathname ?? request.url;
  return STATIC_EXTENSION.test(pathname);
}

function slowFinding(
  ruleId: string,
  severity: Severity,
  title: string,
  details: string,
  evidence: string,
): Finding {
  return { ruleId, severity, title, details, evidence };
}

function timedApiRequests(requests: RequestFact[]): RequestFact[] {
  return requests.filter(
    (request) =>
      typeof request.durationMs === "number" &&
      request.durationMs >= 0 &&
      !isStaticResource(request),
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function label(request: RequestFact): string {
  const url = parseUrlSafe(request.url);
  const shortUrl = url ? `${url.host}${url.pathname}` : request.url;
  return `${request.method} ${shortUrl}`;
}

function absoluteSeverity(durationMs: number): Severity | undefined {
  return ABSOLUTE_TIERS.find((tier) => durationMs >= tier.min)?.severity;
}

/**
 * Returns findings for the slow requests among `requests`. Pure and
 * order-independent: the same input always yields the same findings.
 */
export function findSlowRequests(requests: RequestFact[]): Finding[] {
  const samples = timedApiRequests(requests);
  if (!samples.length) return [];

  const durations = samples.map((request) => request.durationMs ?? 0);
  const medianMs = median(durations);
  const canCompare = samples.length >= OUTLIER_MIN_SAMPLES && medianMs > 0;

  const findings: Finding[] = [];
  const flagged = new Set<RequestFact>();

  for (const request of samples) {
    const durationMs = request.durationMs ?? 0;
    const rounded = Math.round(durationMs);

    const severity = absoluteSeverity(durationMs);
    if (severity) {
      flagged.add(request);
      findings.push(
        slowFinding(
          "perf.slow-request",
          severity,
          "Slow request",
          `${label(request)} took ${rounded}ms to respond`,
          request.url,
        ),
      );
    }

    if (
      canCompare &&
      durationMs >= OUTLIER_MIN_MS &&
      durationMs > medianMs * OUTLIER_MEDIAN_MULTIPLE
    ) {
      flagged.add(request);
      findings.push(
        slowFinding(
          "perf.slow-outlier",
          "medium",
          "Request much slower than its peers",
          `${label(request)} took ${rounded}ms — ${(durationMs / medianMs).toFixed(1)}× the median of ${Math.round(medianMs)}ms across ${samples.length} calls`,
          request.url,
        ),
      );
    }
  }

  const slowest = [...samples]
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .filter(
      (request) =>
        !flagged.has(request) &&
        (request.durationMs ?? 0) >= SLOWEST_REPORT_MIN_MS,
    )
    .slice(0, SLOWEST_COUNT);

  for (const request of slowest) {
    findings.push(
      slowFinding(
        "perf.slowest",
        "info",
        "Slowest requests",
        `${label(request)} took ${Math.round(request.durationMs ?? 0)}ms (median ${Math.round(medianMs)}ms)`,
        request.url,
      ),
    );
  }

  return findings;
}
