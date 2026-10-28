# Unified Player Platform Implementation Plan

Date: 2026-10-28. Status: implementation order approved; review findings resolved.
Design-gated work is not yet dispatch-ready.

**Goal:** build a source-backed player hub while preserving reliable collection and completing the
existing Cloudflare migration without private-data leaks or duplicated infrastructure work.

**Architecture:** retain current addon/Desktop/protocol/intake boundaries. Introduce a unified owned-
character contract and provenance-aware history behind async store interfaces. The migration owns
Workers/OpenNext, knowledge D1 and cache resources; high-volume combat processing is a separate gated design.

**Stack:** existing Lua addon, TypeScript Desktop/companion/Next.js, R2, Supabase Postgres, and the
approved Cloudflare migration. Do not add dependencies or paid services merely because they are available.

**Spec:** [scope and boundaries](../../design/specs/2026-10-28-unified-player-platform.md).
**Task register:** [all gaps and dependencies](../../2026-10-28-platform-gap-register.md).

## Global constraints

- Preserve current feature switches, privacy/publication rules, source data and account boundaries.
- Completed reliability work is local-only until a reviewed delivery; passing source tests is not a release.
- No production flag, database migration, account, DNS, package publication or new spending in a routine code task.
- No host repository fs or native SQLite in new Worker request paths; proven build-bundled runtime adapters
  belong to the migration owner. Keep personal and public stores separate.
- Keep actual game completion dates separate from observation/upload timestamps; unknown is not zero.
- Use synthetic fixtures before live servers; do not publish synthetic player, market or combat observations.
- Existing migration owns CF tasks. Integrate through reviewed commits; do not edit its active branch or resources.

## Coordination before every implementation assignment

Carlos explicitly requires checking the other active Everloot terminal before proceeding.

- Read current shared status, open PRs, active terminal messages and its actual changed-file list; a clean
  remote PR does not establish that its local worktree is idle.
- Record the task's owner, file boundary, base revision and dependency contract in shared status before editing.
- Migration currently reserves `web/open-next.config.ts`, `web/wrangler.jsonc`, `web/package.json`,
  `web/package-lock.json`, `web/scripts/cf-bundle-files.mjs`, cache resources, secrets and preview deployment.
  Its broader filesystem/D1/cache work also needs consultation before touching shared web/kb modules.
- Keep SEC-01 audit/tests in route or middleware files; avoid `web/next.config.js` unless a demonstrated gap
  requires an explicitly coordinated change. Do not take over its build or Vercel configuration tasks.
- Recheck ownership when scope expands or a task returns. A fresh file overlap blocks integration until resolved;
  do not overwrite it, assume consent or create a second implementation.
- Compare against the intended remote branch's pinned SHA, not an unrelated local `main` pointer. Preserve all
  worktrees and uncommitted changes; changing/deleting them is outside this plan.

## Review focus

1. A different account, copied install identifier or disputed link must not inherit a private dashboard (Task 2).
2. Reinstallation and two machines must not split or silently merge character history (Tasks 2 and 4).
3. Changed catalogs and trimmed data must not manufacture progress percentages or milestones (Tasks 3 and 4).
4. Opt-out/revocation must remove derived outputs and warm cached copies (Tasks 1 and 4).
5. Retry, reordered inputs and scheduler overlap must not lose facts or double-count them (Tasks 1 and 4).

## Work packages and order

1. **Infrastructure safety:** migration CF-01..10 with readiness SEC-01/PERF-01; reliability delivery acceptance.
2. **One owned character:** HUB-P01..03 then COL-C00..01, initially private; keep public identity claims gated.
3. **Accurate current progress:** COL-C02..03, HUB-P04..05; use honest catalogs before totals.
4. **Historical progress:** HIST-01..04; contract and capture precede storage and timeline UI.
5. **Economy and PvE/PvP:** PROBE-01, ECON/PVE/PVP slices and local LOG tasks; COMBAT-D01 gates server analysis.
6. **Release acceptance:** native/platform/game checks and performance parity before broad capability claims.

