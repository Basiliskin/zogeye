// src/infrastructure/snapshot-store.ts
import type { StorageSnapshot } from "../domain/snapshot/storage-snapshot.js";

const KEY = "api-qa.storage-snapshots";

/**
 * Persists storage snapshots in `chrome.storage.local` as a single id-keyed
 * map. Mirrors {@link RecordingStore}: no caching, every call reads and writes
 * the whole map.
 */
export class SnapshotStore {
  async list(): Promise<StorageSnapshot[]> {
    const map = await this.readMap();

    return Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StorageSnapshot | undefined> {
    const map = await this.readMap();

    return map[id];
  }

  async save(snapshot: StorageSnapshot): Promise<void> {
    const map = await this.readMap();

    map[snapshot.id] = snapshot;

    await chrome.storage.local.set({ [KEY]: map });
  }

  async delete(id: string): Promise<void> {
    const map = await this.readMap();

    if (map[id] === undefined) {
      return;
    }

    delete map[id];

    await chrome.storage.local.set({ [KEY]: map });
  }

  private async readMap(): Promise<Record<string, StorageSnapshot>> {
    const data = await chrome.storage.local.get(KEY);

    return (data[KEY] ?? {}) as Record<string, StorageSnapshot>;
  }
}
