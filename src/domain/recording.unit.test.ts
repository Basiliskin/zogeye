// src/domain/recording.unit.test.ts
import { describe, expect, it } from "vitest";
import {
  collectLabels,
  createRecording,
  filterRecordings,
  hydrateRecording,
  isSamePage,
  normalizeLabels,
  parseLabels,
  RecordingMetaError,
  updateRecordingMeta,
  validateRecordingMeta,
  withSteps,
  type Recording,
  type RecordingStep,
} from "./recording.js";

const step = (over: Partial<RecordingStep> = {}): RecordingStep => ({
  type: "click",
  selector: "#login",
  timestamp: 10,
  ...over,
});

const base = (): Recording =>
  createRecording({
    id: "r1",
    title: "Checkout flow",
    url: "https://shop.example/cart",
    steps: [step()],
    now: 1000,
  });

describe("validateRecordingMeta", () => {
  it("accepts a non-empty title and an http(s) url", () => {
    expect(validateRecordingMeta("Flow", "https://a.example")).toBeNull();
    expect(validateRecordingMeta("Flow", "http://a.example")).toBeNull();
  });

  it("rejects a blank title", () => {
    expect(validateRecordingMeta("   ", "https://a.example")).toMatch(/title/i);
  });

  it("rejects an over-long title", () => {
    expect(validateRecordingMeta("x".repeat(121), "https://a.example")).toMatch(
      /120/,
    );
  });

  it("rejects a non-absolute or non-http url", () => {
    expect(validateRecordingMeta("Flow", "/relative")).toMatch(/absolute/i);
    expect(validateRecordingMeta("Flow", "ftp://a.example")).toMatch(/http/i);
  });
});

describe("createRecording", () => {
  it("trims the title, copies steps and stamps both timestamps", () => {
    const rec = createRecording({
      id: "r1",
      title: "  Login  ",
      url: "https://a.example",
      steps: [step()],
      now: 500,
    });

    expect(rec).toMatchObject({
      id: "r1",
      title: "Login",
      createdAt: 500,
      updatedAt: 500,
    });
    expect(rec.steps).toHaveLength(1);
  });

  it("throws RecordingMetaError on invalid metadata", () => {
    expect(() =>
      createRecording({
        id: "r1",
        title: "",
        url: "https://a.example",
        steps: [],
        now: 1,
      }),
    ).toThrow(RecordingMetaError);
  });
});

describe("withSteps", () => {
  it("replaces steps and bumps updatedAt only", () => {
    const next = withSteps(base(), [step({ type: "submit" })], 2000);

    expect(next.steps).toEqual([step({ type: "submit" })]);
    expect(next.createdAt).toBe(1000);
    expect(next.updatedAt).toBe(2000);
  });
});

describe("updateRecordingMeta", () => {
  it("applies a partial patch and bumps updatedAt", () => {
    const next = updateRecordingMeta(base(), { title: "Renamed" }, 3000);

    expect(next.title).toBe("Renamed");
    expect(next.url).toBe("https://shop.example/cart");
    expect(next.updatedAt).toBe(3000);
    expect(next.steps).toHaveLength(1);
  });

  it("throws when the patch would make the metadata invalid", () => {
    expect(() =>
      updateRecordingMeta(base(), { url: "not-a-url" }, 3000),
    ).toThrow(RecordingMetaError);
  });

  it("normalizes labels and trims notes on patch", () => {
    const next = updateRecordingMeta(
      base(),
      { notes: "  a note  ", labels: [" Login ", "login", "SMOKE"] },
      3000,
    );

    expect(next.notes).toBe("a note");
    expect(next.labels).toEqual(["login", "smoke"]);
  });

  it("keeps existing labels when the patch omits them", () => {
    const withLabels = updateRecordingMeta(base(), { labels: ["x"] }, 1);
    expect(updateRecordingMeta(withLabels, { title: "T" }, 2).labels).toEqual([
      "x",
    ]);
  });
});

describe("normalizeLabels / parseLabels", () => {
  it("trims, lower-cases, de-dupes and drops blanks", () => {
    expect(normalizeLabels([" A ", "a", "", "B"])).toEqual(["a", "b"]);
  });

  it("drops over-long labels and caps the count", () => {
    expect(normalizeLabels(["x".repeat(41)])).toEqual([]);
    expect(
      normalizeLabels(Array.from({ length: 40 }, (_, i) => `l${i}`)),
    ).toHaveLength(24);
  });

  it("splits free text on commas and newlines", () => {
    expect(parseLabels("auth, smoke\nregression")).toEqual([
      "auth",
      "smoke",
      "regression",
    ]);
  });
});

describe("validateRecordingMeta notes", () => {
  it("rejects notes longer than the cap", () => {
    expect(
      validateRecordingMeta("Flow", "https://a.example", "x".repeat(4001)),
    ).toMatch(/4000/);
  });
});

describe("hydrateRecording", () => {
  it("fills missing notes and labels from legacy records", () => {
    const legacy = { id: "r", title: "T", url: "https://a.example", steps: [] };
    const hydrated = hydrateRecording(legacy as unknown as Recording);

    expect(hydrated.notes).toBe("");
    expect(hydrated.labels).toEqual([]);
  });
});

describe("isSamePage", () => {
  it("matches on origin + path + query, ignoring the hash", () => {
    expect(
      isSamePage("https://a.example/x?q=1#top", "https://a.example/x?q=1#bot"),
    ).toBe(true);
    expect(isSamePage("https://a.example/x", "https://a.example/y")).toBe(
      false,
    );
    expect(isSamePage("https://a.example/x", "https://b.example/x")).toBe(
      false,
    );
  });
});

describe("collectLabels / filterRecordings", () => {
  const make = (over: Partial<Recording>): Recording => ({
    ...base(),
    id: over.id ?? "r",
    ...over,
  });

  it("collects the sorted union of labels", () => {
    const list = [
      make({ id: "a", labels: ["smoke", "auth"] }),
      make({ id: "b", labels: ["auth", "billing"] }),
    ];
    expect(collectLabels(list)).toEqual(["auth", "billing", "smoke"]);
  });

  it("filters by free text across title, url, notes and steps", () => {
    const list = [
      make({ id: "a", title: "Checkout" }),
      make({ id: "b", title: "Login", notes: "covers 2FA" }),
    ];
    expect(filterRecordings(list, { query: "2fa" }).map((r) => r.id)).toEqual([
      "b",
    ]);
  });

  it("requires every selected label (AND)", () => {
    const list = [
      make({ id: "a", labels: ["smoke", "auth"] }),
      make({ id: "b", labels: ["auth"] }),
    ];
    expect(
      filterRecordings(list, { labels: ["smoke", "auth"] }).map((r) => r.id),
    ).toEqual(["a"]);
  });
});
