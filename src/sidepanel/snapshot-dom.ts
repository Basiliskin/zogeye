// src/sidepanel/snapshot-dom.ts
// Tiny DOM builders shared across the Snapshots tab modules (the list
// orchestrator, the capture form and the value editor). Deliberately the same
// shapes the module used before it was split.

export function node(
  tag: string,
  className?: string,
  text?: string,
): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

export function button(
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

export function fieldLabel(text: string, input: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "snap-field-label";
  label.textContent = text;
  if (input.id) label.htmlFor = input.id;
  return label;
}

export function emptyState(title: string, detail: string): HTMLElement {
  const state = node("div", "state");
  state.append(
    node("strong", undefined, title),
    node("span", undefined, detail),
  );
  return state;
}

export async function activeTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

export interface MenuOption {
  id: string;
  primary: string;
  secondary: string;
}

/**
 * A text input with a filtered dropdown. `options()` is re-read on every
 * keystroke so callers can exclude already-picked items; `onPick` gets the
 * chosen option id.
 */
export function autocompleteMenu(opts: {
  placeholder: string;
  options: () => MenuOption[];
  onPick: (id: string) => void;
}): { root: HTMLElement; input: HTMLInputElement; refresh: () => void } {
  const root = node("div", "snap-picker");

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = opts.placeholder;
  input.autocomplete = "off";

  const menu = node("div", "snap-menu");
  menu.hidden = true;

  const refresh = (): void => {
    const term = input.value.trim().toLowerCase();
    const matches = opts
      .options()
      .filter(
        (option) =>
          term === "" ||
          option.primary.toLowerCase().includes(term) ||
          option.secondary.toLowerCase().includes(term),
      )
      .slice(0, 50);

    menu.textContent = "";

    if (matches.length === 0) {
      menu.append(node("div", "snap-menu-empty", "No matching items."));
      menu.hidden = false;
      return;
    }

    for (const option of matches) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "snap-option";
      row.append(
        node("span", "snap-option-area", option.secondary),
        node("span", "snap-option-key", option.primary),
      );
      row.addEventListener("click", () => {
        opts.onPick(option.id);
        input.value = "";
        refresh();
        input.focus();
      });
      menu.append(row);
    }

    menu.hidden = false;
  };

  input.addEventListener("focus", refresh);
  input.addEventListener("input", refresh);
  input.addEventListener("blur", () => {
    setTimeout(() => {
      menu.hidden = true;
    }, 150);
  });

  root.append(input, menu);
  return { root, input, refresh };
}
