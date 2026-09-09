// src/sidepanel/snapshot-capture-form.ts
// The "New snapshot" form: reads the active tab's storage inventory, lets the
// user name it, tag it, note it and (optionally) hand-pick items, then either
// creates a new snapshot or — when one already exists for the same URL —
// updates that record in place.
import {
  findSnapshotForUrl,
  itemId,
  parseLabels,
  validateSnapshotName,
  type SnapshotArea,
  type StorageSnapshot,
} from "../domain/snapshot/storage-snapshot.js";
import {
  activeTabId,
  autocompleteMenu,
  button,
  fieldLabel,
  node,
} from "./snapshot-dom.js";

interface CaptureOption {
  id: string;
  area: SnapshotArea;
  key: string;
}

const AREA_LABELS: Record<SnapshotArea, string> = {
  localStorage: "localStorage",
  sessionStorage: "sessionStorage",
  cookies: "cookie",
};

export interface CaptureFormDeps {
  formSlot: HTMLElement;
  setStatus: (text: string) => void;
  /** Current snapshot list — used to detect a same-URL record to update. */
  getSnapshots: () => StorageSnapshot[];
  onSaved: () => void | Promise<void>;
}

function isCaptureFormOpen(formSlot: HTMLElement): boolean {
  return !formSlot.hidden;
}

export function closeCaptureForm(deps: CaptureFormDeps): void {
  deps.formSlot.hidden = true;
  deps.formSlot.textContent = "";
  deps.setStatus(
    "Captures the active tab's localStorage, sessionStorage and cookies.",
  );
}

export async function openCaptureForm(deps: CaptureFormDeps): Promise<void> {
  if (isCaptureFormOpen(deps.formSlot)) {
    closeCaptureForm(deps);
    return;
  }

  deps.setStatus("Reading the active tab's storage…");

  const tabId = await activeTabId();
  if (tabId == null) {
    deps.setStatus("No active tab. Focus a browser tab and try again.");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "snapshots/inventory",
    tabId,
  });

  if (response?.ok !== true) {
    deps.setStatus(String(response?.error ?? "Could not read this tab."));
    return;
  }

  const options = optionsFromCapture(response.capture);
  const url = String(response.capture.url ?? "");
  const existing = findSnapshotForUrl(deps.getSnapshots(), url);

  deps.setStatus(
    `${options.length} item${options.length === 1 ? "" : "s"} available on ${response.capture.origin}.`,
  );
  renderForm(deps, tabId, options, existing);
}

function optionsFromCapture(capture: {
  local?: [string, string][];
  session?: [string, string][];
  cookies?: { name: string }[];
}): CaptureOption[] {
  const options: CaptureOption[] = [];

  for (const [key] of capture.local ?? []) {
    options.push({
      id: itemId("localStorage", key),
      area: "localStorage",
      key,
    });
  }
  for (const [key] of capture.session ?? []) {
    options.push({
      id: itemId("sessionStorage", key),
      area: "sessionStorage",
      key,
    });
  }
  for (const cookie of capture.cookies ?? []) {
    options.push({
      id: itemId("cookies", cookie.name),
      area: "cookies",
      key: cookie.name,
    });
  }

  return options;
}

