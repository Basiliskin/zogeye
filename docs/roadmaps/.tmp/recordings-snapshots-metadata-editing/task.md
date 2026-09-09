# Task

Add new features to the browser-extension side panel's saved-capture features:

1. Each **recording** (saved interaction flow) has free-text **notes** and user **labels** with full CRUD.
2. **Filter** recordings by free-text search AND by labels.
3. **Update / re-record** an existing recording in place when the active tab is on the same page/URL.
4. Ability to **edit captured values inside a Storage Snapshot** — localStorage / sessionStorage / cookie
   values of a saved `StorageSnapshot` — finding the entry to edit via an autocomplete search over keys.

## Scoping answers from the user

- The working tree already contains an unfinished implementation of features 1–3 for the Recordings tab
  (uncommitted changes to `src/domain/recording.ts`, `src/sidepanel/recordings.ts`,
  `src/sidepanel/index.html`, `src/background/service-worker.ts`,
  `src/infrastructure/recording-store.ts`, `src/domain/recording.unit.test.ts`).
  Decision: **finish & verify that WIP, add tests, then build feature 4.**
- Feature 4 targets **Storage Snapshot key/values** (localStorage / sessionStorage / cookies inside a
  saved `StorageSnapshot`), with autocomplete search over keys. Not recording-step values.

## Assumed quality bar

Production-ready with tests — the repo runs `./scripts/verify.sh` (tsc --noEmit, ESLint type-aware,
vitest unit + int, dependency-cruiser, dead-code, framework-rules). Recorded as an assumption.
