# Product Facts

> Single source of truth for all downstream marketing skills. No promotional material may claim more
> than this document supports.

## Verified facts

Every fact traced to a repository file, the README, or the user. The `source:` field is restricted to
`<repo-relative path>` | `README` | `user`.

### Identity & packaging

- The product is named "Zogeye" (manifest `name`; package `name` is `zogeye`) — source: `public/manifest.json`
- It is a Chrome extension built on Manifest V3, with a service worker background, a side panel UI, and four content scripts — source: `public/manifest.json`
- Manifest self-description: "Deterministic, local QA reviewer for network API usage and static project checks." — source: `public/manifest.json`
- Requested permissions are `storage`, `sidePanel`, `tabs`, `webRequest`, `cookies`, plus `host_permissions` of `<all_urls>` — source: `public/manifest.json`
- The extension source contains no `fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource` calls to external services; all rule evaluation runs in the browser and results are held in `chrome.storage` / in-memory stores — source: `src/` (grep across `src/**/*.ts`), `src/infrastructure/tab-request-store.ts`, `src/infrastructure/recording-store.ts`, `src/infrastructure/snapshot-store.ts`
- `README.md` documents the extension's features, permissions, unpacked-install steps, dev scripts, and architecture; it is derived from this document and adds no claims beyond it — source: `README.md`
- There is no test runner wired to `npm test` (`test` script exits 1); tests run via `vitest` through `test:unit` / `test:int` and `scripts/verify.sh` — source: `package.json`

### Analysis engine

- A deterministic rule engine evaluates `AnalysisContext` objects (request / file / dependency / page facts) against a registry of rules and produces a `Report` with a numeric `riskScore` and an `exposure` tier (`low` / `medium` / `high` / `critical`) — source: `src/application/analyzer.ts`, `src/application/rule-registry.ts`, `src/domain/models.ts`
- Severity weights are fixed (`info` 0, `low` 1, `medium` 5, `high` 20, `critical` 50) and findings are de-duplicated by rule id + details + evidence — source: `src/application/analyzer.ts`
- The rule registry aggregates network, static-code, dependency, GraphQL, realtime, HTTP-header, request-hygiene, and DOM rule families — source: `src/application/rule-registry.ts`

### Network / API rules

- Network rules flag: non-HTTPS API traffic, credentials in URL query parameters, apparent mutations sent via GET, JSON-like bodies without an `application/json` content type, and wildcard CORS (`Access-Control-Allow-Origin: *`) combined with `Access-Control-Allow-Credentials: true` — source: `src/domain/rules/network-rules.ts`
- Request-hygiene rules flag: JWTs in the request URL, HTTP Basic credentials in the URL, session/OAuth tokens as URL parameters, personal data (PII) in the query string, and an `Authorization` header sent over cleartext HTTP — source: `src/domain/rules/site/request-hygiene-rules.ts`
- GraphQL rules flag: GraphQL over HTTP, queries passed in GET URLs, mutations via GET, and introspection queries in requests; static GraphQL checks cover HTTP endpoints, introspection, and deprecated subscription transport — source: `src/domain/rules/graphql-rules.ts`
- Realtime rules flag: insecure (`ws://` / non-TLS) realtime transports and insecure GraphQL subscription WebSocket URLs; static checks cover `ws://` WebSocket, `http://` EventSource, and WebSocket/EventSource usage — source: `src/domain/rules/realtime-rules.ts`

### HTTP response header & cookie rules

- Header rules flag: missing or weak `Strict-Transport-Security`, missing `Content-Security-Policy`, CSP with `unsafe-inline` / `unsafe-eval`, missing `X-Content-Type-Options: nosniff`, missing frame protection (`X-Frame-Options` / `frame-ancestors`), server/framework version disclosure, cacheable authenticated responses, and CORS allowing the `null` origin with credentials — source: `src/domain/rules/site/header-rules.ts`
- Cookie rules flag: `Set-Cookie` missing `Secure`, `SameSite=None` without `Secure`, missing `SameSite`, and session cookies without `HttpOnly` — source: `src/domain/rules/site/header-rules.ts`
- Real response headers for top-level and framed documents are captured through `chrome.webRequest.onHeadersReceived` — source: `src/background/service-worker.ts`