Packages 2..5 each get a focused implementation plan once their listed design gates are settled. This
document is an orchestration plan, not permission to dispatch every broad product feature at once.

## Task 1: Cache-privacy contract and migration acceptance checklist

**IDs:** SEC-01, CF-09, PERF-01. **Owner:** readiness tests; migration owns runtime configuration.

**Files:** inspect `web/src/middleware.ts`, `web/next.config.js`, `web/src/app/home/page.tsx`,
`web/src/app/api/me/`, auth handlers, `web/src/app/api/players/opt-out/route.ts`,
`web/src/app/api/guilds/hide/route.ts`; extend existing route/header tests and a focused contract suite.

**Interface:** consume actual HTTP/session behavior; produce a versioned route matrix with expected
status, cache policy and identity requirements. Do not add a second caching abstraction.
`web/next.config.js` is read-only inventory unless an actual defect and file ownership are reconciled.

- [ ] Locate and record current response headers and invalidation behavior for representative private/public routes.
- [ ] Add a failing regression only for a demonstrated contract gap: two distinct signed-in sessions can never reuse
  one another's response; a revoked/hidden record disappears from page and search representations.
- [ ] Run the exact test and record the meaningful failure before modifying implementation.
- [ ] Make the smallest correction in the owning route/header layer; retain origin/auth checks and source provenance.
- [ ] Run affected web tests and typecheck, then review the diff and commit the scoped fix.
- [ ] Produce the same route/query matrix for production and Worker preview: record sample count, cold/warm
  distribution, errors, median/p95, response bytes, Worker CPU and D1 queries when available. Missing instrumentation
  is recorded as unmeasured. Set numeric performance targets after the baseline, before load testing.
- [ ] Have the migration owner prove invalidation on a controlled custom hostname before production cutover.
- [ ] Supply the route matrix and acceptance findings to the migration owner for CF-06 measurement. That owner
  measures both `snapshot` and `blue` (each every ten minutes, with a 30-second CPU budget), while `indexnow` is
  hourly and follows the hourly limit. Keep CPU separate from wall time. Include `blue` tag invalidation and
  checkpoint/single-writer guarantees; do not start or modify any scheduler from the readiness task.

## Task 2: One private owned-character flow

**IDs:** HUB-P01..03, COL-C00..01. **Design gate:** assurance/dispute and identifier ADR.

**Files:** `web/src/lib/character-links.ts`, `character-links-store.ts`, existing link-code/link routes,
`supabase/migrations/20261021190000_character_links.sql`, `web/src/lib/completion-store.ts`,
`addon/modules/link.lua` (new only if the approved design chooses a command), `addon/Everloot.toc`,
Desktop/companion dedicated sender, account UI and associated Lua/route/SQL tests.

**Interfaces:** reuse the existing link-code, link-row and scoped-key contracts; approve any signature/schema
change in the ADR first. Link data must bypass anonymous intake. A canonical owned-character reference and its
aliases must be explicitly named by HUB-P01 before dependent APIs are implemented.

- [ ] Map public sightings, build labels, local alts, completion keys and account links; write the join/alias ADR.
- [ ] Specify an addon-file claim's assurance accurately; define disputes, secret rotation, unlink and recovery.
- [ ] Include existing `character_visibility` public/show/ranked/indexable fields in that ADR. Do not wire public
  ownership badges, rankings or indexing merely because flags exist. Use existing `unlink_character`,
  `set_visibility` and `public_character` SQL functions; any schema changes require the ADR. The existing
  `/api/me/characters/[id]` DELETE removes a saved-build label, not a character link.
- [ ] Add fixtures for expired/reused code, wrong account/origin/scope, duplicate redemption, contested link,
  reinstall and second machine. Do not use publicly observable class/race/faction as proof of control.
