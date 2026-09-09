// src/sidepanel/snapshots.ts
// "Snapshots" tab orchestrator: renders the saved-snapshot list with a
// free-text + label filter, wires the capture form (src/sidepanel/
// snapshot-capture-form) and the value editor (src/sidepanel/snapshot-entries),
// and relays restore / meta / delete messages. The background service worker
// owns every read, write and the storage itself.
import {
  collectLabels,
  filterSnapshots,
  parseLabels,
  snapshotCounts,
  validateSnapshotName,
  type StorageSnapshot,
} from "../domain/snapshot/storage-snapshot.js";
import {
  closeCaptureForm,
  openCaptureForm,
  type CaptureFormDeps,
} from "./snapshot-capture-form.js";
import { renderEntriesEditor } from "./snapshot-entries.js";
import { activeTabId, button, emptyState, node } from "./snapshot-dom.js";

const newButton = document.getElementById(
  "snap-new",
) as HTMLButtonElement | null;
const status = document.getElementById("snap-status");
const formSlot = document.getElementById("snap-form") as HTMLElement | null;
const outlet = document.getElementById("snap-output");
const filterBar = document.getElementById("snap-filter");
const searchInput = document.getElementById(
  "snap-search",
) as HTMLInputElement | null;
const filterLabels = document.getElementById("snap-filter-labels");

let snapshots: StorageSnapshot[] = [];
let query = "";
const activeLabels = new Set<string>();

let confirmingId: string | null = null;
let editingMetaId: string | null = null;
let editingEntriesId: string | null = null;

function setStatus(text: string): void {
  if (status) status.textContent = text;
}

function makeFormDeps(slot: HTMLElement): CaptureFormDeps {
  const deps: CaptureFormDeps = {
    formSlot: slot,
    setStatus,
    getSnapshots: () => snapshots,
    onSaved: async () => {
      closeCaptureForm(deps);
      await refresh();
    },
  };
  return deps;
}

if (newButton && status && formSlot && outlet) {
  const formDeps = makeFormDeps(formSlot);
  newButton.addEventListener("click", () => void openCaptureForm(formDeps));
  document
    .getElementById("tab-snapshots")
    ?.addEventListener("click", () => void refresh());
  searchInput?.addEventListener("input", () => {
    query = searchInput.value;
    render();
  });
  void refresh();
}

async function refresh(): Promise<void> {
  if (!outlet) return;

  const response = await chrome.runtime.sendMessage({ type: "snapshots/list" });
  snapshots = Array.isArray(response?.snapshots) ? response.snapshots : [];

  const known = new Set(collectLabels(snapshots));
  for (const label of [...activeLabels]) {
    if (!known.has(label)) activeLabels.delete(label);
  }

  render();
}

function render(): void {
  if (!outlet) return;

  if (filterBar) filterBar.hidden = snapshots.length === 0;
  renderFilterLabels();

  outlet.textContent = "";

  if (snapshots.length === 0) {
    outlet.append(
      emptyState(
        "No snapshots yet",
        "Press New snapshot to capture the current tab's storage.",
      ),
    );
    return;
  }

  const list = filterSnapshots(snapshots, {
    query,
    labels: [...activeLabels],
  });

  if (list.length === 0) {
    outlet.append(
      emptyState("No matches", "No snapshot matches the current filter."),
    );
    return;
  }

  const container = node("div", "rec-list");
  for (const snapshot of list) container.append(snapshotCard(snapshot));
  outlet.append(container);
}

function renderFilterLabels(): void {
  if (!filterLabels) return;

  filterLabels.textContent = "";
  for (const label of collectLabels(snapshots)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "snap-filter-chip";
    chip.textContent = label;
    chip.classList.toggle("is-on", activeLabels.has(label));
    chip.setAttribute(
      "aria-pressed",
      activeLabels.has(label) ? "true" : "false",
    );
    chip.addEventListener("click", () => {
      if (activeLabels.has(label)) activeLabels.delete(label);
      else activeLabels.add(label);
      render();
    });
    filterLabels.append(chip);
  }
}

