// src/infrastructure/recording-store.ts
import type { Recording } from "../domain/recording.js";

const KEY = "api-qa.recordings";

/**
 * Persists interaction recordings in `chrome.storage.local` as a single
 * id-keyed map. Mirrors {@link TabRequestStore} in style: no caching, every
 * call reads and writes the whole map.
 */
export class RecordingStore {
  async list(): Promise<Recording[]> {
    const map = await this.readMap();

    return Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Recording | undefined> {
    const map = await this.readMap();

    return map[id];
  }

  async save(recording: Recording): Promise<void> {
    const map = await this.readMap();

    map[recording.id] = recording;

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

  private async readMap(): Promise<Record<string, Recording>> {
    const data = await chrome.storage.local.get(KEY);

    return (data[KEY] ?? {}) as Record<string, Recording>;
  }
}
