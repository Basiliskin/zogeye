// src/sidepanel/snapshots.ts
// "Snapshots" tab: capture the active tab's localStorage / sessionStorage /
// cookies (all of it, or a hand-picked subset via an autocomplete
// multi-select) and switch back to any saved snapshot. The background service
// worker owns the reads, writes and storage; this module is pure glue.
import {
  itemId,
  snapshotCounts,
  validateSnapshotName,
  type SnapshotArea,
  type StorageSnapshot,
} from "../domain/snapshot/storage-snapshot.js";

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

const newButton = document.getElementById(
  "snap-new",
) as HTMLButtonElement | null;
const status = document.getElementById("snap-status");
const formSlot = document.getElementById("snap-form") as HTMLElement | null;
const outlet = document.getElementById("snap-output");

let confirmingId: string | null = null;
let renamingId: string | null = null;

if (newButton && status && formSlot && outlet) {
  newButton.addEventListener("click", () => void openForm());
  document
    .getElementById("tab-snapshots")
    ?.addEventListener("click", () => void refresh());
  void refresh();
}

async function activeTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

function setStatus(text: string): void {
  if (status) status.textContent = text;
}

async function openForm(): Promise<void> {
  if (!formSlot) return;

  if (!formSlot.hidden) {
    closeForm();
    return;
  }

  setStatus("Reading the active tab's storage…");

  const tabId = await activeTabId();
  if (tabId == null) {
    setStatus("No active tab. Focus a browser tab and try again.");
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "snapshots/inventory",
    tabId,
  });

  if (response?.ok !== true) {
    setStatus(String(response?.error ?? "Could not read this tab."));
    return;
  }

  const options = optionsFromCapture(response.capture);
  setStatus(
    `${options.length} item${options.length === 1 ? "" : "s"} available on ${response.capture.origin}.`,
  );
  renderForm(tabId, options);
}

function closeForm(): void {
  if (formSlot) {
    formSlot.hidden = true;
    formSlot.textContent = "";
  }
  setStatus("Captures the active tab's localStorage, sessionStorage and cookies.");
}

function optionsFromCapture(capture: {
  local?: [string, string][];
  session?: [string, string][];
  cookies?: { name: string }[];
}): CaptureOption[] {
  const options: CaptureOption[] = [];

  for (const [key] of capture.local ?? []) {
    options.push({ id: itemId("localStorage", key), area: "localStorage", key });
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

function renderForm(tabId: number, options: CaptureOption[]): void {
  if (!formSlot) return;

  formSlot.textContent = "";
  formSlot.hidden = false;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Snapshot name";
  nameInput.id = "snap-name";

  const scopeLabel = document.createElement("label");
  scopeLabel.className = "snap-scope";
  const scopeBox = document.createElement("input");
  scopeBox.type = "checkbox";
  scopeBox.checked = true;
  scopeLabel.append(
    scopeBox,
    document.createTextNode(` Snapshot all ${options.length} items`),
  );

  const error = document.createElement("span");
  error.className = "snap-error";

  const selected = new Set<string>();
  const picker = buildPicker(options, selected);
  picker.hidden = true;

  scopeBox.addEventListener("change", () => {
    picker.hidden = scopeBox.checked;
  });

  const actions = document.createElement("div");
  actions.className = "rec-actions";
  actions.append(
    button("Save snapshot", async () => {
      error.textContent = "";

      const problem = validateSnapshotName(nameInput.value);
      if (problem) {
        error.textContent = problem;
        return;
      }

      if (!scopeBox.checked && selected.size === 0) {
        error.textContent = "Pick at least one item, or snapshot all.";
        return;
      }

      const payload: Record<string, unknown> = {
        type: "snapshots/create",
        tabId,
        name: nameInput.value,
      };
      if (!scopeBox.checked) {
        payload.selectedItemIds = Array.from(selected);
      }

      const response = await chrome.runtime.sendMessage(payload);

      if (response?.ok !== true) {
        error.textContent = String(response?.error ?? "Could not save.");
        return;
      }

      closeForm();
      setStatus(`Saved "${response.snapshot.name}".`);
      await refresh();
    }),
    button("Cancel", () => closeForm()),
  );

  formSlot.append(
    fieldLabel("Name", nameInput),
    nameInput,
    scopeLabel,
    picker,
    error,
    actions,
  );
  nameInput.focus();
}

function buildPicker(
  options: CaptureOption[],
  selected: Set<string>,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "snap-picker";

  const chips = document.createElement("div");
  chips.className = "snap-chips";

  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = "Type to find keys / cookies…";
  search.autocomplete = "off";

  const menu = document.createElement("div");
  menu.className = "snap-menu";
  menu.hidden = true;

  const byId = new Map(options.map((option) => [option.id, option]));

  const renderChips = (): void => {
    chips.textContent = "";
    for (const id of selected) {
      const option = byId.get(id);
      if (!option) continue;

      const chip = document.createElement("span");
      chip.className = "snap-chip";
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
      });

      chip.append(remove);
      chips.append(chip);
    }
  };

  const renderMenu = (): void => {
    const term = search.value.trim().toLowerCase();
    const matches = options
      .filter((option) => !selected.has(option.id))
      .filter(
        (option) =>
          term === "" ||
          option.key.toLowerCase().includes(term) ||
          option.area.toLowerCase().includes(term),
      )
      .slice(0, 50);

    menu.textContent = "";

    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "snap-menu-empty";
      empty.textContent = "No matching items.";
      menu.append(empty);
      menu.hidden = false;
      return;
    }

    for (const option of matches) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "snap-option";

      const area = document.createElement("span");
      area.className = "snap-option-area";
      area.textContent = AREA_LABELS[option.area];

      const key = document.createElement("span");
      key.className = "snap-option-key";
      key.textContent = option.key;

      row.append(area, key);
      row.addEventListener("click", () => {
        selected.add(option.id);
        search.value = "";
        renderChips();
        renderMenu();
        search.focus();
      });
      menu.append(row);
    }

    menu.hidden = false;
  };

  search.addEventListener("focus", renderMenu);
  search.addEventListener("input", renderMenu);
  search.addEventListener("blur", () => {
    // Let a click on a menu row register before the menu closes.
    setTimeout(() => {
      menu.hidden = true;
    }, 150);
  });

  wrap.append(chips, search, menu);
  return wrap;
}

