// src/domain/recording.ts
// Pure model for a recorded user-interaction flow. No chrome.* here — the
// background service worker supplies ids and timestamps, this module only
// shapes and validates the data.

import { parseUrlSafe } from "./web-utils.js";

export type RecordingStepType =
  | "navigate"
  | "click"
  | "change"
  | "keydown"
  | "submit";

export interface RecordingStep {
  type: RecordingStepType;
  /** CSS-ish path to the target element (absent for `navigate`). */
  selector?: string | undefined;
  /** Destination URL for `navigate`. */
  url?: string | undefined;
  /** Committed value for `change`. */
  value?: string | undefined;
  /** Key name for `keydown` (only meaningful keys are recorded). */
  key?: string | undefined;
  /** Trimmed, truncated text content of the target, for readability. */
  text?: string | undefined;
  timestamp: number;
}

export interface Recording {
  id: string;
  title: string;
  url: string;
  /** Free-form user notes about the flow. May be empty. */
  notes: string;
  /** User-assigned labels, normalized (trimmed, de-duped, lower-cased). */
  labels: string[];
  steps: RecordingStep[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateRecordingInput {
  id: string;
  title: string;
  url: string;
  steps: RecordingStep[];
  now: number;
  notes?: string | undefined;
  labels?: readonly string[] | undefined;
}

export class RecordingMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingMetaError";
  }
}

const TITLE_MAX = 120;
const NOTES_MAX = 4000;
const LABEL_MAX = 40;
const LABELS_MAX = 24;

/**
 * Normalizes a raw label list: trims each entry, lower-cases it, drops blanks
 * and over-long entries, de-duplicates (first wins) and caps the count. Kept
 * pure so the side panel and the domain agree on what a label set looks like.
 */
export function normalizeLabels(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of raw) {
    const label = entry.trim().toLowerCase();

    if (!label || label.length > LABEL_MAX || seen.has(label)) {
      continue;
    }

    seen.add(label);
    out.push(label);

    if (out.length >= LABELS_MAX) {
      break;
    }
  }

  return out;
}

/** Splits a free-text field (commas or newlines) into a normalized label list. */
export function parseLabels(input: string): string[] {
  return normalizeLabels(input.split(/[\n,]/));
}

/**
 * Returns a human-readable reason the metadata is invalid, or `null` when it
 * is acceptable. Kept side-effect free so both the domain and the side panel
 * can call it.
 */
export function validateRecordingMeta(
  title: string,
  url: string,
  notes = "",
): string | null {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    return "Title is required.";
  }

  if (trimmedTitle.length > TITLE_MAX) {
    return `Title must be ${TITLE_MAX} characters or fewer.`;
  }

  if (notes.length > NOTES_MAX) {
    return `Notes must be ${NOTES_MAX} characters or fewer.`;
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return "URL must be an absolute http(s) address.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "URL must use http or https.";
  }

  return null;
}

export function createRecording(input: CreateRecordingInput): Recording {
  const notes = input.notes ?? "";
  const problem = validateRecordingMeta(input.title, input.url, notes);

  if (problem) {
    throw new RecordingMetaError(problem);
  }

  return {
    id: input.id,
    title: input.title.trim(),
    url: input.url,
    notes: notes.trim(),
    labels: normalizeLabels(input.labels ?? []),
    steps: [...input.steps],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Replace the step list (used when the user re-records an existing entry). */
export function withSteps(
  recording: Recording,
  steps: RecordingStep[],
  now: number,
): Recording {
  return {
    ...recording,
    steps: [...steps],
    updatedAt: now,
  };
}

/** Apply a metadata patch, validating the result. Throws on invalid input. */
export function updateRecordingMeta(
  recording: Recording,
  patch: {
    title?: string | undefined;
    url?: string | undefined;
    notes?: string | undefined;
    labels?: readonly string[] | undefined;
  },
  now: number,
): Recording {
  const nextTitle = patch.title ?? recording.title;
  const nextUrl = patch.url ?? recording.url;
  const nextNotes = patch.notes ?? recording.notes;

  const problem = validateRecordingMeta(nextTitle, nextUrl, nextNotes);

  if (problem) {
    throw new RecordingMetaError(problem);
  }

  return {
    ...recording,
    title: nextTitle.trim(),
    url: nextUrl,
    notes: nextNotes.trim(),
    labels:
      patch.labels === undefined
        ? recording.labels
        : normalizeLabels(patch.labels),
    updatedAt: now,
  };
}

/** Fills in `notes` / `labels` for recordings persisted before those fields. */
export function hydrateRecording(raw: Recording): Recording {
  return {
    ...raw,
    notes: typeof raw.notes === "string" ? raw.notes : "",
    labels: Array.isArray(raw.labels) ? normalizeLabels(raw.labels) : [],
  };
}

/** True when two URLs point at the same page (origin + path, ignoring hash). */
export function isSamePage(a: string, b: string): boolean {
  const ua = parseUrlSafe(a);
  const ub = parseUrlSafe(b);

  if (!ua || !ub) {
    return a === b;
  }

  return (
    ua.origin === ub.origin &&
    ua.pathname === ub.pathname &&
    ua.search === ub.search
  );
}

export interface RecordingFilter {
  /** Free-text query matched against title, url, notes, labels and step text. */
  query?: string | undefined;
  /** Labels that must all be present on a recording (AND). */
  labels?: readonly string[] | undefined;
}

/** The sorted union of every label used across the given recordings. */
export function collectLabels(recordings: readonly Recording[]): string[] {
  const all = new Set<string>();

  for (const recording of recordings) {
    for (const label of recording.labels) {
      all.add(label);
    }
  }

  return [...all].sort();
}

function haystack(recording: Recording): string {
  const stepText = recording.steps
    .map((s) => [s.selector, s.url, s.value, s.key, s.text].filter(Boolean).join(" "))
    .join(" ");

  return [
    recording.title,
    recording.url,
    recording.notes,
    recording.labels.join(" "),
    stepText,
  ]
    .join(" ")
    .toLowerCase();
}

/** Pure list filter: free-text query AND every selected label must match. */
export function filterRecordings(
  recordings: readonly Recording[],
  filter: RecordingFilter,
): Recording[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  const labels = normalizeLabels(filter.labels ?? []);

  return recordings.filter((recording) => {
    if (labels.some((label) => !recording.labels.includes(label))) {
      return false;
    }

    if (query && !haystack(recording).includes(query)) {
      return false;
    }

    return true;
  });
}
