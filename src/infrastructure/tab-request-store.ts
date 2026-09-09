// src/infrastructure/tab-request-store.ts
import type { RequestFact } from "../domain/models.js";

const KEY = "api-qa.requests";
const LIMIT = 300;

export class TabRequestStore {
  async add(tabId: number, request: RequestFact): Promise<void> {
    const data = await chrome.storage.session.get(KEY);
    const all = data[KEY] ?? {};
    const list: RequestFact[] = all[tabId] ?? [];

    list.push(request);

    if (list.length > LIMIT) {
      list.splice(0, list.length - LIMIT);
    }

    all[tabId] = list;
    await chrome.storage.session.set({ [KEY]: all });
  }

  async list(tabId: number): Promise<RequestFact[]> {
    const data = await chrome.storage.session.get(KEY);
    return data[KEY]?.[tabId] ?? [];
  }

  async clear(tabId: number): Promise<void> {
    const data = await chrome.storage.session.get(KEY);
    const all = data[KEY] ?? {};

    delete all[tabId];

    await chrome.storage.session.set({ [KEY]: all });
  }
}
