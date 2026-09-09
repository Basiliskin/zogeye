// src/domain/search.unit.test.ts
import { describe, expect, it } from "vitest";
import {
  searchCorpus,
  SearchQueryError,
  summarizeHits,
  type SearchCorpus,
} from "./search.js";

const corpus: SearchCorpus = {
  documents: [
    { kind: "source", label: "Page HTML", content: "<h1>Hello TOKEN world</h1>\nfoo token bar" },
    { kind: "network", label: "GET /api", content: "authorization: Bearer token-123" },
    { kind: "cookie", label: "sid", content: "sid=abc" },
    { kind: "localStorage", label: "theme", content: "theme=dark" },
    { kind: "sessionStorage", label: "cart", content: "cart=TOKEN" },
  ],
};

describe("searchCorpus", () => {
  it("returns nothing for a blank query", () => {
    expect(searchCorpus(corpus, "   ")).toEqual([]);
  });

  it("matches case-insensitively by default and counts every occurrence", () => {
    const hits = searchCorpus(corpus, "token");
    const html = hits.find((h) => h.label === "Page HTML");

    expect(html?.matchCount).toBe(2);
    expect(hits.map((h) => h.label)).toContain("cart");
  });

  it("honors caseSensitive", () => {
    const hits = searchCorpus(corpus, "TOKEN", { caseSensitive: true });

    expect(hits.map((h) => h.label).sort()).toEqual(["Page HTML", "cart"]);
    expect(hits.find((h) => h.label === "Page HTML")?.matchCount).toBe(1);
  });

  it("restricts to the requested kinds", () => {
    const hits = searchCorpus(corpus, "token", {
      kinds: ["cookie", "localStorage", "sessionStorage"],
    });

    expect(hits.map((h) => h.kind)).toEqual(["sessionStorage"]);
  });

  it("orders hits by source kind then match count", () => {
    const hits = searchCorpus(corpus, "token");

    expect(hits[0]?.kind).toBe("source");
    expect(hits.at(-1)?.kind).toBe("sessionStorage");
  });

  it("supports regex mode and reports offsets within the snippet", () => {
    const hits = searchCorpus(corpus, "token-\\d+", { regex: true });
    const hit = hits[0];

    expect(hit?.label).toBe("GET /api");
    const snippet = hit?.snippets[0];
    expect(snippet?.text.slice(snippet.start, snippet.start + snippet.length)).toBe(
      "token-123",
    );
  });

  it("throws SearchQueryError on an invalid regex", () => {
    expect(() => searchCorpus(corpus, "(", { regex: true })).toThrow(
      SearchQueryError,
    );
  });

  it("caps the snippet sample but keeps the full match count", () => {
    const many: SearchCorpus = {
      documents: [{ kind: "source", label: "x", content: "ab ".repeat(20) }],
    };
    const hit = searchCorpus(many, "ab")[0];

    expect(hit?.matchCount).toBe(20);
    expect(hit?.snippets.length).toBe(5);
  });
});

describe("summarizeHits", () => {
  it("totals documents and matches", () => {
    expect(summarizeHits(searchCorpus(corpus, "token"))).toEqual({
      documents: 3,
      matches: 4,
    });
  });
});
