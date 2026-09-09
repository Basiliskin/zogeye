// src/sidepanel/snapshot-entries.ts
// The "Edit values" editor shown inside a snapshot card: autocomplete-search
// the stored localStorage / sessionStorage / cookie items, edit a value in
// place, delete an item, or add a new one. The background owns persistence
// (snapshots/put-entry, snapshots/delete-entry).
import {
  listSnapshotEntries,
  type SnapshotArea,
  type SnapshotEntryView,
  type StorageSnapshot,
} from "../domain/snapshot/storage-snapshot.js";
import { autocompleteMenu, button, node } from "./snapshot-dom.js";

const AREA_LABELS: Record<SnapshotArea, string> = {
  localStorage: "localStorage",
  sessionStorage: "sessionStorage",
  cookies: "cookie",
};

export function renderEntriesEditor(
  snapshot: StorageSnapshot,
  onSaved: () => void | Promise<void>,
): HTMLElement {
  const root = node("div", "snap-entries");
  const error = node("span", "snap-error");

  const entries = listSnapshotEntries(snapshot);
  const editSlot = node("div");

  const send = async (message: Record<string, unknown>): Promise<boolean> => {
    error.textContent = "";
    const response = await chrome.runtime.sendMessage({
      ...message,
      id: snapshot.id,
    });
    if (response?.ok !== true) {
      error.textContent = String(response?.error ?? "Could not save.");
      return false;
    }
    await onSaved();
    return true;
  };

  const showEdit = (entry: SnapshotEntryView): void => {
    editSlot.textContent = "";

    const row = node("div", "snap-entry-row");
    row.append(
      node(
        "span",
        "snap-entry-area",
        `${AREA_LABELS[entry.area]} · ${entry.key}`,
      ),
    );

    const value = document.createElement("textarea");
    value.value = entry.value;

    const actions = node("div", "rec-actions");
    actions.append(
      button("Save value", async () => {
        await send({
          type: "snapshots/put-entry",
          area: entry.area,
          key: entry.key,
          value: value.value,
        });
      }),
      button(
        "Delete",
        async () => {
          await send({
            type: "snapshots/delete-entry",
            area: entry.area,
            key: entry.key,
          });
        },
        true,
      ),
      button("Close", () => {
        editSlot.textContent = "";
      }),
    );

    row.append(value, actions);
    editSlot.append(row);
  };

  const picker = autocompleteMenu({
    placeholder: "Search a key, value or cookie to edit…",
    options: () =>
      entries.map((entry) => ({
        id: `${entry.area} ${entry.key}`,
        primary: `${entry.key} = ${entry.value}`,
        secondary: AREA_LABELS[entry.area],
      })),
    onPick: (id) => {
      const entry = entries.find((e) => `${e.area} ${e.key}` === id);
      if (entry) showEdit(entry);
    },
  });

  root.append(
    node("div", "snap-subhead", "Edit an existing value"),
    picker.root,
    editSlot,
    node("div", "snap-subhead", "Add an entry"),
    addRow(send),
    error,
  );

  return root;
}

function addRow(
  send: (message: Record<string, unknown>) => Promise<boolean>,
): HTMLElement {
  const row = node("div", "snap-entry-row");

  const area = document.createElement("select");
  for (const value of ["localStorage", "sessionStorage", "cookies"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = AREA_LABELS[value];
    area.append(option);
  }

  const key = document.createElement("input");
  key.type = "text";
  key.placeholder = "Key / cookie name";

  const value = document.createElement("textarea");
  value.placeholder = "Value";

  const actions = node("div", "rec-actions");
  actions.append(
    button("Add entry", async () => {
      const ok = await send({
        type: "snapshots/put-entry",
        area: area.value,
        key: key.value,
        value: value.value,
      });
      if (ok) {
        key.value = "";
        value.value = "";
      }
    }),
  );

  row.append(area, key, value, actions);
  return row;
}
