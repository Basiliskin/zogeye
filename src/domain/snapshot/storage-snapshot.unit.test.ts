// src/domain/storage-snapshot.unit.test.ts
import { describe, expect, it } from "vitest";
import {
  collectLabels,
  cookieUrl,
  createSnapshot,
  deleteSnapshotEntry,
  filterSnapshots,
  findSnapshotForUrl,
  hydrateSnapshot,
  itemId,
  listSnapshotEntries,
  newCookieForOrigin,
  normalizeLabels,
  parseLabels,
  putSnapshotEntry,
  renameSnapshot,
  snapshotCounts,
  SnapshotNameError,
  updateSnapshotCapture,
  updateSnapshotMeta,
  validateSnapshotName,
  type PutSnapshotEntryInput,
  type SnapshotCookie,
  type SnapshotEntryView,
  type SnapshotFilter,
  type StorageCapture,
  type StorageSnapshot,
} from "./storage-snapshot.js";

const cookie = (over: Partial<SnapshotCookie> = {}): SnapshotCookie => ({
  name: "sid",
  value: "abc",
  domain: ".example.com",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax",
  hostOnly: false,
  session: false,
  expirationDate: 1000,
  ...over,
});

const capture = (over: Partial<StorageCapture> = {}): StorageCapture => ({
  origin: "https://example.com",
  url: "https://example.com/app",
  local: [
    ["token", "t1"],
    ["theme", "dark"],
  ],
  session: [["draft", "hello"]],
  cookies: [cookie(), cookie({ name: "csrf", value: "z" })],
  ...over,
});

describe("validateSnapshotName", () => {
  it("accepts a non-empty name", () => {
    expect(validateSnapshotName("Logged in as admin")).toBeNull();
  });

  it("rejects blank and over-long names", () => {
    expect(validateSnapshotName("   ")).toMatch(/required/i);
    expect(validateSnapshotName("x".repeat(81))).toMatch(/80/);
  });
});

describe("createSnapshot", () => {
  it("keeps everything and marks scope 'all' when no selection is given", () => {
    const snap = createSnapshot({
      id: "s1",
      name: "  Full  ",
      capture: capture(),
      now: 500,
    });

    expect(snap).toMatchObject({
      id: "s1",
      name: "Full",
      scope: "all",
      origin: "https://example.com",
      createdAt: 500,
      updatedAt: 500,
    });
    expect(snapshotCounts(snap)).toEqual({
      local: 2,
      session: 1,
      cookies: 2,
      total: 5,
    });
  });

  it("filters to the selected item ids and marks scope 'selected'", () => {
    const snap = createSnapshot({
      id: "s1",
      name: "Subset",
      capture: capture(),
      selectedItemIds: [
        itemId("localStorage", "token"),
        itemId("cookies", "csrf"),
      ],
      now: 1,
    });

    expect(snap.scope).toBe("selected");
    expect(snap.local).toEqual([["token", "t1"]]);
    expect(snap.session).toEqual([]);
    expect(snap.cookies.map((c) => c.name)).toEqual(["csrf"]);
  });

  it("throws when the selection matches nothing", () => {
    expect(() =>
      createSnapshot({
        id: "s1",
        name: "Empty",
        capture: capture(),
        selectedItemIds: ["localStorage missing"],
        now: 1,
      }),
    ).toThrow(SnapshotNameError);
  });

  it("throws SnapshotNameError on a blank name", () => {
    expect(() =>
      createSnapshot({ id: "s1", name: "", capture: capture(), now: 1 }),
    ).toThrow(SnapshotNameError);
  });

  it("copies entries so later capture mutation does not leak in", () => {
    const src = capture();
    const snap = createSnapshot({ id: "s1", name: "C", capture: src, now: 1 });
    src.local.push(["late", "x"]);
    expect(snap.local).toHaveLength(2);
  });
});

