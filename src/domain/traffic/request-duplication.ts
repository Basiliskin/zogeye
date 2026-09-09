// src/domain/traffic/request-duplication.ts
// Deterministic detection of the same request being fired many times over —
// the client-side "self-DDoS" shape: a render loop, an over-eager effect, or a
// retry loop that hammers an endpoint. Pure and order-independent: the same
// captured traffic always yields the same findings.
//
// Two things are called out:
//   1. Request storms — one signature repeated within a short window. Exactly
//      two tightly-spaced calls are reported gently as the React StrictMode
//      double-invoke shape (dev-only remount runs each effect twice); three or
//      more is a real storm whose severity scales with the count.
//   2. Missing retry jitter — a signature retried after a retryable/failed
//      response on a fixed cadence (or a clean power-of-N backoff with no
//      randomisation). Synchronised retries across clients cause thundering-herd
//      load; jitter is the fix.
import type { Finding, RequestFact, Severity } from "../models.js";
import { isStaticResource } from "./performance.js";
import { parseUrlSafe } from "../web-utils.js";

/** Query params that commonly carry a cache-buster / timestamp and must be
 * ignored so otherwise-identical calls collapse to one signature. */
const VOLATILE_PARAMS = new Set([
  "_",
  "t",
  "ts",
  "time",
  "timestamp",
  "cb",
  "cache",
  "cachebust",
  "nocache",
  "rand",
  "random",
  "nonce",
  "v",
  "_dc",
]);

/** Real-time transports repeat by nature; they are not request storms. */
const STREAM_SOURCE = /(websocket|eventsource|sse|message)/i;

const STORM_WINDOW_MS = 10_000;
/** Max gap for two calls to read as one StrictMode remount rather than two
 * deliberate user actions. */
const STRICT_MODE_GAP_MS = 1_000;

/** Storm severity by peak count inside the window. */
const STORM_TIERS: { min: number; severity: Severity }[] = [
  { min: 12, severity: "high" },
  { min: 6, severity: "medium" },
  { min: 3, severity: "low" },
];

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_MIN_ATTEMPTS = 3;
/** Below this median gap, retries are effectively a hot loop with no delay. */
const RETRY_NO_DELAY_MS = 250;
/** Coefficient of variation under which retry gaps count as "fixed cadence". */
const JITTER_CV_THRESHOLD = 0.15;
/** How close successive gap ratios must be to a constant to read as a clean,
 * un-jittered exponential backoff. */
const BACKOFF_RATIO_TOLERANCE = 0.1;
const BACKOFF_MIN_RATIO = 1.3;

interface Group {
  signature: string;
  requests: RequestFact[];
}

export function findRequestDuplication(requests: RequestFact[]): Finding[] {
  const groups = groupBySignature(requests);
  const findings: Finding[] = [];

  for (const group of groups) {
    if (group.requests.length < 2) continue;
    const storm = stormFinding(group);
    if (storm) findings.push(storm);
    const retry = retryFinding(group);
    if (retry) findings.push(retry);
  }

  return findings;
}

function groupBySignature(requests: RequestFact[]): Group[] {
  const bySignature = new Map<string, RequestFact[]>();

  for (const request of requests) {
    if (STREAM_SOURCE.test(request.source ?? "")) continue;
    if (isStaticResource(request)) continue;

    const signature = signatureOf(request);
    const bucket = bySignature.get(signature);
    if (bucket) bucket.push(request);
    else bySignature.set(signature, [request]);
  }

  return [...bySignature.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([signature, bucket]) => ({
      signature,
      requests: [...bucket].sort((a, b) => a.timestamp - b.timestamp),
    }));
}

function groupLabel(requests: RequestFact[]): string {
  const first = requests[0];
  return first ? labelOf(first) : "request";
}

function signatureOf(request: RequestFact): string {
  const method = request.method.toUpperCase();
  const url = parseUrlSafe(request.url);

  const path = url
    ? `${url.protocol}//${url.host}${url.pathname}?${stableQuery(url)}`
    : request.url.split("#")[0];

  return `${method} ${path} ${hash(request.body ?? "")}`;
}

