// src/background/snapshot-handlers.unit.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSnapshotMessage } from "./snapshot-handlers.js";
import { SnapshotStore } from "../infrastructure/snapshot-store.js";
import {
  createSnapshot,
  type StorageCapture,
} from "../domain/snapshot/storage-snapshot.js";

const capture: StorageCapture = {
  origin: "https://shop.example",
  url: "https://shop.example/cart",
  local: [["token", "t1"]],
  session: [["draft", "d"]],
  cookies: [],
};

interface Shim {
  box: Record<string, unknown>;
  pageStorage: { origin: string; url: string; local: [string, string][]; session: [string, string][] };
}

function installChrome(shim: Shim): void {
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string) =>
          Promise.resolve(key in shim.box ? { [key]: shim.box[key] } : {}),
        set: (entries: Record<string, unknown>) => {
          shim.box = { ...shim.box, ...entries };
          return Promise.resolve();
        },
      },
    },
    tabs: {
      get: (_id: number) => Promise.resolve({ url: shim.pageStorage.url }),
      sendMessage: (_id: number, msg: { type: string }) => {
        if (msg.type === "api-qa/collect-storage") {
          return Promise.resolve(shim.pageStorage);
        }
        return Promise.resolve({ local: { written: 0 }, session: { written: 0 } });
      },
      reload: () => Promise.resolve(),
    },
    cookies: {
      getAll: () => Promise.resolve([]),
      set: () => Promise.resolve({}),
      remove: () => Promise.resolve({}),
    },
  };
}

describe("handleSnapshotMessage", () => {
  let store: SnapshotStore;
  let shim: Shim;

  beforeEach(() => {
    shim = {
      box: {},
      pageStorage: {
        origin: "https://shop.example",
        url: "https://shop.example/cart",
        local: [["token", "t1"]],
        session: [["draft", "d"]],
      },
    };
    installChrome(shim);
    store = new SnapshotStore();
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  const seed = async (over = {}) => {
    const snapshot = createSnapshot({
      id: "s1",
      name: "Cart",
      capture,
      now: 1,
      ...over,
    });
    await store.save(snapshot);
    return snapshot;
  };

  it("lists saved snapshots", async () => {
    await seed();
    const res = await handleSnapshotMessage({ type: "snapshots/list" }, store);
    expect(res).toMatchObject({ ok: true });
    expect((res as { snapshots: unknown[] }).snapshots).toHaveLength(1);
  });

  it("creates a snapshot from the active tab with notes and labels", async () => {
    const res = (await handleSnapshotMessage(
      { type: "snapshots/create", tabId: 7, name: "New", notes: "hi", labels: ["a", "a"] },
      store,
    )) as { ok: boolean; snapshot: { notes: string; labels: string[] } };

    expect(res.ok).toBe(true);
    expect(res.snapshot).toMatchObject({ notes: "hi", labels: ["a"] });
    expect(await store.list()).toHaveLength(1);
  });

  it("updates an existing snapshot in place, preserving metadata", async () => {
    const original = await seed({ notes: "keep" });
    shim.pageStorage.local = [["token", "t2"]];

    const res = (await handleSnapshotMessage(
      { type: "snapshots/update", id: "s1", tabId: 7 },
      store,
    )) as { ok: boolean; snapshot: { id: string; notes: string; local: [string, string][] } };

    expect(res.ok).toBe(true);
    expect(res.snapshot.id).toBe("s1");
    expect(res.snapshot.notes).toBe("keep");
    expect(res.snapshot.local).toContainEqual(["token", "t2"]);
    expect(res.snapshot).not.toEqual(original);
  });

  it("patches metadata via update-meta and rejects a blank name", async () => {
    await seed();

    const ok = await handleSnapshotMessage(
      { type: "snapshots/update-meta", id: "s1", notes: "n", labels: ["x"] },
      store,
    );
    expect(ok).toMatchObject({ ok: true, snapshot: { notes: "n", labels: ["x"] } });

    const bad = await handleSnapshotMessage(
      { type: "snapshots/update-meta", id: "s1", name: "  " },
      store,
    );
    expect(bad).toMatchObject({ ok: false });
  });

  it("adds, edits and deletes entries", async () => {
    await seed();

    await handleSnapshotMessage(
      { type: "snapshots/put-entry", id: "s1", area: "localStorage", key: "token", value: "t9" },
      store,
    );
    await handleSnapshotMessage(
      { type: "snapshots/put-entry", id: "s1", area: "cookies", key: "sid", value: "abc" },
      store,
    );

    let snap = await store.get("s1");
    expect(snap?.local).toContainEqual(["token", "t9"]);
    expect(snap?.cookies.map((c) => c.name)).toEqual(["sid"]);

    const del = await handleSnapshotMessage(
      { type: "snapshots/delete-entry", id: "s1", area: "localStorage", key: "token" },
      store,
    );
    expect(del).toMatchObject({ ok: true });
    snap = await store.get("s1");
    expect(snap?.local).toEqual([]);
  });

  it("rejects an unknown storage area", async () => {
    await seed();
    const res = await handleSnapshotMessage(
      { type: "snapshots/put-entry", id: "s1", area: "bogus", key: "k", value: "v" },
      store,
    );
    expect(res).toMatchObject({ ok: false });
  });

  it("reports a missing snapshot", async () => {
    const res = await handleSnapshotMessage(
      { type: "snapshots/update-meta", id: "nope", notes: "x" },
      store,
    );
    expect(res).toMatchObject({ ok: false, error: "Snapshot not found." });
  });

  it("deletes a snapshot", async () => {
    await seed();
    await handleSnapshotMessage({ type: "snapshots/delete", id: "s1" }, store);
    expect(await store.list()).toEqual([]);
  });
});
