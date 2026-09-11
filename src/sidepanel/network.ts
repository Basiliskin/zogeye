import type { RequestFact } from "../domain/models.js";
import { hasNetworkOutcome } from "../domain/traffic/network-outcome.js";
import "./graphql.js";

const outlet = document.getElementById("network-output");
const status = document.getElementById("network-status");
const refreshButton = document.getElementById("network-refresh");
const searchInput = document.getElementById(
  "network-search",
) as HTMLInputElement | null;

let requests: RequestFact[] = [];
let query = "";

if (outlet) {
  document
    .getElementById("tab-network")
    ?.addEventListener("click", () => void refresh());
  refreshButton?.addEventListener("click", () => void refresh());
  searchInput?.addEventListener("input", () => {
    query = searchInput.value;
    render();
  });
  void refresh();
}

async function refresh(): Promise<void> {
  if (!outlet) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;

  if (tabId == null) {
    requests = [];
    render();
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "api-qa/get-network",
    tabId,
  });
  const captured = Array.isArray(response?.requests) ? response.requests : [];
  requests = captured.filter(hasNetworkOutcome);
  render();
}

function render(): void {
  if (!outlet) return;

  outlet.textContent = "";
  const visibleRequests = requests.filter((request) =>
    matchesQuery(request, query),
  );
  if (status) {
    status.textContent = query.trim()
      ? `${visibleRequests.length} of ${requests.length} network calls match the search.`
      : `${requests.length} network call${requests.length === 1 ? "" : "s"} captured on the active tab.`;
  }

  if (!requests.length || !visibleRequests.length) {
    const state = document.createElement("div");
    state.className = "state";
    state.append(
      text(
        "strong",
        requests.length ? "No matching calls" : "No network calls yet",
      ),
      text(
        "span",
        requests.length
          ? "Try a different search term."
          : "Completed calls and transport errors will appear here.",
      ),
    );
    outlet.append(state);
    return;
  }

  const list = document.createElement("div");
  list.className = "graphql-list";
  visibleRequests
    .slice()
    .reverse()
    .forEach((request, index) =>
      list.append(networkItem(request, visibleRequests.length - index)),
    );
  outlet.append(list);
}

function matchesQuery(request: RequestFact, value: string): boolean {
  const searchText = [
    request.method,
    request.url,
    request.source,
    request.responseStatus == null ? "" : String(request.responseStatus),
    ...Object.entries(request.requestHeaders ?? {}).flat(),
    ...Object.entries(request.responseHeaders ?? {}).flat(),
    request.body,
    request.responseBody,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchText.includes(value.trim().toLowerCase());
}

function networkItem(request: RequestFact, number: number): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "graphql-item";
  item.addEventListener("click", () => {
    document.dispatchEvent(
      new CustomEvent("api-qa/show-request", {
        detail: { request, number, title: "Network call" },
      }),
    );
  });

  const head = document.createElement("span");
  head.className = "graphql-item-head";
  head.append(
    text("span", request.method, "graphql-method"),
    text(
      "span",
      request.source?.endsWith("-error")
        ? "Error"
        : request.responseStatus == null
          ? "No response"
          : String(request.responseStatus),
      "graphql-status",
    ),
  );
  item.append(
    head,
    text("strong", request.url, "graphql-url"),
    text(
      "span",
      `${request.source ?? "network"} · ${request.durationMs == null ? "duration unavailable" : `${request.durationMs} ms`} · ${new Date(request.timestamp).toLocaleTimeString()}`,
      "graphql-meta",
    ),
  );
  return item;
}

function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  value: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}