async function refresh(): Promise<void> {
  if (!outlet) return;

  const response = await chrome.runtime.sendMessage({ type: "snapshots/list" });
  const list: StorageSnapshot[] = Array.isArray(response?.snapshots)
    ? response.snapshots
    : [];

  outlet.textContent = "";

  if (list.length === 0) {
    outlet.append(
      emptyState(
        "No snapshots yet",
        "Press New snapshot to capture the current tab's storage.",
      ),
    );
    return;
  }

  const container = document.createElement("div");
  container.className = "rec-list";
  for (const snapshot of list) container.append(snapshotCard(snapshot));
  outlet.append(container);
}

function snapshotCard(snapshot: StorageSnapshot): HTMLElement {
  const card = document.createElement("div");
  card.className = "snap-item";

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
  const countRow = document.createElement("div");
  countRow.className = "snap-counts";
  countRow.append(
    node("span", "snap-count", `${counts.local} localStorage`),
    node("span", "snap-count", `${counts.session} sessionStorage`),
    node("span", "snap-count", `${counts.cookies} cookies`),
  );
  card.append(countRow);

  const actions = document.createElement("div");
  actions.className = "rec-actions";
  actions.append(
    button("Switch to this", () => void restore(snapshot)),
    button("Rename", () => {
      renamingId = snapshot.id;
      confirmingId = null;
      void refresh();
    }),
    button(
      "Delete",
      () => {
        confirmingId = snapshot.id;
        renamingId = null;
        void refresh();
      },
      true,
    ),
  );
  card.append(actions);

  if (confirmingId === snapshot.id) card.append(confirmRow(snapshot));
  if (renamingId === snapshot.id) card.append(renameForm(snapshot));

  return card;
}

function confirmRow(snapshot: StorageSnapshot): HTMLElement {
  const row = document.createElement("div");
  row.className = "rec-confirm";
  row.append(
    node(
      "span",
      undefined,
      `Delete "${snapshot.name}"? This cannot be undone. `,
    ),
  );

  const actions = document.createElement("div");
  actions.className = "rec-actions";
  actions.append(
    button("Cancel", () => {
      confirmingId = null;
      void refresh();
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

function renameForm(snapshot: StorageSnapshot): HTMLElement {
  const form = document.createElement("div");
  form.className = "rec-form";

  const input = document.createElement("input");
  input.type = "text";
  input.value = snapshot.name;

  const error = document.createElement("span");
  error.className = "rec-error";

  form.append(input, error);

  const actions = document.createElement("div");
  actions.className = "rec-actions";
  actions.append(
    button("Save", async () => {
      const problem = validateSnapshotName(input.value);
      if (problem) {
        error.textContent = problem;
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "snapshots/rename",
        id: snapshot.id,
        name: input.value,
      });

      if (response?.ok !== true) {
        error.textContent = String(response?.error ?? "Could not rename.");
        return;
      }

      renamingId = null;
      await refresh();
    }),
    button("Cancel", () => {
      renamingId = null;
      void refresh();
    }),
  );
  form.append(actions);
  return form;
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

function fieldLabel(text: string, input: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "snap-field-label";
  label.textContent = text;
  if (input.id) label.htmlFor = input.id;
  return label;
}

function button(
  text: string,
  onClick: () => void | Promise<void>,
  danger = false,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = text;
  if (danger) el.classList.add("danger");
  el.addEventListener("click", () => void onClick());
  return el;
}

function emptyState(title: string, detail: string): HTMLElement {
  const state = document.createElement("div");
  state.className = "state";
  state.append(node("strong", undefined, title), node("span", undefined, detail));
  return state;
}

function node(tag: string, className?: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