- [ ] Prove the tests fail for the missing path; implement the narrow link producer, authenticated delivery and
  owner list/unlink flow. Preserve existing build labels during migration.
  Intake already rejects link rows; the missing work is their producer and dedicated authenticated sender.
- [ ] Define private-sync consent, scopes and source ownership before automating held progress uploads (COL-C00).
  Reusing a manually consented publication grant for an early demo does not make it a private owner-sync pipeline.
- [ ] Add owner completion lookup and test copied install identifiers cannot reveal private owner-only data.
- [ ] Verify Lua schema and focused sender/route/SQL tests; independently review before a local commit.
- [ ] Prepare, but do not execute, migration/flag/release instructions and a rollback that preserves existing labels.
- [ ] When servers return, accept one real character end-to-end before enabling the whole roster.

## Task 3: Correct current completion and reputation

**IDs:** COL-C02..03, HUB-P04..05. **Depends:** identity ADR for joins; catalogs can be tested independently.

**Files:** `addon/modules/completion.lua`, `kb/src/completion.ts`, `kb/src/completion-rollup.ts`,
`web/src/app/tools/collections/OverviewView.tsx`, `CompletionView.tsx`, Desktop `characters.ts` and shared types;
existing pure completion, renderer and addon contracts.

**Interfaces:** define eligible catalog coverage alongside observed progress. Unknown applicability is not
silently excluded or treated as zero; totals state whether they are observed, agreed or authoritative.

- [ ] Add fixtures: faction-exclusive entries, unsupported renown, collapsed faction windows, unknown catalog,
  collector cap/eviction and changed denominator. Define the expected numerator/denominator and explanatory state.
- [ ] Confirm failing tests before the minimal metadata/fold changes; do not infer opposing-faction rules from names.
- [ ] Add a local-only name/key map and test it cannot enter public upload payloads.
- [ ] Reconcile multiple files using approved identity mappings; retain separate rows where identity is uncertain.
- [ ] Point main/active selection and alt roster at approved links without breaking saved-build labels.
- [ ] Build the first reputation/collection view with freshness, unknown/inapplicable, closest goals and item sources.
- [ ] Run pure-function, authorization and UI tests, review, then document live-client checks separately.

## Task 4: Durable completion history

**IDs:** HIST-01..04. **Depends:** canonical identity, source provenance/deletion policy and measured storage ADR.

**Files:** new versioned history contract in `packages/protocol/` if wire data is required;
`addon/modules/completion.lua`, `kb/src/completion-rollup.ts`, a new pure history fold and tests,
async private store/API and character timeline UI. Exact storage-specific files follow the storage ADR.

**Interface to approve:** event identity, canonical character reference, source/upload reference, kind/entity,
observed-at, optional game-reported date, before/after value, schema/client build and replay revision.

- [ ] Choose bounded event retention and source-removal semantics; calculate representative size before choosing storage.
- [ ] Add deterministic replay tests for duplicates, out-of-order inputs, multiple installs, missing baseline,
  changed catalog, revoked grant and deleted source. Assert retained milestones have correct provenance.
- [ ] Implement the pure fold/diff; a baseline snapshot does not invent prior unlock times or gains.
- [ ] Capture meaningful changes before latest rows are replaced, with explicit cap/backpressure notices.
- [ ] Implement idempotent writes and paged, account-scoped reads; test partial failure, retry and deletion/rebuild.
- [ ] Add recent-milestone and reputation-gains views; use first-recorded wording unless the game supplied the date.
- [ ] Run focused suites, review, and measure memory/query work; do not add a whole-world JSON response.

## Task 5: Capability evidence and economy correctness

**IDs:** PROBE-01, ECON-E01..03, ITEM-I01, COL-C04.

**Files:** existing `addon/modules/auctions.lua`, `gold.lua`, `gear.lua`, `professions.lua`,
`addon/tests/auction_contract.py`, `gold_contract.py`, `packages/protocol/src/records.ts`,
`kb/src/market.ts`, `gold-ledger.ts`, site auction/gold-ledger views and MCP tool descriptions.

