// src/domain/web-utils.ts
const localHosts = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

export function parseUrlSafe(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLocalHostname(hostname: string): boolean {
  return localHosts.has(hostname);
}

export function isInsecureHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && !isLocalHostname(url.hostname);
}

export function isInsecureWsUrl(url: URL): boolean {
  return url.protocol === "ws:" && !isLocalHostname(url.hostname);
}

export function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  return headers?.[name.toLowerCase()];
}
