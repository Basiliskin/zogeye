// src/domain/rules/site/site-utils.ts
// Shared, side-effect-free helpers for the "current page" rule families
// (response headers, cookies, request hygiene).
import { headerValue, parseUrlSafe } from "../../web-utils.js";
import type { RequestFact } from "../../models.js";

/** The webRequest listener tags the top-level / sub-frame document response. */
export const DOCUMENT_SOURCE = "document";

export function isDocumentRequest(request: RequestFact): boolean {
  return request.source === DOCUMENT_SOURCE;
}

export function isHttpsRequest(request: RequestFact): boolean {
  return parseUrlSafe(request.url)?.protocol === "https:";
}

export function hasResponse(request: RequestFact): boolean {
  return (
    request.responseStatus !== undefined ||
    request.responseHeaders !== undefined
  );
}

export function responseHeader(
  request: RequestFact,
  name: string,
): string | undefined {
  return headerValue(request.responseHeaders, name);
}

export function requestHeader(
  request: RequestFact,
  name: string,
): string | undefined {
  return headerValue(request.requestHeaders, name);
}

/** Content-Security-Policy directive lookup (enforced policy only). */
export function cspDirective(
  policy: string,
  directive: string,
): string | undefined {
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const spaceIndex = trimmed.indexOf(" ");
    const name = (
      spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)
    ).toLowerCase();

    if (name === directive.toLowerCase()) {
      return spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();
    }
  }

  return undefined;
}

/** `max-age` seconds parsed from a header such as Strict-Transport-Security. */
export function maxAgeSeconds(headerValueText: string): number | undefined {
  const match = /max-age\s*=\s*"?(\d+)"?/i.exec(headerValueText);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export interface ParsedCookie {
  name: string;
  attributes: Set<string>;
  sameSite?: string | undefined;
}

/**
 * Splits a raw Set-Cookie header value into individual cookies. The
 * webRequest capture joins multiple Set-Cookie headers with a newline, so we
 * split on that first, never on the comma (which appears inside `Expires`).
 */
export function parseSetCookie(raw: string): ParsedCookie[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const segments = line.split(";").map((segment) => segment.trim());
      const nameValue = segments[0] ?? "";
      const attributes = new Set<string>();
      let sameSite: string | undefined;

      for (const segment of segments.slice(1)) {
        const [attrName, attrValue] = segment.split("=");
        const key = (attrName ?? "").trim().toLowerCase();
        if (!key) continue;

        attributes.add(key);
        if (key === "samesite") {
          sameSite = (attrValue ?? "").trim().toLowerCase();
        }
      }

      return {
        name: nameValue.split("=")[0]?.trim() ?? "",
        attributes,
        sameSite,
      };
    });
}

const SESSION_COOKIE_NAME = /sess|sid|token|auth|jwt|csrf|xsrf/i;

export function looksLikeSessionCookie(name: string): boolean {
  return SESSION_COOKIE_NAME.test(name);
}

/** True when `candidate` is served from a different registrable host. */
export function isCrossHost(pageUrl: string, candidate: string): boolean {
  const page = parseUrlSafe(pageUrl);
  const other = parseUrlSafe(candidate);
  if (!page || !other) return false;
  return page.host !== other.host;
}