describe("renameSnapshot", () => {
  it("trims the name and bumps updatedAt only", () => {
    const snap = createSnapshot({
      id: "s1",
      name: "Old",
      capture: capture(),
      now: 100,
    });
    const next = renameSnapshot(snap, "  New  ", 200);

    expect(next.name).toBe("New");
    expect(next.createdAt).toBe(100);
    expect(next.updatedAt).toBe(200);
  });

  it("throws on an invalid name", () => {
    const snap = createSnapshot({
      id: "s1",
      name: "Old",
      capture: capture(),
      now: 1,
    });
    expect(() => renameSnapshot(snap, "", 2)).toThrow(SnapshotNameError);
  });
});

describe("cookieUrl", () => {
  it("strips a leading dot and honours the secure flag", () => {
    expect(cookieUrl(cookie())).toBe("https://example.com/");
    expect(
      cookieUrl(cookie({ secure: false, domain: "api.example.com" })),
    ).toBe("http://api.example.com/");
  });

  it("defaults an empty path to '/'", () => {
    expect(cookieUrl(cookie({ path: "" }))).toBe("https://example.com/");
  });
});

const snap = (over: Partial<StorageSnapshot> = {}): StorageSnapshot =>
  createSnapshot({
    id: over.id ?? "s1",
    name: over.name ?? "Snap",
    capture: capture(),
    notes: over.notes,
    labels: over.labels,
    now: 1,
  });

describe("createSnapshot notes/labels defaults", () => {
  it("defaults notes to '' and labels to []", () => {
    const s = createSnapshot({
      id: "s1",
      name: "N",
      capture: capture(),
      now: 1,
    });
    expect(s.notes).toBe("");
    expect(s.labels).toEqual([]);
  });

  it("normalizes initial labels and trims notes", () => {
    const s = createSnapshot({
      id: "s1",
      name: "N",
      capture: capture(),
      notes: "  hi  ",
      labels: ["Auth", "auth", " "],
      now: 1,
    });
    expect(s.notes).toBe("hi");
    expect(s.labels).toEqual(["auth"]);
  });
});

describe("normalizeLabels / parseLabels", () => {
  it("trims, lower-cases, de-dupes and drops blanks", () => {
    expect(normalizeLabels([" A ", "a", "", "B"])).toEqual(["a", "b"]);
  });

  it("splits on commas and newlines", () => {
    expect(parseLabels("one, two\nthree")).toEqual(["one", "two", "three"]);
  });
});

describe("collectLabels", () => {
  it("returns the sorted union across snapshots", () => {
    const a = snap({ id: "a", labels: ["z", "a"] });
    const b = snap({ id: "b", labels: ["m"] });
    expect(collectLabels([a, b])).toEqual(["a", "m", "z"]);
  });
});

describe("hydrateSnapshot", () => {
  it("fills missing notes/labels on legacy records", () => {
    const legacy = { ...snap(), notes: undefined, labels: undefined };
    const h = hydrateSnapshot(legacy as unknown as StorageSnapshot);
    expect(h.notes).toBe("");
    expect(h.labels).toEqual([]);
  });
});

describe("updateSnapshotMeta", () => {
  it("patches name/notes/labels and bumps updatedAt only", () => {
    const s = snap();
    const next = updateSnapshotMeta(
      s,
      { name: "  New  ", notes: "  n  ", labels: ["X"] },
      99,
    );
    expect(next).toMatchObject({
      name: "New",
      notes: "n",
      labels: ["x"],
      createdAt: s.createdAt,
      updatedAt: 99,
    });
  });

  it("throws on a blank name", () => {
    expect(() => updateSnapshotMeta(snap(), { name: "" }, 2)).toThrow(
      SnapshotNameError,
    );
  });
});

