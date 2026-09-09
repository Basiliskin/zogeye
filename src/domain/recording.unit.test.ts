// src/domain/recording.unit.test.ts
import { describe, expect, it } from "vitest";
import {
  createRecording,
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
    expect(
      validateRecordingMeta("x".repeat(121), "https://a.example"),
    ).toMatch(/120/);
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
});
