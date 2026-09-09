// src/background/service-worker.ts
import { Analyzer } from "../application/analyzer.js";
import { RuleRegistry } from "../application/rule-registry.js";
import { TabRequestStore } from "../infrastructure/tab-request-store.js";
import type { AnalysisContext, Report, RequestFact } from "../domain/models.js";

const analyzer = new Analyzer(new RuleRegistry());
const store = new TabRequestStore();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  void store.clear(tabId);
});

chrome.runtime.onMessage.addListener(
  (message: any, sender: any, sendResponse: any) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

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
        return analyzer.createReport([], {
          requests: 0,
          files: 0,
          dependencies: 0,
        });
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

async function buildReport(tabId: number): Promise<Report> {
  const requests = await store.list(tabId);
  const contexts: AnalysisContext[] = requests.map((request) => ({ request }));
  const findings = analyzer.analyzeContexts(contexts);

  return analyzer.createReport(findings, {
    requests: requests.length,
    files: 0,
    dependencies: 0,
  });
}