### DOM / page rules

- The `page-scan` content script collects a deterministic `PageFact` DOM snapshot on demand (no external resource fetches) — source: `src/content/page-scan.ts`, `src/domain/models.ts`
- DOM rules flag: password fields on insecure pages/forms, mixed content on HTTPS pages, cross-origin scripts/stylesheets without Subresource Integrity, cross-origin iframes without `sandbox`, `target="_blank"` links without `rel="noopener"`, inline event-handler attributes, `javascript:` URIs, password/payment fields allowing autocomplete, and a referrer policy that leaks full URLs cross-origin — source: `src/domain/rules/site/dom-rules.ts`

### Static project-file scanning

- The side panel accepts a local folder/file selection, filters to source file types (`.cjs/.mjs/.js/.jsx/.ts/.tsx/.html/.json/.vue/.svelte`), skips `node_modules` / `dist` / `build` / `coverage` / `.git` and lockfiles, caps at 2000 files and 512 KB per file, and analyzes them in-browser — source: `src/sidepanel/sidepanel.ts`
- Static code rules flag: `eval(`, `document.write(`, `innerHTML =` assignment, hardcoded HTTP endpoints, possible hardcoded secrets, `postMessage` with a wildcard target origin, auth tokens written to `localStorage`, and references to known-outdated libraries (`moment`, `request`) — source: `src/domain/rules/static-rules.ts`
- `package.json` files are parsed and each dependency checked: `moment` (deprecated), `request` (deprecated), `axios` below 0.21.4, `lodash` below 4.17.21, `jquery` below 3.5.0, `angular` (AngularJS EOL), `subscriptions-transport-ws` (deprecated) — source: `src/domain/rules/dependency-rules.ts`

### Performance analysis

- `findSlowRequests` performs deterministic latency analysis over captured requests, excluding static assets (by extension and content-type), reporting absolute-threshold slow calls (tiers at 1s / 3s / 8s), per-peer outliers (≥5 samples, ≥3× median, ≥500 ms), and the slowest calls above 200 ms — source: `src/domain/performance.ts`, `src/background/service-worker.ts`

### Recorder

- An interaction recorder captures a deterministic set of user actions (`navigate`, `click`, `change`, `keydown` for Enter/Escape/Tab, `submit`) into named, stored "recording" flows with CRUD (start / stop / rename / delete) — source: `src/content/recorder.ts`, `src/domain/recording.ts`, `src/sidepanel/recordings.ts`, `src/background/service-worker.ts`
- The recorder content script is injected dormant on every page and only activates when armed by the background service worker — source: `src/content/recorder.ts`

### Storage snapshots

- The "Snapshots" tab captures a tab's `localStorage`, `sessionStorage`, and cookies (all, or a hand-picked subset) and can switch back to any saved snapshot — source: `src/sidepanel/snapshots.ts`, `src/domain/snapshot/storage-snapshot.ts`, `src/background/snapshot-handlers.ts`
- Cookies are captured with full fidelity from the `chrome.cookies` API (name, value, domain, path, `secure`, `httpOnly`, `sameSite`, `hostOnly`, `session`, `expirationDate`) — source: `src/domain/snapshot/storage-snapshot.ts`

### Search

- A "Search everywhere" feature builds a one-shot corpus from the active tab (page source, cookies, captured requests, `localStorage`, `sessionStorage`) and filters it with a pure matching/snippet/ranking engine supporting case-sensitive, regex, and per-source-kind filtering — source: `src/domain/search.ts`, `src/sidepanel/search.ts`

### Architecture & quality tooling

