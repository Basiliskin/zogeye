// src/content/network-hook.ts
(() => {
  const SOURCE = "api-qa-hook";
  const MAX_BODY = 2000;
  const CAPTURE_REALTIME_MESSAGES = true;
  const MAX_REALTIME_MESSAGES = 20;

  const targetOrigin =
    location.origin && location.origin !== "null" ? location.origin : "*";

  const send = (request: unknown): void => {
    try {
      window.postMessage({ source: SOURCE, request }, targetOrigin);
    } catch {}
  };

  const normalizeHeaders = (input: any): Record<string, string> => {
    const headers: Record<string, string> = {};

    try {
      if (!input) return headers;

      if (typeof input.forEach === "function") {
        input.forEach((value: string, key: string) => {
          headers[String(key).toLowerCase()] = String(value);
        });

        return headers;
      }

      if (Array.isArray(input)) {
        for (const [key, value] of input) {
          headers[String(key).toLowerCase()] = String(value);
        }

        return headers;
      }

      for (const [key, value] of Object.entries(input)) {
        headers[String(key).toLowerCase()] = String(value);
      }
    } catch {}

    return headers;
  };

  const bodyPreview = (body: any): string | undefined => {
    if (typeof body === "string") {
      return body.slice(0, MAX_BODY);
    }

    if (body instanceof URLSearchParams) {
      return body.toString().slice(0, MAX_BODY);
    }

    return undefined;
  };

  const originalFetch = window.fetch.bind(window);

  (window as any).fetch = async function (
    input: any,
    init?: any,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : String(input?.url ?? "");

    const method = String(
      init?.method ??
        (typeof input === "object" ? input?.method : "GET") ??
        "GET",
    ).toUpperCase();

    const requestHeaders = normalizeHeaders(
      init?.headers ?? (typeof input === "object" ? input?.headers : undefined),
    );

    const body = bodyPreview(init?.body);
    const timestamp = Date.now();
    const startedAt = performance.now();

    try {
      const response = await originalFetch(input, init);
      const responseHeaders: Record<string, string> = {};

      try {
        response.headers.forEach((value: string, key: string) => {
          responseHeaders[String(key).toLowerCase()] = String(value);
        });
      } catch {}

      send({
        url,
        method,
        requestHeaders,
        responseStatus: response.status,
        responseHeaders,
        body,
        source: "fetch",
        timestamp,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return response;
    } catch (error) {
      send({
        url,
        method,
        requestHeaders,
        body,
        source: "fetch-error",
        timestamp,
        durationMs: Math.round(performance.now() - startedAt),
      });

      throw error;
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  const xhrState = new WeakMap<
    object,
    {
      method: string;
      url: string;
      requestHeaders: Record<string, string>;
      startedAt: number;
    }
  >();

  (XMLHttpRequest.prototype as any).open = function (
    this: any,
    ...args: any[]
  ) {
    xhrState.set(this, {
      method: String(args[0] ?? "GET").toUpperCase(),
      url: String(args[1] ?? ""),
      requestHeaders: {},
      startedAt: 0,
    });

    return Reflect.apply(originalOpen, this, args);
  };

  (XMLHttpRequest.prototype as any).setRequestHeader = function (
    this: any,
    name: string,
    value: string,
  ) {
    const state = xhrState.get(this);

    if (state) {
      state.requestHeaders[String(name).toLowerCase()] = String(value);
    }

    return originalSetRequestHeader.apply(this, [name, value]);
  };

  (XMLHttpRequest.prototype as any).send = function (this: any, body?: any) {
    const state = xhrState.get(this);

    if (state) {
      state.startedAt = performance.now();

      this.addEventListener("loadend", () => {
        const responseHeaders: Record<string, string> = {};

        try {
          const raw = this.getAllResponseHeaders();

          for (const line of String(raw).split(/\r?\n/)) {
            const index = line.indexOf(":");

            if (index > 0) {
              responseHeaders[line.slice(0, index).trim().toLowerCase()] = line
                .slice(index + 1)
                .trim();
            }
          }
        } catch {}

        send({
          url: state.url,
          method: state.method,
          requestHeaders: state.requestHeaders,
          responseStatus: this.status,
          responseHeaders,
          body: bodyPreview(body),
          source: "xhr",
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - state.startedAt),
        });
      });
    }

    return originalSend.apply(this, [body]);
  };

  const originalSendBeacon = navigator.sendBeacon?.bind(navigator);

  if (originalSendBeacon) {
    (navigator as any).sendBeacon = function (url: string | URL, data?: any) {
      send({
        url: String(url),
        method: "POST",
        requestHeaders: {},
        body: bodyPreview(data),
        source: "sendBeacon",
        timestamp: Date.now(),
      });

      return originalSendBeacon(url as any, data);
    };
  }

  if (window.WebSocket) {
    const OriginalWebSocket = window.WebSocket;

    (window as any).WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols as any);

        const wsUrl = String(url);
        const protocolValue = Array.isArray(protocols)
          ? protocols.join(",")
          : String(protocols ?? "");
        const handshakeStart = performance.now();

        send({
          url: wsUrl,
          method: "WS",
          requestHeaders: {
            "sec-websocket-protocol": protocolValue,
          },
          source: "websocket",
          timestamp: Date.now(),
        });

        this.addEventListener(
          "open",
          () => {
            send({
              url: wsUrl,
              method: "WS",
              source: "websocket",
              timestamp: Date.now(),
              durationMs: Math.round(performance.now() - handshakeStart),
            });
          },
          { once: true },
        );

        const originalSocketSend = this.send.bind(this);
        let sendCount = 0;

        (this as any).send = (data: any) => {
          if (CAPTURE_REALTIME_MESSAGES && sendCount < MAX_REALTIME_MESSAGES) {
            sendCount += 1;

            send({
              url: wsUrl,
              method: "WS",
              source: "websocket-send",
              body: bodyPreview(data),
              timestamp: Date.now(),
            });
          }

          return originalSocketSend(data);
        };

        if (CAPTURE_REALTIME_MESSAGES) {
          let messageCount = 0;

          this.addEventListener("message", (event: MessageEvent) => {
            if (messageCount >= MAX_REALTIME_MESSAGES) {
              return;
            }

            messageCount += 1;

            send({
              url: wsUrl,
              method: "WS",
              source: "websocket-message",
              body: bodyPreview(event.data),
              timestamp: Date.now(),
            });
          });
        }
      }
    };
  }

  if (window.EventSource) {
    const OriginalEventSource = window.EventSource;

    (window as any).EventSource = class extends OriginalEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url as string, eventSourceInitDict);

        const sseUrl = String(url);
        const handshakeStart = performance.now();

        send({
          url: sseUrl,
          method: "SSE",
          requestHeaders: {
            "with-credentials": eventSourceInitDict?.withCredentials
              ? "true"
              : "false",
          },
          source: "eventsource",
          timestamp: Date.now(),
        });

        this.addEventListener(
          "open",
          () => {
            send({
              url: sseUrl,
              method: "SSE",
              source: "eventsource",
              timestamp: Date.now(),
              durationMs: Math.round(performance.now() - handshakeStart),
            });
          },
          { once: true },
        );

        if (CAPTURE_REALTIME_MESSAGES) {
          let messageCount = 0;

          this.addEventListener("message", (event: MessageEvent) => {
            if (messageCount >= MAX_REALTIME_MESSAGES) {
              return;
            }

            messageCount += 1;

            send({
              url: sseUrl,
              method: "SSE",
              source: "sse-message",
              body: bodyPreview(event.data),
              timestamp: Date.now(),
            });
          });
        }
      }
    };
  }
})();