describe("filterSnapshots", () => {
  const list = [
    snap({ id: "a", name: "Admin login", labels: ["auth"] }),
    snap({ id: "b", name: "Guest", labels: ["misc"] }),
  ];

  it("matches free text against metadata and stored values", () => {
    const filter: SnapshotFilter = { query: "t1" };
    expect(filterSnapshots(list, filter).map((s) => s.id)).toEqual(["a", "b"]);
    expect(filterSnapshots(list, { query: "admin" }).map((s) => s.id)).toEqual([
      "a",
    ]);
  });

  it("requires every selected label (AND)", () => {
    expect(
      filterSnapshots(list, { labels: ["auth"] }).map((s) => s.id),
    ).toEqual(["a"]);
    expect(filterSnapshots(list, { labels: ["auth", "misc"] })).toEqual([]);
  });
});

describe("findSnapshotForUrl", () => {
  it("matches the exact url", () => {
    const s = snap();
    expect(findSnapshotForUrl([s], "https://example.com/app")?.id).toBe("s1");
    expect(
      findSnapshotForUrl([s], "https://example.com/other"),
    ).toBeUndefined();
  });
});

describe("updateSnapshotCapture", () => {
  it("re-shapes the data but preserves id/name/notes/labels/createdAt", () => {
    const s = updateSnapshotMeta(snap(), { notes: "keep", labels: ["l"] }, 1);
    const next = updateSnapshotCapture(
      s,
      capture({ local: [["only", "v"]], session: [], cookies: [] }),
      undefined,
      50,
    );
    expect(next).toMatchObject({
      id: s.id,
      name: s.name,
      notes: "keep",
      labels: ["l"],
      createdAt: s.createdAt,
      updatedAt: 50,
    });
    expect(next.local).toEqual([["only", "v"]]);
  });
});

describe("listSnapshotEntries", () => {
  it("flattens local, session and cookies", () => {
    const entries: SnapshotEntryView[] = listSnapshotEntries(snap());
    expect(entries).toEqual([
      { area: "localStorage", key: "token", value: "t1" },
      { area: "localStorage", key: "theme", value: "dark" },
      { area: "sessionStorage", key: "draft", value: "hello" },
      { area: "cookies", key: "sid", value: "abc" },
      { area: "cookies", key: "csrf", value: "z" },
    ]);
  });
});

describe("putSnapshotEntry", () => {
  it("upserts a localStorage value", () => {
    const input: PutSnapshotEntryInput = {
      area: "localStorage",
      key: "token",
      value: "t2",
    };
    const next = putSnapshotEntry(snap(), input, 9);
    expect(next.local).toContainEqual(["token", "t2"]);
    expect(next.updatedAt).toBe(9);
  });

  it("appends a new sessionStorage key", () => {
    const next = putSnapshotEntry(
      snap(),
      { area: "sessionStorage", key: "fresh", value: "v" },
      9,
    );
    expect(next.session).toContainEqual(["fresh", "v"]);
  });

  it("upserts a cookie by name", () => {
    const next = putSnapshotEntry(
      snap(),
      {
        area: "cookies",
        cookie: newCookieForOrigin("https://example.com", "sid", "new"),
      },
      9,
    );
    expect(next.cookies.find((c) => c.name === "sid")?.value).toBe("new");
  });

  it("rejects a blank key", () => {
    expect(() =>
      putSnapshotEntry(
        snap(),
        { area: "localStorage", key: " ", value: "v" },
        1,
      ),
    ).toThrow(SnapshotNameError);
  });
});

describe("deleteSnapshotEntry", () => {
  it("removes a storage entry and a cookie", () => {
    const a = deleteSnapshotEntry(snap(), "localStorage", "token", 1);
    expect(a.local.map(([k]) => k)).toEqual(["theme"]);
    const b = deleteSnapshotEntry(snap(), "cookies", "sid", 1);
    expect(b.cookies.map((c) => c.name)).toEqual(["csrf"]);
  });
});

describe("newCookieForOrigin", () => {
  it("derives host and secure from the origin", () => {
    expect(newCookieForOrigin("https://a.example.com", "n", "v")).toMatchObject(
      {
        name: "n",
        value: "v",
        domain: "a.example.com",
        secure: true,
        hostOnly: true,
        session: true,
      },
    );
    expect(newCookieForOrigin("http://localhost:3000", "n", "v").secure).toBe(
      false,
    );
  });
});
