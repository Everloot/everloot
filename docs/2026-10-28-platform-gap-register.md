# Platform gap register

Date: 2026-10-28. Implementation order approved; review findings resolved. Code baseline `29a51c6f`;
Cloudflare committed spike baseline `6dba219e`, with additional uncommitted work owned by the migration terminal.
Code evidence is not deployment evidence. Existing feature flags and database migrations must be
read back before activation; older status notes disagree and are not proof of the current live state.

## Ready locally, awaiting delivery acceptance

| ID | Capability | Evidence | Still required |
|---|---|---|---|
| REL-01 | Addon swap rollback and preserved recovery copies | Focused regressions and independent review | Real locks; packaged update acceptance |
| REL-02 | Bounded upload request/body, status-aware errors | Timeout/body/HTTP tests; independent review | Slow-link and native acceptance |
| REL-03 | Only accepted rows marked sent; rejected batches do not starve later data | Mixed/malformed/contradictory receipts, multi-batch retry tests | Production-compatible endpoint acceptance; browser equivalent |
| REL-04 | Shared recovering CLI/Desktop watcher | Rename/error/stale/stop regressions, Windows real-file test | Native Linux/macOS save behavior |
| REL-05 | Addon and all generated slot interface parity | Written TOCs; deliberate mismatch fails | Live client interface and slot loading |

Parent verification: companion 115 and Desktop 231 tests, both typechecks, Desktop source bundle pass.
This set is committed locally, not pushed, installed, packaged or released.

## Cloudflare dependencies: existing migration owns implementation

| ID | Gap / deliverable | Depends on | Acceptance |
|---|---|---|---|
| CF-01 | Incremental page cache, queue and tag cache | Existing spike | ISR pages render; tag/path invalidation changes content |
| CF-02 | Bundle or bind runtime repository content | Existing spike | Every file-tracing route renders without repository fs |
| CF-03 | Correct current limits and route dependency inventory | Official docs | Measure uncompressed bundle/startup; distinguish Desktop-only fs imports |
| CF-04 | Secrets and per-store R2/S3 binding choice | Store inventory | Required settings present without exposing values; missing settings fail clearly |
| CF-05 | Request-safe authentication database connections | CF-04 | Separate successive/concurrent requests, logout and connection failure behave correctly |
| CF-06 | Single-writer scheduler and bounded rollups | CF-04 | Replay/concurrent invocation fixtures; one writer during migration; ten-minute trigger fits its CPU budget using bounded resumable chunks |
| CF-07 | Versioned knowledge release import and async D1 reads | Release manifest | Search/FTS/lore/MCP/sitemap fixture parity; restore original release on failure |
| CF-08 | Linux CI build, route parity and rollback | CF-01..07 | Exact artifact built and tested on target runtime |
| CF-09 | Public tag purge on a controlled custom hostname | CF-01, SEC-01 | Hidden player/guild disappears from warm page/search cache before production cutover |
| CF-10 | Production cutover after November 4 | CF-08..09, PERF-01 | Owner executes reviewed cutover/rollback; Access mode and scheduler ownership verified |

## Cross-platform safeguards: readiness implementation can proceed separately

| ID | Gap / deliverable | Depends on | Acceptance |
|---|---|---|---|
| SEC-01 | Private/public cache contract | Existing routes | No shared-cache reuse of `/home`, accounts, auth or `/api/me`; cookie rewrite and opt-out tested |
| PERF-01 | Comparable before/after performance baseline | CF preview access | Same route/query set and client; cold/warm median/p95, errors, CPU, query work and sample count |
| REL-06 | Retry-After/exhausted retry recovery | REL-02 | Server wait honored; no overlapping jobs; manual/reconnect recovery after exhaustion |
| REL-07 | Browser uploader rejected-batch parity | REL-03 | Reject-only batch cannot starve later batches; clear partial outcome; no fabricated durable receipt |
| REL-08 | Updater URL/path/size/launch safety | Existing updater | Hostile filename/URL, oversize, checksum failure and launch error preserve recoverability |
| REL-09 | Publisher verification design and packaged acceptance | REL-08 | Trust and key rotation documented; package upgrade/rollback/uninstall tested separately |

