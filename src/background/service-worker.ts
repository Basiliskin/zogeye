// src/background/service-worker.ts
import { Analyzer } from "../application/analyzer.js";
import { RuleRegistry } from "../application/rule-registry.js";
import { TabRequestStore } from "../infrastructure/tab-request-store.js";
import { RecordingStore } from "../infrastructure/recording-store.js";
import { SnapshotStore } from "../infrastructure/snapshot-store.js";
import { handleSnapshotMessage } from "./snapshot-handlers.js";
import { findSlowRequests } from "../domain/traffic/performance.js";
import { findRequestDuplication } from "../domain/traffic/request-duplication.js";
import {
  createRecording,
  updateRecordingMeta,
  withSteps,
  RecordingMetaError,
  type Recording,
  type RecordingStep,
} from "../domain/recording.js";
import type { SearchDocument } from "../domain/search.js";
import type {
  AnalysisContext,
  PageFact,
  Report,
  RequestFact,
} from "../domain/models.js";
import { isGraphqlRequest } from "../domain/rules/graphql-rules.js";

const analyzer = new Analyzer(new RuleRegistry());
const store = new TabRequestStore();
const recordings = new RecordingStore();
const snapshots = new SnapshotStore();

const REC_SESSION_KEY = "api-qa.rec-session";

interface RecordingSession {
  tabId: number;
  recordingId: string | null;
  title: string;
  startUrl: string;
  steps: RecordingStep[];
  startedAt: number;
}

const EMPTY_FACTS: Report["facts"] = { requests: 0, files: 0, dependencies: 0 };

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  void store.clear(tabId);
  void finalizeRecordingIfClosed(tabId);
});

// A full document navigation replaces the page, so its captured facts are
// stale — reset them the moment the new main frame starts loading.
chrome.webRequest?.onBeforeRequest?.addListener?.(
  (details: { tabId: number; type: string; url: string }) => {
    if (details.tabId >= 0 && details.type === "main_frame") {
      void store.clear(details.tabId);
      void recordNavigation(details.tabId, details.url);
    }
  },
  { urls: ["<all_urls>"] },
);

// Capture the real response headers of the top-level and framed documents —
// these are what the header/cookie rules need and are otherwise invisible to
// a content script.
chrome.webRequest?.onHeadersReceived?.addListener?.(
  (details: {
    tabId: number;
    type: string;
    url: string;
    method?: string;
    statusCode?: number;
    responseHeaders?: { name: string; value?: string }[];
  }) => {
    if (details.tabId < 0) return;
    if (details.type !== "main_frame" && details.type !== "sub_frame") return;

    void store.add(details.tabId, {
      url: details.url,
      method: String(details.method ?? "GET").toUpperCase(),
      responseStatus: details.statusCode,
      responseHeaders: collapseHeaders(details.responseHeaders),
      source: "document",
      timestamp: Date.now(),
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);

chrome.runtime.onMessage.addListener(
  (message: any, sender: any, sendResponse: any) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: String(error) }),
      );

    return true;
  },
);

