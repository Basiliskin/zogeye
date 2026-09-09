// src/infrastructure/snapshot-store.int.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SnapshotStore } from "./snapshot-store.js";
import {
  createSnapshot,
  type StorageCapture,
  type StorageSnapshot,
} from "../domain/snapshot/storage-snapshot.js";

// Minimal in-memory stand-in for chrome.storage.local — enough surface for
// the store under test (get/set of a single key).
function installChromeShim(): void {
  let box: Record<string, unknown> = {};

  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string) =>
          Promise.resolve(
            key in box ? { [key]: box[key] } : ({} as Record<string, unknown>),
          ),
        set: (entries: Record<string, unknown>) => {
          box = { ...box, ...entries };
          return Promise.resolve();
        },
      },
    },
  };
}

const capture: StorageCapture = {
  origin: "https://a.example",
  url: "https://a.example/app",
  local: [["k", "v"]],
  session: [],
  cookies: [],
};

const snap = (id: string, now: number): StorageSnapshot =>
  createSnapshot({ id, name: `Snap ${id}`, capture, now });

describe("SnapshotStore", () => {
  let store: SnapshotStore;

  beforeEach(() => {
    installChromeShim();
    store = new SnapshotStore();
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("returns an empty list when nothing was saved", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("saves, reads back and upserts by id", async () => {
    await store.save(snap("a", 10));
    await store.save(snap("b", 20));
    await store.save({ ...snap("a", 30), name: "Renamed" });

    expect(await store.get("a")).toMatchObject({ name: "Renamed" });
    expect(await store.list()).toHaveLength(2);
  });

  it("lists newest-updated first", async () => {
    await store.save(snap("old", 10));
    await store.save(snap("new", 99));

    expect((await store.list()).map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("hydrates legacy records that lack notes / labels", async () => {
    const legacy = { ...snap("legacy", 5) } as Record<string, unknown>;
    delete legacy.notes;
    delete legacy.labels;
    await chrome.storage.local.set({
      "api-qa.storage-snapshots": { legacy },
    });

    expect(await store.get("legacy")).toMatchObject({ notes: "", labels: [] });
    expect((await store.list())[0]).toMatchObject({ notes: "", labels: [] });
  });

  it("deletes by id and is a no-op for an unknown id", async () => {
    await store.save(snap("a", 10));

    await store.delete("missing");
    expect(await store.list()).toHaveLength(1);

    await store.delete("a");
    expect(await store.list()).toEqual([]);
  });
});
