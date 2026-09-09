// src/content/recorder.ts
// Dormant interaction recorder. Injected on every page at document_start but
// idle until the background service worker arms it (either by an explicit
// "recorder/arm" message, or — after a navigation mid-recording — by the
// answer to the "recorder/should-arm" probe this script sends on load).
//
// While armed it captures a small, deterministic set of user interactions
// (click / change / keydown / submit) and forwards each as a step to the
// background, which owns the recording session and storage.
(() => {
  const MAX_TEXT = 80;
  const RECORDED_KEYS = new Set(["Enter", "Escape", "Tab"]);

  let armed = false;

  const cssPath = (el: Element): string => {
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    const parts: string[] = [];
    let node: Element | null = el;

    while (node?.nodeType === 1 && parts.length < 5) {
      const tag = node.tagName.toLowerCase();

      if (tag === "html" || tag === "body") {
        parts.unshift(tag);
        break;
      }

      const testId = node.getAttribute("data-testid");
      const name = node.getAttribute("name");

      if (testId) {
        parts.unshift(`${tag}[data-testid="${cssAttr(testId)}"]`);
        break;
      }

      let segment = tag;

      if (name) {
        segment = `${tag}[name="${cssAttr(name)}"]`;
      } else {
        const parent = node.parentElement;

        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === node?.tagName,
          );

          if (siblings.length > 1) {
            segment = `${tag}:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
        }
      }

      parts.unshift(segment);
      node = node.parentElement;
    }

    return parts.join(" > ");
  };

  const cssAttr = (value: string): string => value.replace(/["\\]/g, "\\$&");

  const textOf = (el: Element): string | undefined => {
    const raw = (el.textContent ?? "").replace(/\s+/g, " ").trim();

    if (!raw) {
      return undefined;
    }

    return raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}…` : raw;
  };

  const emit = (step: Record<string, unknown>): void => {
    try {
      const result = chrome.runtime.sendMessage({
        type: "recorder/step",
        step: { ...step, timestamp: Date.now() },
      });

      if (result?.catch) {
        result.catch(() => undefined);
      }
    } catch {}
  };

  const onClick = (event: Event): void => {
    const target = event.target as Element | null;

    if (!target || event.eventPhase === Event.NONE) {
      return;
    }

    emit({
      type: "click",
      selector: cssPath(target),
      text: textOf(target),
    });
  };

  const onChange = (event: Event): void => {
    const target = event.target as
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;

    if (!target || !("value" in target)) {
      return;
    }

    const isSecret =
      target instanceof HTMLInputElement && target.type === "password";

    emit({
      type: "change",
      selector: cssPath(target),
      value: isSecret ? "•••" : String(target.value).slice(0, MAX_TEXT),
    });
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (!RECORDED_KEYS.has(event.key)) {
      return;
    }

    const target = event.target as Element | null;

    emit({
      type: "keydown",
      selector: target ? cssPath(target) : undefined,
      key: event.key,
    });
  };

  const onSubmit = (event: Event): void => {
    const target = event.target as Element | null;

    emit({
      type: "submit",
      selector: target ? cssPath(target) : undefined,
    });
  };

  const arm = (): void => {
    if (armed) {
      return;
    }

    armed = true;
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("submit", onSubmit, true);
  };

  const disarm = (): void => {
    if (!armed) {
      return;
    }

    armed = false;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("submit", onSubmit, true);
  };

  chrome.runtime.onMessage.addListener((message: any) => {
    if (message?.type === "recorder/arm") {
      arm();
    } else if (message?.type === "recorder/disarm") {
      disarm();
    }

    return undefined;
  });

  // Re-arm after a full-document navigation that happened while recording.
  if (window === window.top) {
    try {
      const probe = chrome.runtime.sendMessage({
        type: "recorder/should-arm",
      });

      if (probe?.then) {
        probe
          .then((response: any) => {
            if (response?.arm) {
              arm();
            }
          })
          .catch(() => undefined);
      }
    } catch {}
  }
})();