REL-06A is implemented locally and independently accepted at `119ad0a6`: structured rate-limit metadata,
per-job/site-origin deadlines, stopped/restarted-session protection, timer-overflow guard and invalid-address
recovery. Parent companion 117 and Desktop 240 tests, both typechecks and Desktop bundle pass; reviewer
engine 22/22 pass. No public delivery or app-restart persistence is claimed. REL-06B (network-return and
exhausted-retry recovery) remains open; it is not closed by the Retry-After fix.

## Identity, character hub and completion

| ID | Gap / deliverable | Depends on | Acceptance |
|---|---|---|---|
| HUB-P01 | Owned-character identity/assurance ADR | Existing five identities | Canonical root, alias joins, claim labels, dispute/rotation/unlink semantics agreed; existing public/ranked/indexable flags stay unused until corresponding contracts accepted |
| HUB-P02 | In-game link producer and authenticated Desktop/CLI delivery | HUB-P01 | Link rows go only to dedicated authenticated endpoint; no GUID/code in public intake (intake rejection already exists) |
| HUB-P03 | Owner list/unlink/visibility endpoints and account UI | HUB-P01 | Reuse existing unlink_character/set_visibility SQL functions; schema changes require ADR; cross-account access denied; origin checks; frozen links private |
| HUB-P04 | Main/active character and alt roster use linked identities | HUB-P02..03 | No accidental merge; multi-install and renamed/normalized realm fixtures; labels preserved |
| COL-C00 | Explicit private progress consent and authenticated sync contract | HUB-P01..03 | Link alone never uploads held named progress; private owner access and optional public sharing are separate; scoped key/revocation enforced |
| COL-C01 | Owner completion lookup without typed install identifiers | HUB-P02..03, COL-C00 | Signed-in owner works with consented data; other accounts/frozen/revoked sources excluded |
| COL-C02 | Eligible, coverage-aware completion denominators | Captured catalog metadata | Opposing-faction/not-applicable excluded when proven; incomplete catalog labeled; unknown not zero |
| COL-C03 | Local name/key mapping and cross-file reconciliation | HUB-P01 | Named local summary; multiple accounts deduplicated with proof; mapping never publicly uploaded |
| HIST-01 | Provenance-aware historical event contract | HUB-P01 | Game date vs first-recorded date distinct; deterministic replay; source deletion/revocation handled |
| HIST-02 | Capture changes before latest-state replacement | HIST-01 | Offline changes survive reload/retry within stated retention; unchanged reads create no duplicate events |
| HIST-03 | Paged private history storage and API | HIST-01, measured storage decision | Account isolation, bounded reads, idempotent writes, deletion/restore, no whole-world JSON request |
| HUB-P05 | Character/reputation/collection dashboard | COL-C01..03, HUB-P04 | Current, missing, unknown and inapplicable states; freshness; no exposure through public sightings |
| HIST-04 | Milestones and gains views | HIST-02..03, HUB-P05 | Daily gains/milestones match replay fixtures; denominator changes are not player achievements |
| COL-C04 | Per-character learned professions/recipes coverage | Client capability probe, COL-C00 | Learned ownership is not inferred from anonymous recipe observations; stable IDs, unknown/unlearned distinction and character attribution tested |

## Economy, items, PvE and PvP

