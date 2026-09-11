import { isGraphqlRequest } from "../domain/rules/graphql-rules.js";
import type { RequestFact } from "../domain/models.js";

const outlet = document.getElementById("graphql-output");
const status = document.getElementById("graphql-status");
const dialog = document.getElementById(
  "graphql-dialog",
) as HTMLDialogElement | null;
const dialogTitle = document.getElementById("graphql-dialog-title");
const dialogBody = document.getElementById("graphql-dialog-body");
const dialogClose = document.getElementById("graphql-dialog-close");
const refreshButton = document.getElementById("graphql-refresh");

let requests: RequestFact[] = [];

if (outlet) {
  document
    .getElementById("tab-graphql")
    ?.addEventListener("click", () => void refresh());
  dialogClose?.addEventListener("click", () => dialog?.close());
  refreshButton?.addEventListener("click", () => void refresh());
  void refresh();
}

async function activeTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function refresh(): Promise<void> {
  if (!outlet) return;

  const tabId = await activeTabId();
  if (tabId == null) {
    requests = [];
    render();
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "api-qa/get-graphql",
    tabId,
  });
  const captured = Array.isArray(response?.requests) ? response.requests : [];
  requests = captured.filter(isGraphqlRequest);
  render();
}

function render(): void {
  if (!outlet) return;

  outlet.textContent = "";
  if (status) {
    status.textContent = `${requests.length} GraphQL call${requests.length === 1 ? "" : "s"} captured on the active tab.`;
  }

  if (!requests.length) {
    outlet.append(emptyState());
    return;
  }

  const list = document.createElement("div");
  list.className = "graphql-list";
  requests
    .slice()
    .reverse()
    .forEach((request, index) =>
      list.append(graphqlItem(request, requests.length - index)),
    );
  outlet.append(list);
}

function graphqlItem(request: RequestFact, number: number): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "graphql-item";
  item.addEventListener("click", () => showDetails(request, number));

  const head = document.createElement("span");
  head.className = "graphql-item-head";
  head.append(
    text("span", "graphql-method", request.method),
    text(
      "span",
      "graphql-status",
      request.responseStatus == null
        ? "No response"
        : String(request.responseStatus),
    ),
  );

  item.append(
    head,
    text("strong", "graphql-url", request.url),
    text(
      "span",
      "graphql-meta",
      `${request.source ?? "network"} · ${request.durationMs == null ? "duration unavailable" : `${request.durationMs} ms`} · ${new Date(request.timestamp).toLocaleTimeString()}`,
    ),
  );

  return item;
}

function showDetails(request: RequestFact, number: number): void {
  if (!dialog || !dialogTitle || !dialogBody) return;

  dialogTitle.textContent = `GraphQL call #${number}`;
  dialogBody.textContent = "";
  dialogBody.append(
    text("div", "graphql-detail-url", request.url),
    detailSection("Request", [
      ["Method", request.method],
      ["Headers", formatHeaders(request.requestHeaders)],
      ["Body", request.body ?? "(empty)"],
    ]),
    detailSection("Response", [
      [
        "Status",
        request.responseStatus == null
          ? "No response"
          : String(request.responseStatus),
      ],
      ["Headers", formatHeaders(request.responseHeaders)],
      ["Body", request.responseBody ?? "(empty or unavailable)"],
    ]),
  );
  dialog.showModal();
}

function detailSection(
  title: string,
  entries: Array<[string, string]>,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "graphql-detail-section";
  section.append(text("h3", undefined, title));

  for (const [label, value] of entries) {
    const row = document.createElement("div");
    row.className = "graphql-detail-row";
    row.append(text("strong", undefined, label), text("pre", undefined, value));
    section.append(row);
  }

  return section;
}

function formatHeaders(headers: Record<string, string> | undefined): string {
  if (!headers || !Object.keys(headers).length) return "(none)";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function emptyState(): HTMLElement {
  const state = document.createElement("div");
  state.className = "state";
  state.append(
    text("strong", undefined, "No GraphQL calls yet"),
    text(
      "span",
      undefined,
      "Browse the active tab, then open this section to inspect captured calls.",
    ),
  );
  return state;
}

function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | undefined,
  value: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}
