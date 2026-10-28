# Unified player platform: scope and boundaries

Date: 2026-10-28. Status: implementation order approved; review findings resolved. Capability,
identity-policy and deployment gates remain open where explicitly listed.

## Intended outcome

One player hub connects a person's linked characters and alts with their collections, reputations,
professions, equipment, economy, PvE progression and PvP activity. Each figure explains its source,
scope and freshness. The website is the proposed full dashboard; Desktop collects and synchronizes
data and offers a compact local view. That surface choice is a proposal, not a completed feature.

References for product behavior: Completionism category browsing, Simple Armory character/reputation
views, and Warcraft Logs-style encounter analysis. Their data and code are not inputs to the product.
Detailed combat reports and PvP tracking are new capabilities, not consequences of having profiles.

## Existing foundation

- Addon collectors, protocol schemas, intake, private uploads, public aggregates and MCP tools exist.
- Completion provides latest achievement/reputation state and title/quest additions, with catalogs
  requiring agreement. It is not a complete historical record.
- Character-link primitives exist, but the player-facing link flow and a unified character root do not.
- Local alts, build-character labels, public sightings and owned completion have different identities.
- Encounter-end and guild-kill observations are not per-cast combat logs.
- Desktop/companion reliability improvements are verified locally at `29a51c6f`, not publicly released.

## Approach

Reuse the current collectors and stores, establish identity and history contracts, then ship independent
vertical slices. This is preferable to a replacement platform, which would duplicate working intake,
permissions and tools. A dashboard-only approach would hide missing identities, catalogs and history;
it cannot satisfy the requested tracking. This is the proposed implementation sequence.

## Identity and visibility

1. Agree one owned-character root before joining the current identifiers. Retain alias mappings and
   source provenance; never merge people merely because names, classes or realms look alike.
2. Account authentication and an addon-file claim are different assurance levels. Existing link codes
   do not constitute independent Blizzard ownership verification. Do not label them as such.
3. Personal dashboards are private by default. Public sightings remain governed by their separate
   existing policy; extending a private profile must not expose its gear, economy or history publicly.
4. Record which source supplied each private fact. Unlinking, revoked sharing, opt-out and deletion
   need explicit effects on raw data, derived history, search and caches.
5. Reinstallation, multiple machines, names/realm normalization, disputed links and secret rotation
   require fixtures and a recovery policy. Cross-character totals mean a union of linked characters,
   not a claim of native account-wide or Warband rules.
6. Linking alone must not start uploading named progress. Define explicit private-sync consent/scopes
   and source ownership separately from optional public sharing. Desktop's existing held-row defaults
   stay in place until that private pipeline is implemented and accepted.
7. Reconcile the existing `character_visibility` fields (`page_public`, `show_*`, `ranked_*`, `indexable`)
   in the identity ADR. Public/ranking/indexing flags remain unused until corresponding contracts exist.
   Reuse existing `unlink_character`, `set_visibility` and `public_character` functions when appropriate;
   deleting a saved-build label is not unlinking an owned character.

## Tracking semantics

- Distinguish latest state, first observed state, observed change and a game-reported completion date.
- Show unknown/unrecorded separately from incomplete, zero, unavailable or not applicable.
- Define catalog completeness and character eligibility before showing a percentage. Opposing-faction
  and unavailable content must not make an eligible character's completion impossible.
- Report catalog pruning, missing APIs, dropped rows and partial scans; an observed catalog is not the
  entire game's denominator. A changed denominator must not masquerade as player progress.
- Preserve and deduplicate progress changes before a collector replaces its latest-state row.
- Replaying inputs produces deterministic derived events; reprocessing and source removal must not
  duplicate milestones or leave revoked history behind. Append-only ingestion is not irrevocable storage.
- Auction asking-price observations, completed purchases/sales and unattributed money are different data.
- Do not infer damage/healing, ratings, encounter participation or behavior from data that cannot prove it.
- A recipe observed in a profession window is not automatically a durable per-character learned-recipe
  list. Equipped gear is not a complete bag/bank inventory. Both need explicit capture coverage.

## PvE, PvP and combat scope

PvP is already in the requested scope. Probe actual honor, battleground and any rating/season APIs
before choosing supported fields. A missing arena/season API is an unavailable feature, not zero progress.

First establish own-character encounter/result history. Add a format-neutral, bounded local file reader
before live samples if useful. Only build the combat parser against an actual supported and sanitized
Forever format; verify START/END availability, incomplete encounters and log event coverage. Existing
encounter rows lack reliable per-character attribution and cannot be relabeled retroactively.

