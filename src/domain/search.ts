// src/domain/search.ts
// Pure "search everywhere" engine. The side panel / background gather a
// corpus of documents from every observable surface (page source, cookies,
// captured requests, local / session storage); this module does the
// deterministic matching, snippet extraction and ranking. No chrome.* here.

export type SearchSourceKind =
  | "source"
  | "network"
  | "cookie"
  | "localStorage"
  | "sessionStorage";

export interface SearchDocument {
  kind: SearchSourceKind;
  /** URL, cookie name, storage key, "Page HTML", … */
  label: string;
  /** Optional secondary location detail (domain, request source, …). */
  detail?: string | undefined;
  /** The searchable text. */
  content: string;
}

export interface SearchCorpus {
  documents: SearchDocument[];
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  /** Restrict the search to these source kinds; empty / absent = all. */
  kinds?: SearchSourceKind[];
}

export interface SearchSnippet {
  /** Context text around a match, control chars flattened to spaces. */
  text: string;
  /** Offset of the match inside `text`. */
  start: number;
  /** Length of the matched substring. */
  length: number;
}

export interface SearchHit {
  kind: SearchSourceKind;
  label: string;
  detail?: string | undefined;
  matchCount: number;
  /** A capped sample of matches, in document order. */
  snippets: SearchSnippet[];
}

export class SearchQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchQueryError";
  }
}

const SNIPPET_RADIUS = 60;
const SNIPPETS_PER_DOC = 5;
const MAX_MATCHES_PER_DOC = 999;

const KIND_ORDER: SearchSourceKind[] = [
  "source",
  "network",
  "cookie",
  "localStorage",
  "sessionStorage",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(query: string, options: SearchOptions): RegExp {
  const flags = options.caseSensitive ? "g" : "gi";

  if (options.regex) {
    try {
      return new RegExp(query, flags);
    } catch (error) {
      throw new SearchQueryError(
        `Invalid regular expression: ${(error as Error).message}`,
      );
    }
  }

  return new RegExp(escapeRegExp(query), flags);
}

function makeSnippet(content: string, index: number, length: number): SearchSnippet {
  const from = Math.max(0, index - SNIPPET_RADIUS);
  const to = Math.min(content.length, index + length + SNIPPET_RADIUS);

  // Replace control chars 1:1 so match offsets stay exact.
  let text = content.slice(from, to).replace(/[\n\r\t\f\v]/g, " ");
  let start = index - from;

  if (from > 0) {
    text = `…${text}`;
    start += 1;
  }

  if (to < content.length) {
    text = `${text}…`;
  }

  return { text, start, length };
}

function collectMatches(content: string, matcher: RegExp): {
  total: number;
  snippets: SearchSnippet[];
} {
  matcher.lastIndex = 0;

  const snippets: SearchSnippet[] = [];
  let total = 0;
  let result = matcher.exec(content);

  while (result !== null && total < MAX_MATCHES_PER_DOC) {
    total += 1;

    if (snippets.length < SNIPPETS_PER_DOC) {
      snippets.push(makeSnippet(content, result.index, result[0].length || 1));
    }

    // Guard against zero-length matches (e.g. the regex `a*`).
    if (result[0].length === 0) {
      matcher.lastIndex += 1;
    }

    result = matcher.exec(content);
  }

  return { total, snippets };
}

/**
 * Search every document in the corpus. Returns hits ordered by source kind,
 * then by match count (desc), then by label. Throws {@link SearchQueryError}
 * when `regex` is set and `query` does not compile. An empty / whitespace
 * query yields no hits.
 */
export function searchCorpus(
  corpus: SearchCorpus,
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  if (!query.trim()) {
    return [];
  }

  const matcher = buildMatcher(query, options);
  const allowed =
    options.kinds && options.kinds.length > 0
      ? new Set(options.kinds)
      : null;

  const hits: SearchHit[] = [];

  for (const doc of corpus.documents) {
    if (allowed && !allowed.has(doc.kind)) {
      continue;
    }

    const { total, snippets } = collectMatches(doc.content, matcher);

    if (total === 0) {
      continue;
    }

    hits.push({
      kind: doc.kind,
      label: doc.label,
      detail: doc.detail,
      matchCount: total,
      snippets,
    });
  }

  hits.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      b.matchCount - a.matchCount ||
      a.label.localeCompare(b.label),
  );

  return hits;
}

/** Total hits and matches, for a one-line result summary. */
export function summarizeHits(hits: SearchHit[]): {
  documents: number;
  matches: number;
} {
  return {
    documents: hits.length,
    matches: hits.reduce((sum, hit) => sum + hit.matchCount, 0),
  };
}
