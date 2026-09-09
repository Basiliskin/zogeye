// src/background/snapshot-handlers.ts
// Glue for the "Snapshots" tab: reads and re-applies the active tab's
// localStorage / sessionStorage (via the page-scan content script) and its
// cookies (via chrome.cookies). The pure shaping / filtering / validation
// lives in domain/storage-snapshot; storage lives in SnapshotStore.
import type { SnapshotStore } from "../infrastructure/snapshot-store.js";
import {
  createSnapshot,
  renameSnapshot,
  updateSnapshotMeta,
  updateSnapshotCapture,
  putSnapshotEntry,
  deleteSnapshotEntry,
  newCookieForOrigin,
  cookieUrl,
  SnapshotNameError,
  type PutSnapshotEntryInput,
  type SnapshotArea,
  type SnapshotCookie,
  type StorageCapture,
  type StorageEntry,
  type StorageSnapshot,
} from "../domain/snapshot/storage-snapshot.js";

interface PageStorage {
  origin?: string;
  url?: string;
  local?: StorageEntry[];
  session?: StorageEntry[];
  error?: string;
}

async function collectPageStorage(
  tabId: number,
): Promise<PageStorage | undefined> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "api-qa/collect-storage",
    });

    return response && typeof response === "object" && !response.error
      ? (response as PageStorage)
      : undefined;
  } catch {
    // chrome:// page, no content script, etc.
    return undefined;
  }
}

function toSnapshotCookie(cookie: {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  hostOnly: boolean;
  session: boolean;
  expirationDate?: number;
}): SnapshotCookie {
  const base: SnapshotCookie = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite ?? "unspecified",
    hostOnly: Boolean(cookie.hostOnly),
    session: Boolean(cookie.session),
  };

  return typeof cookie.expirationDate === "number"
    ? { ...base, expirationDate: cookie.expirationDate }
    : base;
}

async function captureStorage(
  tabId: number,
): Promise<StorageCapture | undefined> {
  const page = await collectPageStorage(tabId);

  let tabUrl: string | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = tab?.url;
  } catch {
    /* tab gone */
  }

  const url = page?.url ?? tabUrl;

  if (!url || !/^https?:/i.test(url)) {
    return undefined;
  }

  let cookies: SnapshotCookie[] = [];
  try {
    const raw = await chrome.cookies.getAll({ url });
    cookies = raw.map(toSnapshotCookie);
  } catch {
    /* "cookies" permission missing or restricted URL */
  }

  return {
    origin: page?.origin ?? new URL(url).origin,
    url,
    local: page?.local ?? [],
    session: page?.session ?? [],
    cookies,
  };
}

