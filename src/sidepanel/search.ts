// src/sidepanel/search.ts
// "Search" tab: pull a one-shot corpus snapshot of the active tab from the
// background (page source, cookies, captured requests, local / session
// storage) and filter it live with the pure domain search engine.
import {
  searchCorpus,
  SearchQueryError,
  summarizeHits,
  type SearchCorpus,
  type SearchHit,
  type SearchSourceKind,
} from "../domain/search.js";

const input = document.getElementById(
  "search-input",
) as HTMLInputElement | null;
const caseBox = document.getElementById(
  "search-case",
) as HTMLInputElement | null;
const regexBox = document.getElementById(
  "search-regex",
) as HTMLInputElement | null;
const refreshButton = document.getElementById("search-refresh");
const kindsBox = document.getElementById("search-kinds");
const outlet = document.getElementById("search-output");

let corpus: SearchCorpus | null = null;
let pageAvailable = false;
let loading = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

if (input && kindsBox && outlet) {
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(render, 140);
  });

  for (const control of [caseBox, regexBox]) {
    control?.addEventListener("change", render);
  }

  for (const box of Array.from(
    kindsBox.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
  )) {
    box.addEventListener("change", render);
  }

  refreshButton?.addEventListener("click", () => void load());

  // Re-pull a fresh snapshot every time the user opens the Search tab, so the
  // corpus always reflects the current active tab and its latest DOM.
  document
    .getElementById("tab-search")
    ?.addEventListener("click", () => void load());

  void load();
}

async function activeTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function load(): Promise<void> {
  if (!outlet || loading) return;

  loading = true;
  renderState("Scanning the active tab…", "");

  try {
    const tabId = await activeTabId();

    if (tabId == null) {
      renderState("No active tab", "Focus a browser tab and press Rescan.");
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "api-qa/search-corpus",
      tabId,
    });

    if (response?.ok !== true) {
      renderState(
        "Could not read the tab",
        String(response?.error ?? "The background worker did not reply."),
      );
      return;
    }

    corpus = {
      documents: Array.isArray(response.documents) ? response.documents : [],
    };
    pageAvailable = Boolean(response.pageAvailable);
  } finally {
    loading = false;
  }

  render();
}

function selectedKinds(): SearchSourceKind[] {
  if (!kindsBox) return [];

  return Array.from(
    kindsBox.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked"),
  ).map((box) => box.value as SearchSourceKind);
}

function render(): void {
  if (!outlet || !input) return;
  if (!corpus) {
    renderState("Search the active tab", "Press Rescan to load a snapshot.");
    return;
  }

  const query = input.value;
  const kinds = selectedKinds();

  if (!query.trim()) {
    const note = pageAvailable
      ? ""
      : "Page source and storage are unavailable on this tab — requests and cookies only.";
    renderState(
      `${corpus.documents.length} document${corpus.documents.length === 1 ? "" : "s"} indexed`,
      note || "Type to search across every source.",
    );
    return;
  }

  if (kinds.length === 0) {
    renderState("No sources selected", "Enable at least one source above.");
    return;
  }

  let hits: SearchHit[];

  try {
    hits = searchCorpus(corpus, query, {
      caseSensitive: Boolean(caseBox?.checked),
      regex: Boolean(regexBox?.checked),
      kinds,
    });
  } catch (error) {
    renderState(
      "Invalid query",
      error instanceof SearchQueryError ? error.message : String(error),
    );
    return;
  }

  outlet.textContent = "";

  if (!pageAvailable) {
    const warn = document.createElement("div");
    warn.className = "search-summary";
    warn.textContent =
      "Page source, inline scripts and storage are not being read — reload the tab, then press Rescan.";
    outlet.append(warn);
  }

  if (hits.length === 0) {
    const empty = document.createElement("div");
    empty.className = "state";
    const strong = document.createElement("strong");
    strong.textContent = "No matches";
    const detail = document.createElement("span");
    detail.textContent = `Nothing matched "${query}".`;
    empty.append(strong, detail);
    outlet.append(empty);
    return;
  }

  const totals = summarizeHits(hits);
  const summary = document.createElement("div");
  summary.className = "search-summary";
  summary.textContent = `${totals.matches} match${totals.matches === 1 ? "" : "es"} in ${totals.documents} document${totals.documents === 1 ? "" : "s"}`;
  outlet.append(summary);

  for (const hit of hits) outlet.append(hitCard(hit));
}

function hitCard(hit: SearchHit): HTMLElement {
  const card = document.createElement("div");
  card.className = "search-hit";

  const head = document.createElement("div");
  head.className = "search-hit-head";
  head.append(
    span("search-hit-kind", KIND_LABELS[hit.kind]),
    span("search-hit-label", hit.label),
    span(
      "search-hit-count",
      `${hit.matchCount} match${hit.matchCount === 1 ? "" : "es"}`,
    ),
  );
  card.append(head);

  if (hit.detail) {
    card.append(span("search-hit-detail", hit.detail));
  }

  for (const snippet of hit.snippets) {
    const row = document.createElement("div");
    row.className = "search-snippet";

    row.append(document.createTextNode(snippet.text.slice(0, snippet.start)));

    const mark = document.createElement("mark");
    mark.textContent = snippet.text.slice(
      snippet.start,
      snippet.start + snippet.length,
    );
    row.append(mark);

    row.append(
      document.createTextNode(
        snippet.text.slice(snippet.start + snippet.length),
      ),
    );
    card.append(row);
  }

  return card;
}

const KIND_LABELS: Record<SearchSourceKind, string> = {
  source: "Source",
  network: "Request",
  cookie: "Cookie",
  localStorage: "localStorage",
  sessionStorage: "sessionStorage",
};

function span(className: string, text: string): HTMLElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function renderState(title: string, detail: string): void {
  if (!outlet) return;

  outlet.textContent = "";
  const state = document.createElement("div");
  state.className = "state";

  const strong = document.createElement("strong");
  strong.textContent = title;
  state.append(strong);

  if (detail) {
    const span2 = document.createElement("span");
    span2.textContent = detail;
    state.append(span2);
  }

  outlet.append(state);
}