function stableQuery(url: URL): string {
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (VOLATILE_PARAMS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return kept.map(([key, value]) => `${key}=${value}`).join("&");
}

function labelOf(request: RequestFact): string {
  const url = parseUrlSafe(request.url);
  const shortUrl = url ? `${url.host}${url.pathname}` : request.url;
  return `${request.method.toUpperCase()} ${shortUrl}`;
}

/** FNV-1a — a short, stable, non-cryptographic digest of the request body. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function stormFinding(group: Group): Finding | undefined {
  const label = groupLabel(group.requests);
  const times = group.requests.map((request) => request.timestamp);
  const peak = peakWithinWindow(times, STORM_WINDOW_MS);

  if (peak.count < 2) return undefined;
  const spanMs = peak.spanMs;

  if (peak.count === 2) {
    if (spanMs > STRICT_MODE_GAP_MS) return undefined;
    return {
      ruleId: "client.strict-mode-double-invoke",
      severity: "info",
      title: "Request fired twice in quick succession",
      details: `${label} was sent 2 times within ${spanMs}ms — the React StrictMode shape (dev remount runs each effect twice). Make the call idempotent and dedupe/abort it so production doesn't double-hit.`,
      evidence: group.requests[0]?.url,
    };
  }

  const severity =
    STORM_TIERS.find((tier) => peak.count >= tier.min)?.severity ?? "low";

  return {
    ruleId: "client.request-storm",
    severity,
    title: "Same request repeated in a burst",
    details: `${label} was sent ${peak.count} times within ${spanMs}ms (${ratePerSecond(peak.count, spanMs)}/s) — likely a render loop or an effect firing on every state change. This is a client-side self-DDoS; guard the trigger and dedupe in-flight calls.`,
    evidence: group.requests[0]?.url,
  };
}

/** Largest number of timestamps that fit in any `windowMs`-wide slice, plus the
 * real span of that slice. `times` is assumed sorted ascending. */
function peakWithinWindow(
  times: number[],
  windowMs: number,
): { count: number; spanMs: number } {
  let best = { count: times.length ? 1 : 0, spanMs: 0 };
  let start = 0;

  for (let end = 0; end < times.length; end += 1) {
    const endTime = times[end] ?? 0;
    while ((times[start] ?? 0) < endTime - windowMs) start += 1;

    const count = end - start + 1;
    if (count > best.count) {
      best = { count, spanMs: endTime - (times[start] ?? 0) };
    }
  }

  return best;
}

function ratePerSecond(count: number, spanMs: number): string {
  if (spanMs <= 0) return "∞";
  return ((count / spanMs) * 1000).toFixed(1);
}

function retryFinding(group: Group): Finding | undefined {
  if (group.requests.length < RETRY_MIN_ATTEMPTS) return undefined;
  if (!group.requests.some(isRetryEvidence)) return undefined;

  const label = groupLabel(group.requests);
  const gaps = consecutiveDeltas(
    group.requests.map((request) => request.timestamp),
  );
  if (gaps.length < 2) return undefined;

  const attempts = group.requests.length;
  const med = median(gaps);

  if (med < RETRY_NO_DELAY_MS) {
    return {
      ruleId: "retry.no-delay",
      severity: "high",
      title: "Retry loop with no delay",
      details: `${label} was retried ${attempts} times after retryable/failed responses with a median gap of ${Math.round(med)}ms — a hot retry loop. Back off between attempts and add jitter.`,
      evidence: group.requests[0]?.url,
    };
  }

  const cv = coefficientOfVariation(gaps);
  if (cv < JITTER_CV_THRESHOLD) {
    return {
      ruleId: "retry.jitter-missing",
      severity: "medium",
      title: "Retries on a fixed cadence — jitter required",
      details: `${label} was retried ${attempts} times, spaced a near-constant ${Math.round(mean(gaps))}ms apart (variation ${(cv * 100).toFixed(0)}%). Fixed-interval retries from many clients synchronise into thundering-herd spikes; randomise each delay (e.g. full jitter).`,
      evidence: group.requests[0]?.url,
    };
  }

  if (isCleanExponentialBackoff(gaps)) {
    return {
      ruleId: "retry.jitter-missing",
      severity: "medium",
      title: "Deterministic backoff — jitter required",
      details: `${label} was retried ${attempts} times with each gap ~${meanRatio(gaps).toFixed(1)}× the previous — a clean, un-randomised exponential backoff. Add jitter so retrying clients don't re-collide at every step.`,
      evidence: group.requests[0]?.url,
    };
  }

  return undefined;
}

function isRetryEvidence(request: RequestFact): boolean {
  const status = request.responseStatus;
  return (
    status === undefined ||
    status === 0 ||
    RETRYABLE_STATUS.has(status) ||
    (status >= 500 && status < 600)
  );
}

/** Gaps between each pair of consecutive values. */
function consecutiveDeltas(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    out.push((values[i] ?? 0) - (values[i - 1] ?? 0));
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function coefficientOfVariation(values: number[]): number {
  const avg = mean(values);
  if (avg <= 0) return Number.POSITIVE_INFINITY;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance) / avg;
}

function ratios(gaps: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < gaps.length; i += 1) {
    const previous = gaps[i - 1] ?? 0;
    if (previous <= 0) return [];
    out.push((gaps[i] ?? 0) / previous);
  }
  return out;
}

function meanRatio(gaps: number[]): number {
  const r = ratios(gaps);
  return r.length ? mean(r) : 1;
}

function isCleanExponentialBackoff(gaps: number[]): boolean {
  const r = ratios(gaps);
  if (r.length < 2) return false;
  const avg = mean(r);
  if (avg < BACKOFF_MIN_RATIO) return false;
  return r.every(
    (value) => Math.abs(value - avg) <= avg * BACKOFF_RATIO_TOLERANCE,
  );
}
