import { describe, expect, it } from "vitest";
import {
  graphQlRules,
  graphQlStaticRules,
  isGraphqlRequest,
} from "./graphql-rules.js";
import type { RequestFact } from "../models.js";

const request = (partial: Partial<RequestFact>): RequestFact => ({
  url: "https://api.example.test/graphql",
  method: "POST",
  timestamp: 0,
  ...partial,
});

describe("isGraphqlRequest", () => {
  it("recognizes the conventional GraphQL endpoint path", () => {
    expect(isGraphqlRequest(request({}))).toBe(true);
  });

  it("recognizes GraphQL bodies on non-obvious endpoints", () => {
    expect(
      isGraphqlRequest(
        request({
          url: "https://api.example.test/query",
          body: JSON.stringify({ query: "query Viewer { viewer { id } }" }),
        }),
      ),
    ).toBe(true);
  });

  it("recognizes the GraphQL media type", () => {
    expect(
      isGraphqlRequest(
        request({
          url: "https://api.example.test/query",
          requestHeaders: { "content-type": "application/graphql" },
        }),
      ),
    ).toBe(true);
  });

  it("does not classify unrelated JSON requests", () => {
    expect(
      isGraphqlRequest(
        request({
          url: "https://api.example.test/users",
          body: JSON.stringify({ name: "Ada" }),
        }),
      ),
    ).toBe(false);
  });
});

describe("GraphQL rule providers", () => {
  it("expose request and static rule sets", () => {
    expect(graphQlRules()).toHaveLength(4);
    expect(graphQlStaticRules()).toHaveLength(3);
  });
});
