// src/content/relay.ts
(() => {
  window.addEventListener("message", (event: MessageEvent) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.source !== "api-qa-hook"
    ) {
      return;
    }

    try {
      const result = chrome.runtime.sendMessage({
        type: "api-qa/request",
        request: event.data.request,
      });

      if (result?.catch) {
        result.catch(() => {});
      }
    } catch {}
  });
})();
