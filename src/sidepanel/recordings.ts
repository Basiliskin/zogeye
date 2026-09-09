// src/sidepanel/recordings.ts
// "Recordings" tab: CRUD over saved interaction flows. The background service
// worker owns the recording session and storage; this module is pure glue —
// it renders the list and relays start / stop / rename / delete messages.
import {
  validateRecordingMeta,
  type Recording,
  type RecordingStep,
} from "../domain/recording.js";

const toggle = document.getElementById(
  "rec-toggle",
) as HTMLButtonElement | null;
const status = document.getElementById("rec-status");
const outlet = document.getElementById("rec-output");

let pollTimer: ReturnType<typeof setInterval> | undefined;
let expandedId: string | null = null;
let editingId: string | null = null;
let confirmingId: string | null = null;

if (toggle && status && outlet) {
  toggle.addEventListener("click", onToggle);
  void syncStatus();
  void refresh();
  startPolling();
}

function startPolling(): void {
  if (pollTimer != null) return;
  pollTimer = setInterval(() => void syncStatus(), 1500);
}

async function activeTab(): Promise<{
  id?: number;
  url?: string;
  title?: string;
}> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? {};
}

async function syncStatus(): Promise<void> {
  const state = await chrome.runtime.sendMessage({ type: "recorder/status" });
  paintToggle(Boolean(state?.recording), state?.stepCount ?? 0);
}

function paintToggle(recording: boolean, stepCount: number): void {
  if (!toggle || !status) return;

  toggle.textContent = recording ? "Stop" : "Record";
  toggle.classList.toggle("is-recording", recording);

  status.textContent = recording
    ? `Recording — ${stepCount} step${stepCount === 1 ? "" : "s"} captured. Interact with the page, then Stop.`
    : "Records clicks, input, keys and navigations on the active tab.";
}

async function onToggle(): Promise<void> {
  const state = await chrome.runtime.sendMessage({ type: "recorder/status" });

  if (state?.recording) {
    await chrome.runtime.sendMessage({ type: "recorder/stop" });
  } else {
    const tab = await activeTab();

    if (typeof tab.id !== "number") {
      if (status) status.textContent = "No active tab to record.";
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "recorder/start",
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
    });

    if (response?.ok === false && status) {
      status.textContent = String(
        response.error ?? "Could not start recording.",
      );
    }
  }

  await syncStatus();
  await refresh();
}

async function reRecord(recording: Recording): Promise<void> {
  const tab = await activeTab();

  if (typeof tab.id !== "number") {
    if (status) status.textContent = "Focus the tab you want to re-record.";
    return;
  }

  await chrome.runtime.sendMessage({
    type: "recorder/start",
    tabId: tab.id,
    url: recording.url,
    title: recording.title,
    recordingId: recording.id,
  });

  await syncStatus();
  await refresh();
}

async function saveMeta(
  recording: Recording,
  title: string,
  url: string,
  errorSlot: HTMLElement,
): Promise<void> {
  const problem = validateRecordingMeta(title, url);

  if (problem) {
    errorSlot.textContent = problem;
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "recordings/rename",
    id: recording.id,
    title,
    url,
  });

  if (response?.ok === false) {
    errorSlot.textContent = String(response.error ?? "Could not save.");
    return;
  }

  editingId = null;
  await refresh();
}

async function remove(id: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: "recordings/delete", id });
  confirmingId = null;
  await refresh();
}

async function refresh(): Promise<void> {
  if (!outlet) return;

  const response = await chrome.runtime.sendMessage({
    type: "recordings/list",
  });
  const list: Recording[] = Array.isArray(response?.recordings)
    ? response.recordings
    : [];

  outlet.textContent = "";

  if (!list.length) {
    outlet.append(
      emptyState(
        "No recordings yet",
        "Press Record, interact with the page, then Stop to save a flow.",
      ),
    );
    return;
  }

  const container = h("div", "rec-list");
  for (const recording of list) container.append(recordingCard(recording));
  outlet.append(container);
}