The proposed first combat delivery is opt-in and local-only. No raw logs leave the machine in that
slice. Any later summary ingestion, optional raw retention, participant identity disclosure and rankings
requires its own contract and measured architecture. Neither raw logs in R2 nor summaries in the
knowledge-release D1 are settled decisions. Public third-party observations stay under existing policy.

## Cloudflare compatibility

The approved destination is Next.js/OpenNext on Workers, R2 assets/uploads, D1 for the approved
knowledge/search release, Supabase Postgres accounts, and offline builds/extraction. Existing migration
work owns its branch/resources. This plan does not authorize a second migration or a DNS switch.

New private-player history storage and high-volume combat processing are separate decisions. Do not
put them in the read-only knowledge release or one growing JSON object by default. Prefer async,
paged store contracts and bounded work; select storage after a measured representative fixture.

- No reliance on a host repository filesystem or native SQLite on a Worker request path. Content bundled
  at build time may use a supported read-only runtime adapter if the migration owner proves it on Workers.
- Private responses bypass shared caches; revalidation/purge must remove hidden public information.
- Exactly one scheduler writes each rollup during overlap and cutover; verify replay and rollback.
- Test auth connections across separate Worker requests, not just one successful sign-in.
- Measure the same public and private routes before/after; no promised performance multiplier.
- Follow the existing decision: production cutover after November 4 and only after parity acceptance.
- Workers Paid is approved; new paid products or changed spending require a separately named decision.

## Team operations and SaaS structure

Owner direction, 2026-10-28: prepare Everloot to be maintained by a small team, with clear follow-up across
support, engineering and service operations. Collaborators are prospective; no membership, access or duty
assignment is implied. This adds operational requirements, not a decision to introduce paid subscriptions.

- Each maintainer uses an individual account. Define scoped roles for support, maintenance and administration
  before granting access; avoid shared credentials. Team access is separate from player accounts and character links.
- Track support cases, including character disputes, with an id, category, status, assigned maintainer,
  timestamps, next action and resolution. Keep a private timeline of decisions and minimal necessary evidence.
  Decide contact channel and response wording before promising support review (identity ADR D8).
- Record sensitive operator actions with actor, time, target, reason and outcome. Freeze/unfreeze, unlink,
  deletion, permission changes and release operations need attributable records; exclude secrets and raw player files.
- Support access does not automatically expose private dashboards, grant exports or permit dispute resolution.
  Define and test authorization per action; revoke access when a maintainer leaves.
- Maintain one work queue with owners, dependencies, acceptance criteria and links to issues/changes. Document
  onboarding, incident handling, backup/restore, deployment/rollback and maintainer offboarding.
- Provide an operational view of sync failures, service health and release versions using minimal metadata.
  Player support cases and private evidence must remain separate from public status information.

The first slice is a permissions matrix and support workflow, followed by a narrow authenticated operator
case list and case detail view. Reuse existing authentication and project tracking where suitable; choose any
new tooling, schema or vendor only after reviewing current capabilities. Organization tenancy, billing,
subscriptions and unrestricted staff impersonation are outside this requirement.

## Delivery gates

1. Plan and coverage register: files, dependencies, owners, acceptance and uncertainty recorded.
2. Fixture acceptance: schema, authorization, deduplication, retention and recovery proven offline.
3. Cloudflare staging: accounts, private caching, public purge, schedulers and database parity proven.
4. Native/package acceptance: isolated data folder, install/update/uninstall, multiple account files,
   restore/retry, actual watcher behavior and retained credentials/data reviewed.
5. Live Forever acceptance: capability probes and real saved files/logs; no synthetic data publication.
6. Release: reviewed versions/artifacts, checksums, rollback and update discovery accepted.

Complete tracking is not claimed until each supported capability has evidence through all relevant gates.

## Open product/technical decisions

- Link assurance, disputes and whether any public ownership badge is appropriate.
- Source retention and deletion semantics for private history and combat participants.
- Private history store/partition strategy after a representative load fixture.
- Actual Forever PvP APIs and combat-log format/completeness; these may limit supported features.
- Initial character/category scope and optional sharing; renown requires explicit support.

See the [gap register](../../2026-10-28-platform-gap-register.md) and
[implementation plan](../../superpowers/plans/2026-10-28-platform-readiness.md).