async function handleMessage(message: any, sender: any): Promise<unknown> {
  switch (message?.type) {
    case "api-qa/request": {
      const tabId = sender?.tab?.id;

      if (tabId != null && message.request?.url) {
        await store.add(tabId, normalize(message.request));
      }

      return { ok: true };
    }

    case "api-qa/get-report": {
      if (typeof message.tabId !== "number") {
        return analyzer.createReport([], EMPTY_FACTS);
      }

      return buildReport(message.tabId);
    }

    case "api-qa/get-graphql": {
      if (typeof message.tabId !== "number") {
        return { ok: true, requests: [] };
      }

      const requests = await store.list(message.tabId);
      return { ok: true, requests: requests.filter(isGraphqlRequest) };
    }

    case "api-qa/clear": {
      if (typeof message.tabId === "number") {
        await store.clear(message.tabId);
      }

      return { ok: true };
    }

    case "recorder/should-arm": {
      const session = await readRecordingSession();

      return { arm: session != null && session.tabId === sender?.tab?.id };
    }

    case "recorder/step": {
      const session = await readRecordingSession();
      const tabId = sender?.tab?.id;

      if (session && tabId === session.tabId && isRecordingStep(message.step)) {
        session.steps.push(message.step);
        await writeRecordingSession(session);
      }

      return { ok: true };
    }

    case "recorder/start": {
      if (typeof message.tabId !== "number") {
        return { ok: false, error: "No tab to record." };
      }

      await writeRecordingSession({
        tabId: message.tabId,
        recordingId:
          typeof message.recordingId === "string" ? message.recordingId : null,
        title: String(message.title ?? "") || "Untitled recording",
        startUrl: String(message.url ?? ""),
        steps: [],
        startedAt: Date.now(),
      });

      await armTab(message.tabId);

      return { ok: true };
    }

    case "recorder/stop": {
      const recording = await finalizeRecordingSession();

      return recording
        ? { ok: true, recording }
        : { ok: false, error: "No active recording." };
    }

    case "recorder/status": {
      const session = await readRecordingSession();

      return session
        ? {
            recording: true,
            tabId: session.tabId,
            stepCount: session.steps.length,
            recordingId: session.recordingId,
          }
        : { recording: false };
    }

    case "recordings/list":
      return { ok: true, recordings: await recordings.list() };

    case "recordings/get":
      return { ok: true, recording: await recordings.get(String(message.id)) };

    case "recordings/rename": {
      const existing = await recordings.get(String(message.id));

      if (!existing) {
        return { ok: false, error: "Recording not found." };
      }

      try {
        const next = updateRecordingMeta(
          existing,
          {
            title: message.title,
            url: message.url,
            notes: message.notes,
            labels: Array.isArray(message.labels) ? message.labels : undefined,
          },
          Date.now(),
        );
        await recordings.save(next);

        return { ok: true, recording: next };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof RecordingMetaError ? error.message : String(error),
        };
      }
    }

    case "recordings/delete": {
      await recordings.delete(String(message.id));

      return { ok: true };
    }

    case "snapshots/inventory":
    case "snapshots/list":
    case "snapshots/create":
    case "snapshots/update":
    case "snapshots/rename":
    case "snapshots/update-meta":
    case "snapshots/put-entry":
    case "snapshots/delete-entry":
    case "snapshots/delete":
    case "snapshots/restore":
      return handleSnapshotMessage(message, snapshots);

    case "api-qa/search-corpus": {
      if (typeof message.tabId !== "number") {
        return { ok: false, error: "No active tab." };
      }

      return buildSearchCorpus(message.tabId);
    }

    default:
      return { ok: false };
  }
}

const SEARCH_BODY_MAX = 200_000;

function requestSearchText(request: RequestFact): string {
  const lines: string[] = [`${request.method} ${request.url}`];

  if (request.responseStatus != null) {
    lines.push(`status: ${request.responseStatus}`);
  }

  for (const [key, value] of Object.entries(request.requestHeaders ?? {})) {
    lines.push(`> ${key}: ${value}`);
  }

  for (const [key, value] of Object.entries(request.responseHeaders ?? {})) {
    lines.push(`< ${key}: ${value}`);
  }

  if (request.body) {
    lines.push("", request.body.slice(0, SEARCH_BODY_MAX));
  }

  if (request.responseBody) {
    lines.push("", request.responseBody.slice(0, SEARCH_BODY_MAX));
  }

  return lines.join("\n");
}

async function safeGetTab(
  tabId: number,
): Promise<{ url?: string } | undefined> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function collectSearchPage(tabId: number): Promise<
  | {
      html?: string;
      inlineScripts?: string[];
      local?: [string, string][];
      session?: [string, string][];
    }
  | undefined
> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "api-qa/collect-search",
    });

    return response && typeof response === "object" && !response.error
      ? response
      : undefined;
  } catch {
    return undefined;
  }
}

async function buildSearchCorpus(tabId: number): Promise<{
  ok: true;
  documents: SearchDocument[];
  tabUrl: string | undefined;
  pageAvailable: boolean;
  gatheredAt: number;
}> {
  const [requests, tab, page] = await Promise.all([
    store.list(tabId),
    safeGetTab(tabId),
    collectSearchPage(tabId),
  ]);

  const documents: SearchDocument[] = [];

  for (const request of requests) {
    documents.push({
      kind: "network",
      label: `${request.method} ${request.url}`,
      detail: request.source,
      content: requestSearchText(request),
    });
  }

  const tabUrl = tab?.url;

  if (tabUrl && /^https?:/i.test(tabUrl)) {
    try {
      const cookies = await chrome.cookies.getAll({ url: tabUrl });

      for (const cookie of cookies) {
        documents.push({
          kind: "cookie",
          label: cookie.name,
          detail: `${cookie.domain}${cookie.path}`,
          content: `${cookie.name}=${cookie.value}`,
        });
      }
    } catch {
      // "cookies" permission missing or a restricted URL.
    }
  }

  if (page) {
    if (page.html) {
      documents.push({
        kind: "source",
        label: "Page HTML",
        detail: tabUrl,
        content: page.html,
      });
    }

    (page.inlineScripts ?? []).forEach((script, index) => {
      if (script) {
        documents.push({
          kind: "source",
          label: `Inline script #${index + 1}`,
          content: script,
        });
      }
    });

    for (const [key, value] of page.local ?? []) {
      documents.push({
        kind: "localStorage",
        label: key,
        content: `${key}=${value}`,
      });
    }

    for (const [key, value] of page.session ?? []) {
      documents.push({
        kind: "sessionStorage",
        label: key,
        content: `${key}=${value}`,
      });
    }
  }

  return {
    ok: true,
    documents,
    tabUrl,
    pageAvailable: page != null,
    gatheredAt: Date.now(),
  };
}