| ID | Gap / deliverable | Depends on | Acceptance |
|---|---|---|---|
| PROBE-01 | Forever capability evidence kit | Live servers for observed results | Record supported/missing/error for reputation, learned recipes, inventory, encounter start/end, combat file/logging toggle, honor/BG/ratings/season; build and API provenance; no unsupported metric shown as zero |
| ECON-E01 | Asking-price/source/freshness/scope audit | Existing market | Site, MCP, Desktop and tooltips never describe listings as completed sales; correct unit/realm/house; missing/stale/partial scans explicit |
| ECON-E02 | Auction full-scan completeness and cooldown | PROBE-01 | Real API throttle, unloaded/retry rows, interrupted scans, realm/house partitions and large-house frame work observed; no assumed Retail cooldown validation |
| ECON-E03 | Personal transaction attribution gaps | COL-C00, PROBE-01 | Separate bids, deposits, repairs, trade/mail where evidence exists; unattributed difference stays unrecorded; own sales do not become market volume |
| ITEM-I01 | Equipped gear versus bag/bank inventory contract | HUB-P01, COL-C00, PROBE-01 | Scope and API availability explicit; private per-character ownership; equipment observations do not imply full bag/bank/alt inventory |
| PVE-E01 | Character-scoped personal encounter summaries | HUB-P01, COL-C00, PROBE-01 | Optional START/END duration, kill/wipe, realm/character, missing START/reload/unknown states; existing anonymous encounter rows not retrospectively assigned to an alt |
| PVE-E02 | Personal raid/dungeon history and guild joins | PVE-E01, HIST-03 | Distinct personal participation and public guild agreement; roster snapshots/freshness; no inferred performance score |
| PVP-V01 | Own-character PvP result schema and collector | PROBE-01, HUB-P01, COL-C00 | Only supported honor/BG results collected; fixture dedup, abandoned/unfinished match and reset boundaries; unsupported ratings/arenas/seasons labeled unavailable |
| PVP-V02 | PvP history dashboard | PVP-V01, HIST-03 | Outcome/stat totals match fixtures; character/realm/build/season scope explicit; no fabricated rating or class-normalized percentile |
| LOG-L01 | Format-neutral bounded local log reader | No live format needed | Append/rotation/truncation/partial UTF-8/offset replay, unreadable file, oversized line and backpressure tested; no upload |
| LOG-L02 | Real-format encounter parser and local summaries | LOG-L01, PROBE-01 usable sanitized sample | Local deterministic kill/wipe/duration summaries; missing END/nested START/unknown events/build variants covered; unavailable fields remain unknown |
| LOG-L03 | Optional logging integration and local recent-fights view | LOG-L02, PROBE-01 | Explicit opt-in, supported toggle only, local retention/disable/recovery; no combat-event access assumed |
| COMBAT-D01 | Combat ingestion/storage/privacy design | Actual log evidence, measured LOG-L02 output | Decide local summaries versus optional raw retention; participant privacy and costs; no default reuse of knowledge D1 or addon intake |
| COMBAT-D02 | Authenticated summary ingestion and replay | COMBAT-D01, HUB-P01, COL-C00 | Bounded payloads, idempotency, provenance, deletion and corruption recovery; raw log upload off unless separately designed/approved |
| COMBAT-D03 | Detailed combat analysis and comparison rules | COMBAT-D02, verified event completeness | Damage/healing/casts/deaths/interrupts only when proven by event coverage; encounter/role/build/gear cohorts and minimum sample rules defined before rankings |

PvP is already requested product scope. API availability, participant disclosure and storage are open;
scope approval is not an excuse to fabricate support. Combat parsing requires a real supported sample,
but a format-neutral bounded file reader and test harness can be implemented beforehand.

## Coverage outside the first implementation waves

Keep these audited items visible rather than calling this an exhaustive code audit: addon guild-departure
versus unavailable APIs; roster debounce/dedup/byte budget; receipt-safe immutable-row rotation; final auction
sort/storage workload; local receipt growth and repeated Lua parsing; restore while the game is open;
settings corruption/save feedback; portable startup/login behavior; Electron IPC/window hardening;
local key/backup retention disclosure; revoked `/ask` credentials; realm-price fetch timeout and CLI/Desktop
slot overwrite parity. Each needs a focused reproduction/evidence task before implementation.

## Decisions and live-only gates

- A self-submitted addon row is not independent proof of Blizzard account ownership.
- Public profile fields, private history retention and participant privacy require explicit contracts.
- Link/profile flags and migrations need current environment readback before activation.
- Actual client calls, scan throttling, file/log formats, slot loading and multi-account behavior need live checks.
- Combat processing capacity/storage and new paid services are not approved by the knowledge D1 migration.

All IDs above are plan-local names, avoiding collisions with earlier implementation waves.

## Official platform checks, read 2026-10-28

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): current size limit is
  64 MiB uncompressed, not the spike note's 10 MiB gzip assumption. Measure startup as well as upload size.
- The same page gives 128 MB memory per isolate. Scheduled invocations less than one hour apart have
  a 30-second CPU allowance; wall time is separate. Do not translate Next.js `maxDuration = 300` into
  an equivalent Worker cron CPU budget. CF-06 must measure the existing ten-minute job and checkpoint work.
- [OpenNext cache documentation](https://opennext.js.org/cloudflare/caching): cache purge requires a zone/custom
  domain. Verify opt-out/hide through a controlled custom hostname before accepting production cutover.
- [Database connections](https://developers.cloudflare.com/workers/databases/connecting-to-databases/)
  and [TCP socket constraints](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
  are the primary references for CF-05; prove request lifetime behavior in staging rather than assuming the
  existing process-global Postgres pool is portable.
