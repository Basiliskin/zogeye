// src/content/relay.ts
(() => {
  const targetOrigin =
    location.origin && location.origin !== "null" ? location.origin : "*";

  chrome.runtime.onMessage.addListener(
    (message: any, _sender: any, sendResponse: (response: unknown) => void) => {
      if (message?.type !== "api-qa/replay-graphql") return;

      const requestId = crypto.randomUUID();
      function onResult(event: MessageEvent): void {
        if (
          event.source !== window ||
          event.data?.source !== "api-qa-replay" ||
          event.data.requestId !== requestId
        ) {
          return;
        }

        window.removeEventListener("message", onResult);
        if (timeout !== undefined) window.clearTimeout(timeout);
        sendResponse(event.data.result);
      }

      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onResult);
        sendResponse({ ok: false, error: "GraphQL request timed out." });
      }, 30000);
      window.addEventListener("message", onResult);
      window.postMessage(
        {
          source: "api-qa-command",
          type: message.type,
          requestId,
          request: message.request,
        },
        targetOrigin,
      );

      return true;
    },
  );

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.data?.source !== "api-qa-hook") {
      return;
    }

    try {
      void chrome.runtime
        .sendMessage({
          type: "api-qa/request",
          request: event.data.request,
        })
        .catch(() => undefined);
    } catch {}
  });
})();
