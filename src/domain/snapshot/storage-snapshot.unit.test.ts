// src/domain/storage-snapshot.unit.test.ts
import { describe, expect, it } from "vitest";
import {
  cookieUrl,
  createSnapshot,
  itemId,
  renameSnapshot,
  snapshotCounts,
  SnapshotNameError,
  validateSnapshotName,
  type SnapshotCookie,
  type StorageCapture,
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
    expect(cookieUrl(cookie({ secure: false, domain: "api.example.com" }))).toBe(
      "http://api.example.com/",
    );
  });

  it("defaults an empty path to '/'", () => {
    expect(cookieUrl(cookie({ path: "" }))).toBe("https://example.com/");
  });
});
