// src/content/page-scan.ts
// Collects a deterministic DOM snapshot (PageFact) of the current page on
// demand. The side panel asks for it through the background service worker
// via chrome.tabs.sendMessage({ type: "api-qa/collect-page" }).
(() => {
  const MESSAGE_TYPE = "api-qa/collect-page";
  const SAMPLE_LIMIT = 20;

  const pageUrl = location.href;
  const pageOrigin = location.origin;
  const isHttps = location.protocol === "https:";

  const resolve = (value: string | null): URL | null => {
    if (!value) return null;
    try {
      return new URL(value, pageUrl);
    } catch {
      return null;
    }
  };

  const isCrossOrigin = (url: URL | null): boolean =>
    url !== null && url.origin !== pageOrigin;

  const cap = <T>(items: T[]): T[] => items.slice(0, SAMPLE_LIMIT);

  const query = (selector: string): Element[] => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  const collectMixedContent = (): string[] => {
    if (!isHttps) return [];

    const found = new Set<string>();

    for (const el of query(
      "img[src],script[src],link[href],iframe[src],video[src],audio[src],source[src],object[data],embed[src]",
    )) {
      const raw =
        el.getAttribute("src") ??
        el.getAttribute("href") ??
        el.getAttribute("data") ??
        "";
      if (/^http:\/\//i.test(raw.trim())) found.add(raw.trim());
    }

    try {
      for (const entry of performance.getEntriesByType("resource")) {
        if (/^http:\/\//i.test(entry.name)) found.add(entry.name);
      }
    } catch {
      /* performance API unavailable */
    }

    return cap(Array.from(found));
  };

  const collectInsecurePasswordForm = (): boolean => {
    const fields = query("input[type=password]");
    if (!fields.length) return false;
    if (!isHttps) return true;

    return fields.some((field) => {
      const form = (field as HTMLInputElement).form;
      const action = resolve(form?.getAttribute("action") ?? pageUrl);
      if (!action) return false;
      return action.protocol === "http:" || action.origin !== pageOrigin;
    });
  };

  const collectScriptsWithoutSri = (): string[] =>
    cap(
      query("script[src]")
        .filter((el) => {
          const url = resolve(el.getAttribute("src"));
          return isCrossOrigin(url) && !el.hasAttribute("integrity");
        })
        .map((el) => el.getAttribute("src") ?? ""),
    );

  const collectStylesheetsWithoutSri = (): string[] =>
    cap(
      query("link[rel~=stylesheet][href]")
        .filter((el) => {
          const url = resolve(el.getAttribute("href"));
          return isCrossOrigin(url) && !el.hasAttribute("integrity");
        })
        .map((el) => el.getAttribute("href") ?? ""),
    );

  const collectIframesWithoutSandbox = (): string[] =>
    cap(
      query("iframe[src]")
        .filter((el) => {
          const url = resolve(el.getAttribute("src"));
          return isCrossOrigin(url) && !el.hasAttribute("sandbox");
        })
        .map((el) => el.getAttribute("src") ?? ""),
    );

  const collectBlankLinks = (): string[] =>
    cap(
      query("a[target=_blank]")
        .filter((el) => {
          const rel = (el.getAttribute("rel") ?? "").toLowerCase();
          return !rel.includes("noopener") && !rel.includes("noreferrer");
        })
        .map((el) => el.getAttribute("href") ?? "(no href)"),
    );

  const collectInlineHandlers = (): string[] => {
    const samples: string[] = [];

    for (const el of query("*")) {
      for (const attr of Array.from(el.attributes)) {
        if (/^on[a-z]+$/i.test(attr.name)) {
          samples.push(`<${el.tagName.toLowerCase()} ${attr.name}>`);
          if (samples.length >= SAMPLE_LIMIT) return samples;
        }
      }
    }

    return samples;
  };

  const collectJavascriptUris = (): string[] =>
    cap(
      query('[href^="javascript:"],[src^="javascript:"]').map(
        (el) =>
          el.getAttribute("href") ?? el.getAttribute("src") ?? "javascript:",
      ),
    );

  const collectAutocompleteFields = (): string[] =>
    cap(
      query(
        "input[type=password],input[autocomplete^=cc-],input[name*=card],input[name*=cvv]",
      )
        .filter((el) => {
          const value = (el.getAttribute("autocomplete") ?? "").toLowerCase();
          return value !== "off" && value !== "new-password";
        })
        .map(
          (el) =>
            `${el.getAttribute("name") ?? el.getAttribute("id") ?? "field"} (${
              el.getAttribute("type") ?? "text"
            })`,
        ),
    );

  const metaReferrer = (): string | undefined => {
    const meta = document.querySelector("meta[name=referrer]");
    return meta?.getAttribute("content") ?? undefined;
  };

  const SEARCH_MESSAGE_TYPE = "api-qa/collect-search";
  const SEARCH_HTML_MAX = 3_000_000;
  const SEARCH_VALUE_MAX = 200_000;

  const readStore = (store: Storage | null): Array<[string, string]> => {
    const entries: Array<[string, string]> = [];

    try {
      if (!store) return entries;

      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key === null) continue;
        entries.push([
          key,
          String(store.getItem(key) ?? "").slice(0, SEARCH_VALUE_MAX),
        ]);
      }
    } catch {
      /* storage disabled in this context */
    }

    return entries;
  };

  const STORAGE_MESSAGE_TYPE = "api-qa/collect-storage";
  const APPLY_MESSAGE_TYPE = "api-qa/apply-storage";
  const STORAGE_VALUE_MAX = 512 * 1024;

  const readStorageFull = (store: Storage | null): Array<[string, string]> => {
    const entries: Array<[string, string]> = [];

    try {
      if (!store) return entries;

      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key === null) continue;
        entries.push([
          key,
          String(store.getItem(key) ?? "").slice(0, STORAGE_VALUE_MAX),
        ]);
      }
    } catch {
      /* storage disabled in this context */
    }

    return entries;
  };

  const collectStorage = () => ({
    url: pageUrl,
    origin: pageOrigin,
    local: readStorageFull(safeStorage(() => window.localStorage)),
    session: readStorageFull(safeStorage(() => window.sessionStorage)),
  });

  const applyStorage = (payload: {
    local?: Array<[string, string]>;
    session?: Array<[string, string]>;
  }) => {
    const write = (
      get: () => Storage,
      entries: Array<[string, string]> | undefined,
    ): { written: number; error?: string } => {
      const store = safeStorage(get);
      if (!store) return { written: 0, error: "unavailable" };

      try {
        store.clear();
        let written = 0;
        for (const [key, value] of entries ?? []) {
          store.setItem(key, value);
          written += 1;
        }
        return { written };
      } catch (error) {
        return { written: 0, error: String(error) };
      }
    };

    return {
      ok: true,
      local: write(() => window.localStorage, payload.local),
      session: write(() => window.sessionStorage, payload.session),
    };
  };

  const collectSearch = () => {
    let html = "";
    try {
      html = document.documentElement.outerHTML.slice(0, SEARCH_HTML_MAX);
    } catch {
      /* detached document */
    }

    let inlineScripts: string[] = [];
    try {
      inlineScripts = Array.from(document.querySelectorAll("script:not([src])"))
        .map((el) => (el.textContent ?? "").trim())
        .filter((text) => text.length > 0)
        .map((text) => text.slice(0, SEARCH_VALUE_MAX));
    } catch {
      /* ignore */
    }

    return {
      url: pageUrl,
      html,
      inlineScripts,
      documentCookie: (() => {
        try {
          return document.cookie;
        } catch {
          return "";
        }
      })(),
      local: readStore(safeStorage(() => window.localStorage)),
      session: readStore(safeStorage(() => window.sessionStorage)),
    };
  };

  const safeStorage = (get: () => Storage): Storage | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };

  const collect = () => ({
    url: pageUrl,
    scheme: location.protocol,
    insecurePasswordForm: collectInsecurePasswordForm(),
    mixedContent: collectMixedContent(),
    scriptsWithoutSri: collectScriptsWithoutSri(),
    stylesheetsWithoutSri: collectStylesheetsWithoutSri(),
    iframesWithoutSandbox: collectIframesWithoutSandbox(),
    blankLinksWithoutNoopener: collectBlankLinks(),
    inlineEventHandlerSamples: collectInlineHandlers(),
    javascriptUriSamples: collectJavascriptUris(),
    autocompleteOnSensitiveFields: collectAutocompleteFields(),
    metaReferrer: metaReferrer(),
  });

  const KNOWN_TYPES = new Set([
    MESSAGE_TYPE,
    SEARCH_MESSAGE_TYPE,
    STORAGE_MESSAGE_TYPE,
    APPLY_MESSAGE_TYPE,
  ]);

  const respondTo = (message: any): unknown => {
    switch (message.type) {
      case SEARCH_MESSAGE_TYPE:
        return collectSearch();
      case STORAGE_MESSAGE_TYPE:
        return collectStorage();
      case APPLY_MESSAGE_TYPE:
        return applyStorage({
          local: message.local,
          session: message.session,
        });
      default:
        return collect();
    }
  };

  chrome.runtime.onMessage.addListener(
    (message: any, _sender: any, sendResponse: (response: unknown) => void) => {
      if (!KNOWN_TYPES.has(message?.type)) {
        return undefined;
      }

      try {
        sendResponse(respondTo(message));
      } catch (error) {
        sendResponse({ error: String(error) });
      }

      return true;
    },
  );
})();