function recordingCard(recording: Recording): HTMLElement {
  const card = h("div", "rec-item");

  card.append(h("h3", undefined, recording.title));

  const url = h("span", "rec-url", recording.url);
  card.append(url);

  card.append(
    h(
      "span",
      "rec-meta",
      `${recording.steps.length} step${recording.steps.length === 1 ? "" : "s"} · updated ${new Date(recording.updatedAt).toLocaleString()}`,
    ),
  );

  const actions = h("div", "rec-actions");
  actions.append(
    actionButton(
      expandedId === recording.id ? "Hide steps" : "View steps",
      () => {
        expandedId = expandedId === recording.id ? null : recording.id;
        void refresh();
      },
    ),
    actionButton("Re-record", () => void reRecord(recording)),
    actionButton("Edit", () => {
      editingId = recording.id;
      confirmingId = null;
      void refresh();
    }),
    actionButton(
      "Delete",
      () => {
        confirmingId = recording.id;
        editingId = null;
        void refresh();
      },
      true,
    ),
  );
  card.append(actions);

  if (confirmingId === recording.id) {
    card.append(confirmRow(recording));
  }

  if (editingId === recording.id) {
    card.append(editForm(recording));
  }

  if (expandedId === recording.id) {
    card.append(stepList(recording.steps));
  }

  return card;
}

function confirmRow(recording: Recording): HTMLElement {
  const row = h("div", "rec-confirm");
  row.append(
    h(
      "span",
      undefined,
      `Delete "${recording.title}"? This cannot be undone. `,
    ),
  );

  const actions = h("div", "rec-actions");
  actions.append(
    actionButton("Cancel", () => {
      confirmingId = null;
      void refresh();
    }),
    actionButton("Delete", () => void remove(recording.id), true),
  );
  row.append(actions);
  return row;
}

function editForm(recording: Recording): HTMLElement {
  const form = h("div", "rec-form");

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = recording.title;
  titleInput.id = `rec-title-${recording.id}`;

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.value = recording.url;
  urlInput.id = `rec-url-${recording.id}`;

  const error = h("span", "rec-error");

  form.append(labelFor(titleInput, "Title"), titleInput);
  form.append(labelFor(urlInput, "URL"), urlInput);
  form.append(error);

  const actions = h("div", "rec-actions");
  actions.append(
    actionButton(
      "Save",
      () => void saveMeta(recording, titleInput.value, urlInput.value, error),
    ),
    actionButton("Cancel", () => {
      editingId = null;
      void refresh();
    }),
  );
  form.append(actions);
  return form;
}

function stepList(steps: RecordingStep[]): HTMLElement {
  const list = h("div", "rec-steps");

  if (!steps.length) {
    list.append(h("div", "rec-step", "No steps were captured."));
    return list;
  }

  for (const step of steps) {
    const row = h("div", "rec-step");
    row.append(h("span", "rec-step-type", step.type));
    row.append(h("span", undefined, describeStep(step)));
    list.append(row);
  }

  return list;
}

function describeStep(step: RecordingStep): string {
  switch (step.type) {
    case "navigate":
      return step.url ?? "";
    case "change":
      return `${step.selector ?? "?"} = ${step.value ?? ""}`;
    case "keydown":
      return `${step.key ?? "?"} on ${step.selector ?? "?"}`;
    default:
      return step.text
        ? `${step.selector ?? "?"} — "${step.text}"`
        : (step.selector ?? "?");
  }
}

function labelFor(input: HTMLInputElement, text: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.htmlFor = input.id;
  label.textContent = text;
  return label;
}

function actionButton(
  text: string,
  onClick: () => void,
  danger = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (danger) button.classList.add("danger");
  button.addEventListener("click", onClick);
  return button;
}

function emptyState(title: string, detail: string): HTMLElement {
  const state = h("div", "state");
  state.innerHTML =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>';
  state.append(h("strong", undefined, title), h("span", undefined, detail));
  return state;
}

function h(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
