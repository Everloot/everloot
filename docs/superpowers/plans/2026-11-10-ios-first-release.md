# iOS First Release Implementation Plan

**Goal:** Deliver a native, sourced chat/search/database experience and a verifiable distribution candidate.

**Architecture:** The iPhone client consumes the existing public tool API and free completion proxy.
Data collection, normalization, provenance, and quotas remain in the existing backend.

**Tech stack:** SwiftUI, Foundation URLSession, Codable, XCTest; existing HTTPS JSON/SSE services.

**Spec:** [First-release design](../specs/2026-11-10-ios-first-release-design.md).

## Global constraints

- iOS source belongs to the private `Everloot/ios` repository; backend verification belongs here.
- No privileged mobile secrets, new paid services, mandatory account, or invented game facts.
- Native execution continues task by task; blockers on signing must not stop unsigned verification.
- Preserve existing changes; show the candidate and evidence before public release.

## Review focus

Unknown fields must not become zero; record IDs must not become game IDs; HTML challenges must
not become empty success; a stopped request must not update a newer search; model failures must
leave search useful. The corresponding tests belong to tasks 1 and 2.

## Task 1: Public data readiness — this repository

- [x] Add `scripts/test_ios_api_smoke.py`: fixture tests for identifiers, provenance, unknown facts,
  disconnected storage, malformed responses, and independent request failures.
- [x] Run it before implementation; observe import failure for the absent checker.
- [x] Add `scripts/ios_api_smoke.py`: `check_response(tool, body)` returns contract failures;
  `run_checks(fetch)` returns one safe status per public request. No credentials or mutations.
- [x] Run nine fixture tests and eight live checks, with explicit positive/negative search and detail-ID assertions.
- [x] Commit the checker, design, plan, and usage documentation.

## Task 2: Native complete flow — iOS repository

- [ ] Inspect repository instructions and actual Xcode, simulator, and signing capabilities.
- [ ] Record a file map and implementation ledger in the iOS repo before code.
- [ ] Write and observe failing behavior tests for a URLSession API client and typed search/evidence/
  detail models using local fixtures derived from the public schema. Pin ID routing, null fields,
  non-JSON/429/503, stale-search suppression, cancellation, source links, and data-age behavior.
- [ ] Implement the data client and make tests pass.
- [ ] Add native Ask, Search, Saved, and Settings navigation using existing Everloot branding.
  Search and sourced details work without an account or model configuration.
- [ ] Write failing chat-loop tests for SSE tool-call assembly, invalid arguments, unknown tools,
  bounded rounds, cancellation, failure fallback, and consent revocation. Implement and pass them.
- [ ] Add local history/saved records and delete controls with persistence tests. Add a privacy
  disclosure/consent flow appropriate to the existing free proxy's actual provider configuration.
- [ ] Build, run unit tests, and test search -> detail -> sourced answer on an iPhone simulator.
  Record the exact commands/results and exercise no-match and offline/error behavior.

## Task 3: Distribution candidate — iOS repository

- [ ] Prepare branded app icon, launch assets, privacy manifest as applicable, support/privacy links,
  App Store metadata and review notes, and reproducible build/archive/export instructions.
- [ ] Inspect existing signing and App Store Connect access without exposing keys or tokens.
- [ ] Run Release build/archive and appropriate validation with available signing; record any
  missing membership, signing profile, agreement, or credential as an exact blocker.
- [ ] Obtain an independent whole-change review and fix material findings before delivery.
- [ ] Present concrete candidate/evidence; upload to TestFlight with existing authorized access
  when feasible. Keep review submission/public release state explicit and separate.

## Task 4: Database expansion — only after task 2 passes

- [ ] Add existing vendor, profession, and spell support in small tested slices using public schemas.
- [ ] Re-run core journeys and failure checks after expansion. Do not add nonfunctional tabs.
- [ ] Record remaining feature milestones and write progress to shared project status.