async function applyCookies(
  cookies: SnapshotCookie[],
): Promise<{ set: number; failed: number }> {
  let set = 0;
  let failed = 0;

  for (const cookie of cookies) {
    const details: Record<string, unknown> = {
      url: cookieUrl(cookie),
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
    };

    if (!cookie.hostOnly) {
      details.domain = cookie.domain;
    }

    if (!cookie.session && typeof cookie.expirationDate === "number") {
      details.expirationDate = cookie.expirationDate;
    }

    try {
      const result = await chrome.cookies.set(details);
      if (result) set += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  return { set, failed };
}

async function clearCookies(url: string): Promise<void> {
  try {
    const current = await chrome.cookies.getAll({ url });

    for (const cookie of current) {
      const removeUrl = cookieUrl(toSnapshotCookie(cookie));
      try {
        await chrome.cookies.remove({ url: removeUrl, name: cookie.name });
      } catch {
        /* best effort */
      }
    }
  } catch {
    /* nothing to clear */
  }
}

async function restoreSnapshot(
  tabId: number,
  snapshot: StorageSnapshot,
): Promise<unknown> {
  let tabUrl: string | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = tab?.url;
  } catch {
    return { ok: false, error: "The tab is no longer open." };
  }

  if (!tabUrl || !/^https?:/i.test(tabUrl)) {
    return { ok: false, error: "Cannot restore into this tab." };
  }

  const currentOrigin = new URL(tabUrl).origin;
  const warnings: string[] = [];

  if (currentOrigin !== snapshot.origin) {
    warnings.push(
      `Snapshot was taken on ${snapshot.origin}; the tab is now on ${currentOrigin}.`,
    );
  }

  // Cookies: real "switch" — drop what's there, then lay the snapshot down.
  await clearCookies(tabUrl);
  const cookieResult = await applyCookies(snapshot.cookies);
  if (cookieResult.failed > 0) {
    warnings.push(`${cookieResult.failed} cookie(s) could not be set.`);
  }

  // localStorage / sessionStorage: handed to the page-scan content script.
  let storageResult: unknown = {
    local: { written: 0 },
    session: { written: 0 },
  };
  try {
    storageResult = await chrome.tabs.sendMessage(tabId, {
      type: "api-qa/apply-storage",
      local: snapshot.local,
      session: snapshot.session,
    });
  } catch {
    warnings.push(
      "localStorage / sessionStorage was not applied — reload the tab and try again.",
    );
  }

  try {
    await chrome.tabs.reload(tabId);
  } catch {
    /* non-fatal */
  }

  return {
    ok: true,
    cookies: cookieResult,
    storage: storageResult,
    warnings,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function fail(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof SnapshotNameError ? error.message : String(error),
  };
}

const STORAGE_AREAS: SnapshotArea[] = [
  "localStorage",
  "sessionStorage",
  "cookies",
];

function entryInput(
  snapshot: StorageSnapshot,
  area: SnapshotArea,
  key: string,
  value: string,
): PutSnapshotEntryInput {
  if (area === "cookies") {
    const existing = snapshot.cookies.find((cookie) => cookie.name === key);

    return {
      area: "cookies",
      cookie: existing
        ? { ...existing, value }
        : newCookieForOrigin(snapshot.origin, key, value),
    };
  }

  return { area, key, value };
}

export async function handleSnapshotMessage(
  message: { type: string; [key: string]: unknown },
  store: SnapshotStore,
): Promise<unknown> {
  switch (message.type) {
    case "snapshots/inventory": {
      if (typeof message.tabId !== "number") {
        return { ok: false, error: "No active tab." };
      }

      const capture = await captureStorage(message.tabId);

      return capture
        ? { ok: true, capture }
        : { ok: false, error: "Storage is unavailable on this tab." };
    }

    case "snapshots/list":
      return { ok: true, snapshots: await store.list() };

    case "snapshots/create": {
      if (typeof message.tabId !== "number") {
        return { ok: false, error: "No active tab." };
      }

      const capture = await captureStorage(message.tabId);

      if (!capture) {
        return { ok: false, error: "Storage is unavailable on this tab." };
      }

      try {
        const snapshot = createSnapshot({
          id: crypto.randomUUID(),
          name: str(message.name),
          capture,
          selectedItemIds: strList(message.selectedItemIds),
          notes: str(message.notes),
          labels: strList(message.labels),
          now: Date.now(),
        });
        await store.save(snapshot);

        return { ok: true, snapshot };
      } catch (error) {
        return fail(error);
      }
    }

    case "snapshots/update": {
      if (typeof message.tabId !== "number") {
        return { ok: false, error: "No active tab." };
      }

      const existing = await store.get(String(message.id));

      if (!existing) {
        return { ok: false, error: "Snapshot not found." };
      }

      const capture = await captureStorage(message.tabId);

      if (!capture) {
        return { ok: false, error: "Storage is unavailable on this tab." };
      }

      try {
        const next = updateSnapshotCapture(
          existing,
          capture,
          strList(message.selectedItemIds),
          Date.now(),
        );
        await store.save(next);

        return { ok: true, snapshot: next };
      } catch (error) {
        return fail(error);
      }
    }

    case "snapshots/rename": {
      const existing = await store.get(String(message.id));

      if (!existing) {
        return { ok: false, error: "Snapshot not found." };
      }

      try {
        const next = renameSnapshot(existing, str(message.name), Date.now());
        await store.save(next);

        return { ok: true, snapshot: next };
      } catch (error) {
        return fail(error);
      }
    }

    case "snapshots/update-meta": {
      const existing = await store.get(String(message.id));

      if (!existing) {
        return { ok: false, error: "Snapshot not found." };
      }

      try {
        const next = updateSnapshotMeta(
          existing,
          {
            name: typeof message.name === "string" ? message.name : undefined,
            notes:
              typeof message.notes === "string" ? message.notes : undefined,
            labels: strList(message.labels),
          },
          Date.now(),
        );
        await store.save(next);

        return { ok: true, snapshot: next };
      } catch (error) {
        return fail(error);
      }
    }

    case "snapshots/put-entry": {
      const existing = await store.get(String(message.id));

      if (!existing) {
        return { ok: false, error: "Snapshot not found." };
      }

      const area = str(message.area) as SnapshotArea;

      if (!STORAGE_AREAS.includes(area)) {
        return { ok: false, error: "Unknown storage area." };
      }

      try {
        const next = putSnapshotEntry(
          existing,
          entryInput(existing, area, str(message.key), str(message.value)),
          Date.now(),
        );
        await store.save(next);

        return { ok: true, snapshot: next };
      } catch (error) {
        return fail(error);
      }
    }

    case "snapshots/delete-entry": {
      const existing = await store.get(String(message.id));

      if (!existing) {
        return { ok: false, error: "Snapshot not found." };
      }

      const area = str(message.area) as SnapshotArea;

      if (!STORAGE_AREAS.includes(area)) {
        return { ok: false, error: "Unknown storage area." };
      }

      const next = deleteSnapshotEntry(
        existing,
        area,
        str(message.key),
        Date.now(),
      );
      await store.save(next);

      return { ok: true, snapshot: next };
    }

    case "snapshots/delete":
      await store.delete(String(message.id));
      return { ok: true };

    case "snapshots/restore": {
      if (typeof message.tabId !== "number") {
        return { ok: false, error: "No active tab." };
      }

      const snapshot = await store.get(String(message.id));

      if (!snapshot) {
        return { ok: false, error: "Snapshot not found." };
      }

      return restoreSnapshot(message.tabId, snapshot);
    }

    default:
      return { ok: false, error: "Unknown snapshot message." };
  }
}