function renderForm(
  deps: CaptureFormDeps,
  tabId: number,
  options: CaptureOption[],
  existing: StorageSnapshot | undefined,
): void {
  const { formSlot } = deps;
  formSlot.textContent = "";
  formSlot.hidden = false;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Snapshot name";
  nameInput.id = "snap-name";

  const labelsInput = document.createElement("input");
  labelsInput.type = "text";
  labelsInput.id = "snap-labels";
  labelsInput.placeholder = "comma-separated";

  const notesInput = document.createElement("textarea");
  notesInput.id = "snap-notes";
  notesInput.placeholder = "Notes (optional)";

  const scopeLabel = node("label", "snap-scope") as HTMLLabelElement;
  const scopeBox = document.createElement("input");
  scopeBox.type = "checkbox";
  scopeBox.checked = true;
  scopeLabel.append(
    scopeBox,
    document.createTextNode(` Snapshot all ${options.length} items`),
  );

  const error = node("span", "snap-error");

  const selected = new Set<string>();
  const picker = buildPicker(options, selected);
  picker.hidden = true;
  scopeBox.addEventListener("change", () => {
    picker.hidden = scopeBox.checked;
  });

  const selectedIds = (): string[] | undefined =>
    scopeBox.checked ? undefined : Array.from(selected);

  const validate = (): boolean => {
    error.textContent = "";
    const problem = validateSnapshotName(nameInput.value);
    if (problem) {
      error.textContent = problem;
      return false;
    }
    if (!scopeBox.checked && selected.size === 0) {
      error.textContent = "Pick at least one item, or snapshot all.";
      return false;
    }
    return true;
  };

  const create = async (): Promise<void> => {
    if (!validate()) return;

    const response = await chrome.runtime.sendMessage({
      type: "snapshots/create",
      tabId,
      name: nameInput.value,
      notes: notesInput.value,
      labels: parseLabels(labelsInput.value),
      selectedItemIds: selectedIds(),
    });

    if (response?.ok !== true) {
      error.textContent = String(response?.error ?? "Could not save.");
      return;
    }

    deps.setStatus(`Saved "${response.snapshot.name}".`);
    await deps.onSaved();
  };

  const update = async (): Promise<void> => {
    if (!existing) return;

    const recaptured = await chrome.runtime.sendMessage({
      type: "snapshots/update",
      id: existing.id,
      tabId,
      selectedItemIds: selectedIds(),
    });

    if (recaptured?.ok !== true) {
      error.textContent = String(recaptured?.error ?? "Could not update.");
      return;
    }

    // Carry across any name / label / note edits made in the form.
    await chrome.runtime.sendMessage({
      type: "snapshots/update-meta",
      id: existing.id,
      name: nameInput.value,
      notes: notesInput.value,
      labels: parseLabels(labelsInput.value),
    });

    deps.setStatus(`Updated "${nameInput.value}" from this page.`);
    await deps.onSaved();
  };

  const actions = node("div", "rec-actions");
  actions.append(button("Save snapshot", create));
  if (existing) {
    actions.append(button(`Update "${existing.name}" instead`, update));
    nameInput.value = existing.name;
    labelsInput.value = existing.labels.join(", ");
    notesInput.value = existing.notes;
  }
  actions.append(button("Cancel", () => closeCaptureForm(deps)));

  formSlot.append(
    fieldLabel("Name", nameInput),
    nameInput,
    fieldLabel("Labels", labelsInput),
    labelsInput,
    fieldLabel("Notes", notesInput),
    notesInput,
    scopeLabel,
    picker,
    error,
    actions,
  );

  if (existing) {
    formSlot.insertBefore(
      node(
        "p",
        "snap-notes",
        `A snapshot for this exact URL already exists — you can update it in place instead of creating a duplicate.`,
      ),
      formSlot.firstChild,
    );
  }

  nameInput.focus();
}

function buildPicker(
  options: CaptureOption[],
  selected: Set<string>,
): HTMLElement {
  const wrap = node("div", "snap-picker");
  const chips = node("div", "snap-chips");
  const byId = new Map(options.map((option) => [option.id, option]));

  const renderChips = (): void => {
    chips.textContent = "";
    for (const id of selected) {
      const option = byId.get(id);
      if (!option) continue;

      const chip = node("span", "snap-chip");
      chip.append(
        document.createTextNode(`${AREA_LABELS[option.area]} · ${option.key}`),
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${option.key}`);
      remove.addEventListener("click", () => {
        selected.delete(id);
        renderChips();
        menu.refresh();
      });

      chip.append(remove);
      chips.append(chip);
    }
  };

  const menu = autocompleteMenu({
    placeholder: "Type to find keys / cookies…",
    options: () =>
      options
        .filter((option) => !selected.has(option.id))
        .map((option) => ({
          id: option.id,
          primary: option.key,
          secondary: AREA_LABELS[option.area],
        })),
    onPick: (id) => {
      selected.add(id);
      renderChips();
    },
  });

  wrap.append(chips, menu.root);
  return wrap;
}