- The codebase is layered (`domain` / `application` / `infrastructure`, plus `background` / `content` / `sidepanel` browser glue) with import boundaries enforced by ESLint and dependency-cruiser — source: `eslint.config.mjs`, `.dependency-cruiser.mjs`, `src/` directory structure
- TypeScript is configured strict, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`, `noEmitOnError` — source: `tsconfig.json`
- ESLint baseline bans `any` and non-null assertions, bans `JSON.parse(x) as T`, and restricts domain/application from importing infrastructure, `node:fs`, or vendor SDKs — source: `eslint.config.mjs`
- A staged verification pipeline (`scripts/verify.sh`) runs, in cost order: tsc, ESLint, test-coverage guard, dead-code gate, unit tests, integration tests, e2e, `npm audit`, gitleaks (skipped if absent), framework rules, dependency-architecture validation — source: `scripts/verify.sh`, `package.json`
- Automated tests exist for the rule registry, search, performance, recording, storage-snapshot, and site rule families (unit), and the recording store (integration) — source: `src/application/rule-registry.unit.test.ts`, `src/domain/search.unit.test.ts`, `src/domain/performance.unit.test.ts`, `src/domain/recording.unit.test.ts`, `src/domain/snapshot/storage-snapshot.unit.test.ts`, `src/domain/rules/site/*.unit.test.ts`, `src/infrastructure/recording-store.int.test.ts`
- Project version markers differ: `package.json` is `1.0.0`, `public/manifest.json` is `0.1.0` — source: `package.json`, `public/manifest.json`

## Repository evidence

Concrete file paths in this repository that back the Verified facts.

- `public/manifest.json`
- `package.json`
- `tsconfig.json`
- `eslint.config.mjs`
- `.dependency-cruiser.mjs`
- `scripts/verify.sh`
- `src/application/analyzer.ts`
- `src/application/rule-registry.ts`
- `src/domain/models.ts`
- `src/domain/performance.ts`
- `src/domain/recording.ts`
- `src/domain/search.ts`
- `src/domain/snapshot/storage-snapshot.ts`
- `src/domain/rules/network-rules.ts`
- `src/domain/rules/static-rules.ts`
- `src/domain/rules/dependency-rules.ts`
- `src/domain/rules/graphql-rules.ts`
- `src/domain/rules/realtime-rules.ts`
- `src/domain/rules/site/header-rules.ts`
- `src/domain/rules/site/request-hygiene-rules.ts`
- `src/domain/rules/site/dom-rules.ts`
- `src/background/service-worker.ts`
- `src/background/snapshot-handlers.ts`
- `src/content/page-scan.ts`
- `src/content/network-hook.ts`
- `src/content/recorder.ts`
- `src/content/relay.ts`
- `src/sidepanel/sidepanel.ts`
- `src/sidepanel/recordings.ts`
- `src/sidepanel/snapshots.ts`
- `src/sidepanel/search.ts`
- `src/infrastructure/tab-request-store.ts`
- `src/infrastructure/recording-store.ts`
- `src/infrastructure/snapshot-store.ts`
- Unit / integration test files under `src/**/*.unit.test.ts` and `src/**/*.int.test.ts`

## User-provided facts

Only the four non-derivable categories: production URL, primary goal, open-source status, features
not visible in the repository.

- Production URL: none — Zogeye is not published or distributed yet (no Chrome Web Store listing, landing page, or public repo URL to cite) — source: user
- Primary goal: a self-review tool for developers and QA to catch API, security, and configuration issues locally while testing, with no data leaving the browser — source: user
- Open-source status: open source — source: user
- Features not visible in the repository: none — the user confirmed the document should cover only what is in the repo — source: user

## Unknown

Gaps recorded as open. Never invent an answer here.

- Number of users, installs, or active deployments
- Performance benchmarks (scan speed, memory use, rule-evaluation time)
- Browser support beyond Chromium (the manifest targets Chrome MV3; Edge/other Chromium support is untested and unstated)
- Which open-source license applies (`package.json` declares `ISC`, but no `LICENSE` file is present in the repository)
- Accessibility conformance of the side panel UI
- Whether the rule set has been validated against real-world false-positive / false-negative rates
- Screenshots, demo recordings, or a hosted demo
- Release / distribution timeline

## Forbidden assumptions

Never claim the following without explicit evidence. Un-evidenced occurrences are parked here, not in
Verified facts.

- fastest — no benchmark evidence exists
- most secure — no comparative security evidence exists
- better than competitors — no competitive analysis exists in the repository
- privacy-preserving — the code shows no outbound network calls and local-only storage, which supports factual statements like "analysis runs in the browser" and "no data is sent to external services"; the marketing phrase "privacy-preserving" itself stays parked here and must not be used as an unqualified claim