function snapshotCard(snapshot: StorageSnapshot): HTMLElement {
  const card = node("div", "snap-item");

  card.append(node("h3", undefined, snapshot.name));
  card.append(node("span", "snap-origin", snapshot.origin));
  card.append(
    node(
      "span",
      "snap-meta",
      `${snapshot.scope === "all" ? "All items" : "Selected items"} · updated ${new Date(snapshot.updatedAt).toLocaleString()}`,
    ),
  );

  const counts = snapshotCounts(snapshot);
  const countRow = node("div", "snap-counts");
  countRow.append(
    node("span", "snap-count", `${counts.local} localStorage`),
    node("span", "snap-count", `${counts.session} sessionStorage`),
    node("span", "snap-count", `${counts.cookies} cookies`),
  );
  card.append(countRow);

  if (snapshot.labels.length) {
    const tags = node("div", "snap-tags");
    for (const label of snapshot.labels) {
      tags.append(node("span", "snap-tag", label));
    }
    card.append(tags);
  }

  if (snapshot.notes) {
    card.append(node("p", "snap-notes", snapshot.notes));
  }

  const actions = node("div", "rec-actions");
  actions.append(
    button("Switch to this", () => void restore(snapshot)),
    button("Edit values", () => {
      editingEntriesId = editingEntriesId === snapshot.id ? null : snapshot.id;
      editingMetaId = null;
      confirmingId = null;
      render();
    }),
    button("Edit", () => {
      editingMetaId = snapshot.id;
      editingEntriesId = null;
      confirmingId = null;
      render();
    }),
    button(
      "Delete",
      () => {
        confirmingId = snapshot.id;
        editingMetaId = null;
        editingEntriesId = null;
        render();
      },
      true,
    ),
  );
  card.append(actions);

  if (confirmingId === snapshot.id) card.append(confirmRow(snapshot));
  if (editingMetaId === snapshot.id) card.append(metaForm(snapshot));
  if (editingEntriesId === snapshot.id) {
    card.append(
      renderEntriesEditor(snapshot, async () => {
        await refresh();
      }),
    );
  }

  return card;
}

function confirmRow(snapshot: StorageSnapshot): HTMLElement {
  const row = node("div", "rec-confirm");
  row.append(
    node(
      "span",
      undefined,
      `Delete "${snapshot.name}"? This cannot be undone. `,
    ),
  );

  const actions = node("div", "rec-actions");
  actions.append(
    button("Cancel", () => {
      confirmingId = null;
      render();
    }),
    button(
      "Delete",
      async () => {
        await chrome.runtime.sendMessage({
          type: "snapshots/delete",
          id: snapshot.id,
        });
        confirmingId = null;
        await refresh();
      },
      true,
    ),
  );
  row.append(actions);
  return row;
}

function metaForm(snapshot: StorageSnapshot): HTMLElement {
  const form = node("div", "rec-form snap-form");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = snapshot.name;

  const labelsInput = document.createElement("input");
  labelsInput.type = "text";
  labelsInput.value = snapshot.labels.join(", ");
  labelsInput.placeholder = "comma-separated";

  const notesInput = document.createElement("textarea");
  notesInput.value = snapshot.notes;

  const error = node("span", "rec-error");

  form.append(
    labelFor("Name"),
    nameInput,
    labelFor("Labels"),
    labelsInput,
    labelFor("Notes"),
    notesInput,
    error,
  );

  const actions = node("div", "rec-actions");
  actions.append(
    button("Save", async () => {
      const problem = validateSnapshotName(nameInput.value);
      if (problem) {
        error.textContent = problem;
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "snapshots/update-meta",
        id: snapshot.id,
        name: nameInput.value,
        notes: notesInput.value,
        labels: parseLabels(labelsInput.value),
      });

      if (response?.ok !== true) {
        error.textContent = String(response?.error ?? "Could not save.");
        return;
      }

      editingMetaId = null;
      await refresh();
    }),
    button("Cancel", () => {
      editingMetaId = null;
      render();
    }),
  );
  form.append(actions);
  return form;
}

function labelFor(text: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.textContent = text;
  return label;
}

async function restore(snapshot: StorageSnapshot): Promise<void> {
  const tabId = await activeTabId();
  if (tabId == null) {
    setStatus("Focus the tab you want to switch.");
    return;
  }

  setStatus(`Switching to "${snapshot.name}"…`);

  const response = await chrome.runtime.sendMessage({
    type: "snapshots/restore",
    id: snapshot.id,
    tabId,
  });

  if (response?.ok !== true) {
    setStatus(String(response?.error ?? "Could not switch."));
    return;
  }

  const warnings: string[] = Array.isArray(response.warnings)
    ? response.warnings
    : [];

  setStatus(
    warnings.length > 0
      ? `Switched with warnings: ${warnings.join(" ")}`
      : `Switched to "${snapshot.name}" and reloaded the tab.`,
  );
}
