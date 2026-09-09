// src/infrastructure/recording-store.int.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecordingStore } from "./recording-store.js";
import { createRecording, type Recording } from "../domain/recording.js";

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

const rec = (id: string, now: number): Recording =>
  createRecording({
    id,
    title: `Flow ${id}`,
    url: "https://a.example",
    steps: [{ type: "navigate", url: "https://a.example", timestamp: now }],
    now,
  });

describe("RecordingStore", () => {
  let store: RecordingStore;

  beforeEach(() => {
    installChromeShim();
    store = new RecordingStore();
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("returns an empty list when nothing was saved", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("saves, reads back and upserts by id", async () => {
    await store.save(rec("a", 10));
    await store.save(rec("b", 20));
    await store.save({ ...rec("a", 30), title: "Renamed" });

    expect(await store.get("a")).toMatchObject({ title: "Renamed" });
    expect(await store.list()).toHaveLength(2);
  });

  it("lists newest-updated first", async () => {
    await store.save(rec("old", 10));
    await store.save(rec("new", 99));

    expect((await store.list()).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("deletes by id and is a no-op for an unknown id", async () => {
    await store.save(rec("a", 10));

    await store.delete("missing");
    expect(await store.list()).toHaveLength(1);

    await store.delete("a");
    expect(await store.list()).toEqual([]);
  });
});