**Interface:** a versioned capability result is `supported`, `unavailable`, `error` or `unverified`,
with client build, probe date and evidence location. It is not a public observation or telemetry upload.

- [x] Prepare a private local evidence checklist before servers reopen: actual calls, expected non-sensitive
  shapes, failure handling and corresponding collector/test. See the [PROBE-01 kit](../../2026-10-28-live-client-capability-checklist.md).
  Prepared only; live results remain unverified. Never dump names, GUIDs or raw party logs into a PR.
- [ ] Audit wording and fixtures across all market surfaces: asking prices, completed personal transactions,
  units, realm/house, stale/partial/unrecorded values. Add a failing assertion only where actual wording is wrong.
- [ ] Correct proven copy/semantics gaps without changing rollup thresholds or interpreting disappeared listings as sales.
- [ ] Specify ownership, consent and missing-window semantics for learned recipes and bag/bank snapshots before capture work.
- [ ] Extend transaction categories only when a client event/API can attribute them; test unrelated money changes remain unrecorded.
- [ ] Verify auction cooldown, API rows still loading, scan cancellation and bounded final processing in the real client.
- [ ] For each supported probe, write a focused collector plan with schema/Lua fixture, intake and dashboard acceptance.

## Task 6: Format-neutral local log reader

**ID:** LOG-L01. **Owner:** Desktop/companion; no server or migration resource changes.

**Files:** create `companion/src/log-tail.ts`, `companion/test/log-tail.test.ts`.
Do not wire automatic game-folder discovery, parsing, upload or a UI into this task.

**Proposed testable interface:**

```ts
type TailCursor = { fileId: string; offset: number; pending: Uint8Array };
type TailChunk = { cursor: TailCursor; lines: string[]; reset: boolean; more: boolean };
// File identity and read semantics are adapter responsibilities; offset counts all consumed file bytes,
// including bytes in pending. A reset discards pending from the old generation.
readLogChunk(source: LogSource, cursor: TailCursor | null, limits: TailLimits): Promise<TailChunk>;
```

Approve the small `LogSource` adapter and numeric byte/line/pending caps in this focused plan before
implementation. They must be measured against a fixture, not inherited from addon upload limits.

- [ ] Specify append, same-size rotation identity, truncation, incomplete final UTF-8/CRLF, bounded pending line,
  and unreadable-file behavior in the focused contract. Cursor updates are explicit, not persisted implicitly.
- [ ] Write failing tests using synthetic files: append, rotation, truncation, duplicate reread, partial line,
  byte cap on a 50 MB fixture, oversized line and read failure. Assert no raw upload and no unbounded full-file read.
- [ ] Implement the minimal adapter/pure chunking behavior; an incomplete final line is never emitted twice.
- [ ] Run focused tests and typecheck; independently review cursor offsets, replay and reset before commit.
- [ ] Keep actual format parsing blocked on PROBE-01 evidence; supported event types are not guessed.

## Task 7: Own-character PvE and PvP history

**IDs:** PVE-E01..02, PVP-V01..02, LOG-L02..03. **Depends:** actual API/format evidence and private identity/sync.

**Files:** existing `addon/modules/openworld.lua`/`players.lua` for encounter behavior;
new module-specific collector/schema/test paths follow the accepted capability contract. Do not widen
the census or player-sighting API allowlist to implement a private PvP collector.

- [ ] For confirmed encounter START/END, add optional timing/own-character context in a private contract;
  missing START, reload/disconnect or unmatched END yield unknown duration, never a guessed result.
- [ ] Test schema, Lua producer, authenticated private ingestion, deterministic fold and owner view as one slice.
- [ ] Keep anonymous encounter/catalog and public guild agreement distinct from personal participation.
- [ ] For supported PvP APIs, define match identity, outcome, reset/build/season boundaries and source timestamps;
  test duplicate/abandoned/incomplete matches. Do not assume Forever has arenas or ratings.
