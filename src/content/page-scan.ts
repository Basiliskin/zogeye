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
      query('a[target=_blank]')
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

  chrome.runtime.onMessage.addListener(
    (message: any, _sender: any, sendResponse: (response: unknown) => void) => {
      if (message?.type !== MESSAGE_TYPE) return undefined;

      try {
        sendResponse(collect());
      } catch (error) {
        sendResponse({ error: String(error) });
      }

      return true;
    },
  );
})();