function isRecordingStep(value: unknown): value is RecordingStep {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RecordingStep).type === "string"
  );
}

async function readRecordingSession(): Promise<RecordingSession | null> {
  const data = await chrome.storage.session.get(REC_SESSION_KEY);

  return (data[REC_SESSION_KEY] as RecordingSession | undefined) ?? null;
}

async function writeRecordingSession(session: RecordingSession): Promise<void> {
  await chrome.storage.session.set({ [REC_SESSION_KEY]: session });
}

async function clearRecordingSession(): Promise<void> {
  await chrome.storage.session.remove(REC_SESSION_KEY);
}

async function armTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "recorder/arm" });
  } catch {
    // No recorder content script on this tab (chrome:// page, etc.).
  }
}

async function disarmTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "recorder/disarm" });
  } catch {
    // Tab already gone or without a content script.
  }
}

async function recordNavigation(tabId: number, url: string): Promise<void> {
  const session = await readRecordingSession();

  if (session?.tabId !== tabId) {
    return;
  }

  const last = session.steps.at(-1);

  // The initial load of the page the user pressed "record" on is implied by
  // the recording's own start URL — skip that first navigate step.
  if (session.steps.length === 0 && url === session.startUrl) {
    return;
  }

  if (last?.type === "navigate" && last.url === url) {
    return;
  }

  session.steps.push({ type: "navigate", url, timestamp: Date.now() });
  await writeRecordingSession(session);
}

async function finalizeRecordingSession(): Promise<Recording | null> {
  const session = await readRecordingSession();

  if (!session) {
    return null;
  }

  await disarmTab(session.tabId);

  const now = Date.now();
  const existing = session.recordingId
    ? await recordings.get(session.recordingId)
    : undefined;

  const recording = existing
    ? withSteps(existing, session.steps, now)
    : createRecording({
        id: crypto.randomUUID(),
        title: session.title,
        url: session.startUrl || "https://example.com",
        steps: session.steps,
        now,
      });

  await recordings.save(recording);
  await clearRecordingSession();

  return recording;
}

async function finalizeRecordingIfClosed(tabId: number): Promise<void> {
  const session = await readRecordingSession();

  if (session?.tabId === tabId) {
    await finalizeRecordingSession();
  }
}

function normalize(request: any): RequestFact {
  return {
    url: String(request.url),
    method: String(request.method ?? "GET").toUpperCase(),
    requestHeaders: request.requestHeaders,
    responseStatus: request.responseStatus,
    responseHeaders: request.responseHeaders,
    responseBody: request.responseBody,
    body: request.body,
    source: request.source,
    timestamp: Number(request.timestamp ?? Date.now()),
    durationMs:
      typeof request.durationMs === "number" ? request.durationMs : undefined,
  };
}

function collapseHeaders(
  headers: { name: string; value?: string }[] | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  for (const header of headers) {
    const key = String(header.name).toLowerCase();
    const value = String(header.value ?? "");
    // Multiple Set-Cookie headers must all survive; join with newline so the
    // cookie parser can split them back apart without colliding with commas
    // inside Expires.
    result[key] =
      result[key] === undefined ? value : `${result[key]}\n${value}`;
  }

  return result;
}

async function collectPageFact(tabId: number): Promise<PageFact | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "api-qa/collect-page",
    });

    return isPageFact(response) ? response : undefined;
  } catch {
    // No content script on this tab (chrome:// page, extension gallery, …).
    return undefined;
  }
}

function isPageFact(value: unknown): value is PageFact {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PageFact).url === "string" &&
    Array.isArray((value as PageFact).mixedContent)
  );
}

async function buildReport(tabId: number): Promise<Report> {
  const [requests, page] = await Promise.all([
    store.list(tabId),
    collectPageFact(tabId),
  ]);

  const contexts: AnalysisContext[] = requests.map((request) => ({ request }));
  if (page) contexts.push({ page });

  const findings = [
    ...analyzer.analyzeContexts(contexts),
    ...findSlowRequests(requests),
    ...findRequestDuplication(requests),
  ];

  return analyzer.createReport(findings, {
    requests: requests.length,
    files: 0,
    dependencies: 0,
  });
}
