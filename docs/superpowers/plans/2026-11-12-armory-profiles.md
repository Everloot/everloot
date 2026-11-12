# Lightweight armory implementation plan

> Each task includes a behavior test, implementation and verification.

Goal: deliver the approved portrait/equipment profile, useful supported detail, discovery, manual entry, refresh and truthful acknowledgment.

Architecture: extend the existing budgeted crawler, service-only armory SQL and server-rendered Next.js pages. Reuse game assets, item tooltips, queue quotas and linked-character consent readers.

Spec: ../specs/2026-11-12-armory-profile-design.md

## Tasks

- [x] Normalize optional API details in `kb/src/armory/details.ts`; test supported/missing/malformed fields and same-character endpoint validation. Extend crawler with revision backfill and budgeted optional reads; test optional failures and 304s.
- [x] Add armory detail persistence and a throttled refresh RPC in a new migration. Extend `web/src/lib/armory-store.ts`; test SQL round trips, hide, cooldown and compatible legacy rows.
- [x] Replace the equipment table with a responsive complete-slot layout using ItemTip; add portrait, supported sections, tools links and source dates. Test rendered profile, empty equipment and missing optional detail.
- [x] Accept official armory URLs in submission, retain field entry, and add a refresh POST with quota and honest status. Test hostile URLs and refused/queued results.
- [x] Add explicit account-character armory association and safe public acknowledgment. Reuse existing auth, frozen-link and consent boundaries; test private/frozen/unlinked behavior. Retain guild-roster discovery and document unresolved identities rather than guessing.
- [x] Run relevant tests, types, lint and design guard; run fresh branch review, fix findings, and record exactly what is implemented versus live-verified.

## Review focus

Optional malformed data must not delete a base character. Links must not allow cross-host or cross-character requests. A profile 304 must not prevent backfill. Repeated refresh must not bypass per-character cooldown. Sighting and link creation are not accepted-upload evidence.

## Execution ledger

2026-11-12: clean worktree; protocol dependencies installed and built. Production Blizzard credentials absent locally, held by existing Actions job. Builder review confirmed the identity gap and call-budget/backfill requirements. User's prior explicit approval covers implementation; no repeated design approval requested.

2026-11-12 implementation: added surname-aware named-upload discovery (protocol 2.2.0 / record protocol 1.14.0), including own and encountered characters. Full-name records bypass the legacy first-name sighting table, preventing surname collisions. Actual API guild slugs seed rosters. Observation days expire after 30 days. Existing named-sharing opt-in remains required; older anonymous/first-name-only uploads cannot be retrospectively attributed.

Review corrections: optional HTTP 403 no longer aborts a healthy base profile; new association table participates in the restricted backup role; private/frozen/hidden associations stay absent. Two read-only branch reviews completed without remaining blocking findings after fixes.

Verified so far: protocol 104 passing tests (1 expected failure), knowledge base 2097 passing tests (1 skipped), addon 51 contract suites plus 2 planner contracts, SQL applies twice and exercises role grants/consent/discovery/cooldowns/hide/retention, web types and lint (3 existing warnings), scratch addon package builds without touching the published archive. Full web test run had an unrelated talent-page timeout under concurrent load; its 16 focused tests passed; full rerun in progress.

Final verification: full web rerun 5617 passed / 30 skipped; Next production build passed with the absent local knowledge snapshot reported. Release order and remaining live checks are in docs/2026-11-12-armory-profile-rollout.md. No production migration, deployment or release has been performed.
