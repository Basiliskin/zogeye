// src/background/service-worker.ts
import { Analyzer } from "../application/analyzer.js";
import { RuleRegistry } from "../application/rule-registry.js";
import { TabRequestStore } from "../infrastructure/tab-request-store.js";
import type {
  AnalysisContext,
  PageFact,
  Report,
  RequestFact,
} from "../domain/models.js";

const analyzer = new Analyzer(new RuleRegistry());
const store = new TabRequestStore();

const EMPTY_FACTS: Report["facts"] = { requests: 0, files: 0, dependencies: 0 };

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  void store.clear(tabId);
});

// A full document navigation replaces the page, so its captured facts are
// stale — reset them the moment the new main frame starts loading.
chrome.webRequest?.onBeforeRequest?.addListener?.(
  (details: { tabId: number; type: string }) => {
    if (details.tabId >= 0 && details.type === "main_frame") {
      void store.clear(details.tabId);
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
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));

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

    case "api-qa/clear": {
      if (typeof message.tabId === "number") {
        await store.clear(message.tabId);
      }

      return { ok: true };
    }

    default:
      return { ok: false };
  }
}

function normalize(request: any): RequestFact {
  return {
    url: String(request.url),
    method: String(request.method ?? "GET").toUpperCase(),
    requestHeaders: request.requestHeaders,
    responseStatus: request.responseStatus,
    responseHeaders: request.responseHeaders,
    body: request.body,
    source: request.source,
    timestamp: Number(request.timestamp ?? Date.now()),
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
    result[key] = result[key] === undefined ? value : `${result[key]}\n${value}`;
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

  const findings = analyzer.analyzeContexts(contexts);

  return analyzer.createReport(findings, {
    requests: requests.length,
    files: 0,
    dependencies: 0,
  });
}
