import { isGraphqlRequest } from "../domain/rules/graphql-rules.js";
import { hasNetworkOutcome } from "../domain/traffic/network-outcome.js";
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
let requestsTabId: number | undefined;

if (outlet) {
  document
    .getElementById("tab-graphql")
    ?.addEventListener("click", () => void refresh());
  dialogClose?.addEventListener("click", () => dialog?.close());
  document.addEventListener("api-qa/show-request", (event) => {
    const detail = (
      event as CustomEvent<{
        request: RequestFact;
        number: number;
        title?: string;
      }>
    ).detail;

    if (detail) {
      void activeTabId().then((tabId) =>
        showDetails(detail.request, detail.number, tabId, detail.title),
      );
    }
  });
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
    requestsTabId = undefined;
    requests = [];
    render();
    return;
  }

  requestsTabId = tabId;
  const response = await chrome.runtime.sendMessage({
    type: "api-qa/get-graphql",
    tabId,
  });
  const captured = Array.isArray(response?.requests) ? response.requests : [];
  requests = captured.filter(
    (request: RequestFact) =>
      isGraphqlRequest(request) && hasNetworkOutcome(request),
  );
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
      list.append(graphqlItem(request, requests.length - index, requestsTabId)),
    );
  outlet.append(list);
}

function graphqlItem(
  request: RequestFact,
  number: number,
  tabId: number | undefined,
): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "graphql-item";
  item.addEventListener("click", () => showDetails(request, number, tabId));

  const head = document.createElement("span");
  head.className = "graphql-item-head";
  head.append(
    text("span", "graphql-method", request.method),
    text(
      "span",
      "graphql-status",
      request.source?.endsWith("-error")
        ? "Error"
        : request.responseStatus == null
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

function showDetails(
  request: RequestFact,
  number: number,
  tabId: number | undefined,
  title = "GraphQL call",
): void {
  if (!dialog || !dialogTitle || !dialogBody) return;

  dialogTitle.textContent = `${title} #${number}`;
  dialogBody.textContent = "";
  const requestSection = detailSection("Request", [
    ["Headers", formatHeaders(request.requestHeaders)],
  ]);

  if (isGraphqlRequest(request)) {
    const urlRow = document.createElement("div");
    urlRow.className = "graphql-detail-row";
    urlRow.append(text("strong", undefined, "URL and query parameters"));

    const urlEditor = document.createElement("input");
    urlEditor.className = "graphql-url-editor";
    urlEditor.type = "text";
    urlEditor.value = request.url;
    urlEditor.spellcheck = false;
    urlEditor.setAttribute(
      "aria-label",
      "Edited GraphQL URL and query parameters",
    );
    urlRow.append(urlEditor);
    requestSection.prepend(urlRow);

    const methodRow = document.createElement("div");
    methodRow.className = "graphql-detail-row";
    methodRow.append(text("strong", undefined, "Method"));

    const methodEditor = document.createElement("select");
    methodEditor.className = "graphql-method-editor";
    const methods = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "HEAD",
    ];
    if (!methods.includes(request.method.toUpperCase())) {
      methods.push(request.method.toUpperCase());
    }
    for (const method of methods) {
      const option = document.createElement("option");
      option.value = method;
      option.textContent = method;
      option.selected = method === request.method.toUpperCase();
      methodEditor.append(option);
    }
    methodRow.append(methodEditor);
    requestSection.append(methodRow);

    const bodyRow = document.createElement("div");
    bodyRow.className = "graphql-detail-row";
    bodyRow.append(text("strong", undefined, "Payload"));

    const bodyEditor = document.createElement("textarea");
    bodyEditor.className = "graphql-payload-editor";
    bodyEditor.value = request.body ?? "";
    bodyEditor.rows = 10;
    bodyEditor.spellcheck = false;
    bodyEditor.setAttribute("aria-label", "Edited GraphQL payload");
    bodyRow.append(bodyEditor);
    requestSection.append(bodyRow);

    const actions = document.createElement("div");
    actions.className = "graphql-replay-actions";
    const runButton = text("button", "btn-primary", "Run edited payload");
    runButton.type = "button";
    const replayStatus = text("span", "graphql-replay-status", "");
    const replayOutput = document.createElement("div");
    replayOutput.className = "graphql-replay-output";
    runButton.addEventListener(
      "click",
      () =>
        void replayGraphql(
          request,
          tabId,
          urlEditor.value,
          methodEditor.value,
          bodyEditor.value,
          runButton,
          replayStatus,
          replayOutput,
        ),
    );
    actions.append(runButton, replayStatus);
    requestSection.append(actions);
    requestSection.append(replayOutput);
  } else {
    requestSection.append(
      detailSection("Payload", [["Body", request.body ?? "(empty)"]]),
    );
  }

  dialogBody.append(
    text("div", "graphql-detail-url", request.url),
    requestSection,
    detailSection("Response", responseEntries(request)),
  );
  dialog.showModal();
}

async function replayGraphql(
  request: RequestFact,
  tabId: number | undefined,
  url: string,
  method: string,
  body: string,
  button: HTMLButtonElement,
  status: HTMLElement,
  output: HTMLElement,
): Promise<void> {
  const editedUrl = url.trim();
  if (!editedUrl) {
    status.textContent = "URL is required.";
    output.replaceChildren(
      detailSection("Edited response", [["Error", status.textContent]]),
    );
    return;
  }

  if (tabId == null) {
    status.textContent = "No active tab.";
    output.replaceChildren(
      detailSection("Edited response", [["Error", status.textContent]]),
    );
    return;
  }

  button.disabled = true;
  status.textContent = "Running...";
  output.replaceChildren();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "api-qa/replay-graphql",
      tabId,
      request: {
        url: editedUrl,
        method,
        requestHeaders: request.requestHeaders,
        body,
      },
    });

    if (!response?.ok) {
      status.textContent = response?.error ?? "Request failed.";
      output.replaceChildren(
        detailSection("Edited response", [["Error", status.textContent]]),
      );
      return;
    }

    status.textContent = `Completed with ${response.status}.`;
    output.replaceChildren(
      detailSection("Edited response", [
        ["Status", String(response.status)],
        ["Headers", formatHeaders(response.headers)],
        ["Body", response.body ?? "(empty or unavailable)"],
      ]),
    );
  } catch (error) {
    status.textContent = String(error);
    output.replaceChildren(
      detailSection("Edited response", [["Error", status.textContent]]),
    );
  } finally {
    button.disabled = false;
  }
}

function responseEntries(request: RequestFact): Array<[string, string]> {
  return [
    [
      "Status",
      request.source?.endsWith("-error")
        ? "Transport error"
        : request.responseStatus == null
          ? "No response"
          : String(request.responseStatus),
    ],
    ["Headers", formatHeaders(request.responseHeaders)],
    ["Body", request.responseBody ?? "(empty or unavailable)"],
  ];
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
