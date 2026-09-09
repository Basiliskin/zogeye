import { describe, expect, it } from "vitest";
import { RuleRegistry } from "./rule-registry.js";

describe("RuleRegistry", () => {
  const registry = new RuleRegistry();
  const rules = registry.all();

  it("exposes a non-empty, unique-id rule set", () => {
    expect(rules.length).toBeGreaterThan(0);
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the current-page rule families", () => {
    const ids = new Set(rules.map((rule) => rule.id));
    expect(ids).toContain("header.missing-hsts");
    expect(ids).toContain("cookie.missing-secure");
    expect(ids).toContain("req.jwt-in-url");
    expect(ids).toContain("dom.mixed-content");
  });

  it("returns a defensive copy", () => {
    registry.all().pop();
    expect(registry.all().length).toBe(rules.length);
  });

  it("every rule evaluates an empty context without throwing", () => {
    for (const rule of rules) {
      expect(rule.evaluate({})).toEqual([]);
    }
  });
});
