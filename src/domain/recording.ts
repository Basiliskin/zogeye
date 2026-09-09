// src/domain/recording.ts
// Pure model for a recorded user-interaction flow. No chrome.* here — the
// background service worker supplies ids and timestamps, this module only
// shapes and validates the data.

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
}

export class RecordingMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingMetaError";
  }
}

const TITLE_MAX = 120;

/**
 * Returns a human-readable reason the metadata is invalid, or `null` when it
 * is acceptable. Kept side-effect free so both the domain and the side panel
 * can call it.
 */
export function validateRecordingMeta(
  title: string,
  url: string,
): string | null {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    return "Title is required.";
  }

  if (trimmedTitle.length > TITLE_MAX) {
    return `Title must be ${TITLE_MAX} characters or fewer.`;
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
  const problem = validateRecordingMeta(input.title, input.url);

  if (problem) {
    throw new RecordingMetaError(problem);
  }

  return {
    id: input.id,
    title: input.title.trim(),
    url: input.url,
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
  patch: { title?: string | undefined; url?: string | undefined },
  now: number,
): Recording {
  const nextTitle = patch.title ?? recording.title;
  const nextUrl = patch.url ?? recording.url;

  const problem = validateRecordingMeta(nextTitle, nextUrl);

  if (problem) {
    throw new RecordingMetaError(problem);
  }

  return {
    ...recording,
    title: nextTitle.trim(),
    url: nextUrl,
    updatedAt: now,
  };
}