- [ ] Add progress/history views only for supported fields; unknown collection coverage remains visible.
- [ ] Parse a sanitized real combat fixture locally, testing nested/missing START/END, unknown events and partial records.
- [ ] Expose opt-in local recent fights and logging toggle only if that toggle is proven to work on the client.

## Task 8: Detailed combat processing design gate

**IDs:** COMBAT-D01..03. **Not dispatchable as server implementation yet.**

- [ ] Measure representative raw file size, local parse time/memory and summary volume; record supported event coverage.
- [ ] Compare local summaries, optional raw retention and bounded async processing; record recovery, deletion,
  identity/participant privacy and cost. Select a store/processor separately from the knowledge D1 migration.
- [ ] Specify bounded authenticated ingestion, replay identity, schema/client version and source deletion.
- [ ] Define metric validity and comparison cohorts before percentiles/rankings. A kill signal cannot prove DPS,
  healing, interrupts or mechanics, and incomplete combat events must suppress unsupported metrics.
- [ ] Obtain the explicit product/privacy/storage decisions, then write the separate implementation plan and tests.

## First dispatchable work after plan review

1. Owner review of the existing collector reliability delivery, then push/PR when authorized and packaged
   acceptance through the existing release process; preserve all current source changes. Package publication,
   signing keys and native installation are separate from routine source implementation.
2. SEC-01 route/cache privacy audit with targeted regressions for demonstrated gaps, owned separately from migration.
3. PROBE-01 evidence kit and ECON-E01 terminology consistency; no live-data or infrastructure changes.
4. HUB-P01 ADR to unblock private account-character work; COL-C02 coverage fixtures can proceed independently.

Do not dispatch server combat analysis, a public ownership badge or a whole character-history backend from
this master plan alone. They have named design gates rather than silently chosen storage/security rules.

## Task 9: Reliability follow-ups

**IDs:** REL-06..09. **Owner:** companion/Desktop for code; web uploader owner for REL-07 after overlap check;
operator for REL-09 publisher keys and package acceptance. **Depends:** accepted REL-01..05 source set.

**Files:** existing `desktop/src/main/engine.ts`, companion uploader/CLI and tests (REL-06);
`web/src/lib/upload-batches.ts` and upload UI/tests (REL-07); Desktop update/download/launch modules and
tests (REL-08); existing release workflow and native acceptance checklist (REL-09).

- [ ] REL-06: reproduce a Retry-After/scheduler disagreement and exhausted retries; test no overlapping jobs,
  respected server wait and explicit manual/reconnect recovery. Preserve partial accepted-row receipts.
- [ ] REL-07: port rejected-batch behavior through an agreed shared contract, test browser interruption/retry
  and permanent-refusal visibility; never fabricate durable receipts or silently widen sharing.
- [ ] REL-08: add failing regressions for hostile URLs/filenames, oversized bodies, checksum failure and installer
  launch errors; implement minimal recovery-safe guards without adding an unapproved signing service.
- [ ] REL-09: prepare the publisher-trust/key-rotation decision and isolated install/upgrade/uninstall checklist.
  The operator handles real keys and package acceptance; code tests cannot establish independent publisher trust.
- [ ] Run affected suites/typechecks, independent review and updated package acceptance for each separate task.

## Final acceptance

- [ ] No task marked complete from a test-file inspection alone; record executed evidence and exact revision.
- [ ] Read deployed flags/migrations before activation; resolve conflicting status notes explicitly.
- [ ] Reconcile this readiness branch with the reviewed migration branch without absorbing unrelated changes.
- [ ] Repeat affected combined checks on the integrated revision; run Linux target builds in CI.
- [ ] Run package/native and live-client matrices; preserve personal files and source uploads.
- [ ] Review rollout/rollback, costs and public capability wording before cutover or release.
