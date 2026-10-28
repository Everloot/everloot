# Owned-character identity and assurance (HUB-P01)

Date: 2026-10-28. Status: **proposed**. This ADR needs owner acceptance before HUB-P02..04, COL-C00..01 or
HIST-01 implementation. It changes no code, SQL or configuration. Feature flags and applied database
migrations are not verified here; read the current environment back before activating anything below.

Owner decision, 2026-10-28: competing character claims freeze both links and hide their linked dashboards,
including each account's own authenticated private progress, until support resolves the dispute. This accepts
the freeze policy in D0 and private-read behavior in D2, not the remaining ADR or activation requirements.
No data is shared between accounts. The owner list still shows the frozen state so each account can seek support.

Parent documents: [unified player platform](2026-10-28-unified-player-platform.md),
[gap register](../../2026-10-28-platform-gap-register.md) and
[readiness plan](../../superpowers/plans/2026-10-28-platform-readiness.md).

## Context: five identities that exist today

| Identity | Where it lives | Key | What it proves |
|---|---|---|---|
| Character link | `character_links` (Supabase), `20261021190000_character_links.sql` | `link_key` = HMAC(secret, `link:` + GUID); scoped by `user_id`, `(ruleset, realm_key, name_key)` | The account holder also held an addon file in which this character typed a live code |
| Completion key | Addon `C.Identity()`; completion rollup keyed by install id then character key | 8-hex Adler-32 of `installId:GUID`; link rows keep only `completion_ref` = HMAC(secret, `completion:installId:key`), while the anonymous completion rollup retains raw install id and key | Nothing about ownership. The install id is a random addon-file value and travels with copies of the file |
| Build label | `build_characters` (saved builds); `user_profiles.main_character_id` / `active_character_id` point at it | Row id; free-typed name, class, optional realm | Nothing. The label is typed and never checked against the game |
| Local alt | Browser workspace (`LocalAlt`), optionally imported from the player's own Everloot.lua | Device-local id; name/realm match during import | Nothing outside the device. Never uploaded |
| Public sighting | `players` table | `(ruleset, realm_key, name_key)` | That some install observed this name with this race/class/level/guild |

Relevant behavior of the existing link store, which this ADR keeps:

- Codes: 15 minutes, single use, 10 a day, stored as SHA-256 only. Up to 50 links per account.
- The GUID exists only in transit through `redeemLink`; the database keeps keyed hashes.
- A census disagreement on race/class/faction spends the code without revealing census contents.
- A second account claiming the same `link_key`, or the same `(ruleset, realm_key, name_key)`, freezes every
  account's link to that character. An operator settles it by hand. `public_character` returns only an unfrozen,
  unsuppressed link with `page_public`.
- Suppressed characters cannot be linked or shown.
- Every `character_visibility` flag defaults to false and nothing in the product sets them.
- `unlink_character` deletes the link and its visibility row; another account's frozen link stays frozen.
- `/api/me/characters/[id]` DELETE removes a **build label**, not a link.
- `rulesetOf()` currently returns one default ruleset for every realm.
- No addon command produces `character_link` rows yet, no Desktop/CLI sender delivers them and no account UI lists
  them. Intake already rejects link rows.

## Assurance: what a link is and is not

A link is an **addon-file claim**. It is not independently verified ownership of a Blizzard account or character.
The row is assembled by the addon and can be written by hand: GUIDs, names, race, class and faction of other
players are observable in game, so a forged row matching the census is possible. The census check only rejects
rows that contradict observations.

Consequences that this ADR makes binding:

1. User-facing words: "Linked from your addon file" or "linked". Never "verified", "owner", "proven" or a check
   mark. No public ownership badge is proposed (see decision D6).
2. A link grants **no access to data that the account did not itself send**. Private reads are joined by
   source ownership (below), not by the link alone. A forged link to someone else's character therefore yields
   an empty private dashboard, not their progress.
3. Class, race, faction, level, realm, name and GUID are publicly observable. They are never ownership proof and
   never resolve a dispute on their own.
4. Freezing stays: a forged claim can freeze a real link (denial of display), but cannot take it over. This
   tradeoff was accepted by the owner on 2026-10-28: both links and their linked dashboards are frozen pending
   support review, including otherwise authenticated private data. No independently
   trusted proof of game-character control is established by the current file bridge.
   The frozen result also tells a claimant that another account linked this character; the existing code quota
   bounds claims to ten per account per day. The disclosure wording and minimum D8 dispute contact/response
   policy still require review before activation.

## Decision

### 1. Canonical root: the existing `character_links.id`

The owned-character root is one `character_links` row: `(user_id, id)`. Dependent features refer to it as
`link_id`. A character is "owned" in this product only in the sense of "linked by this account, status `linked`".

Options considered:

| Option | Benefit | Cost |
|---|---|---|
| **A. Reuse `character_links.id` (recommended)** | No new root; existing freeze, suppression, unlink and visibility functions already operate on these rows | Unlink deletes the root, so history keyed on it ends with it (intended, see section 6) |
| B. New `owned_characters` table with links as one alias kind | Root survives relinking | Duplicates the freeze/unlink rules; two places to keep consistent; no product need yet |
| C. Use `(ruleset, realm_key, name_key)` as root | Simple joins with public sightings | Names are reusable after rename/deletion; would merge different people; contradicts the freeze model |

Game identity within one secret version is `link_key`. Display identity is `(ruleset, realm_key, name_key)`
normalized by `link_realm_key`/`linkRealmKey`. Display identities include ruleset; the existing GUID-derived
`link_key` and completion hashes do not include it. The ADR must define future namespace compatibility before
enabling another ruleset, rather than silently changing existing hashes. While `rulesetOf()` returns one
value, realms of different rulesets with the same normalized name would collide; a second ruleset must not be
enabled until ruleset comes from a realm list (decision D4).

### 2. Aliases

Aliases attach other identifiers to a root. Each records its kind, source and time; none of them merges two roots.

| Alias kind | Stored where | Created by | Assurance | Notes |
|---|---|---|---|---|
| `completion_ref` | Server, proposed `character_link_sources` (new) | Authenticated private sync presents the install id and completion key for an already consented link | Weaker than the link: install id and key are supplied in the row, not attested | Today one column holds one ref, so linking from a second machine **replaces** the first machine's ref. Proposed authenticated sources are separate; legacy refs do not create them |
| Build label | Server, proposed nullable `build_characters.link_id` | Owner explicitly attaches a label to a link | Owner's own statement | Never inferred from matching names. Deleting the label never unlinks; unlinking sets `link_id` to null and keeps the label, its builds and profile references |
| Local alt | Device only, optional `LocalAlt.linkId` | Owner confirms a suggested match | Owner's own statement | Never uploaded. A name/realm match is a suggestion, not an automatic join |
| Public sighting | Not stored as an alias | — | None | Shown only through the existing public policy. A link never adds data to a sighting page, and a sighting never adds data to a private dashboard |

The local name/key map (COL-C03) stays in the addon file and on the device. It never enters a public upload.

### 3. Collisions and lifecycle cases

| Case | Behavior (existing unless marked proposed) |
|---|---|
| Same account links the same character again | Same `link_key`: the row refreshes name, level, `completion_ref` (proposed: adds a source row instead of replacing) |
| Rename in game, same GUID | On the next relink with a new code, same `link_key` refreshes name/realm keys. No automatic rename discovery is promised |
| Realm transfer with a changed GUID and different realm | New link added; old link remains until explicitly unlinked. No automatic history merge |
| New GUID but the same normalized name and realm | `name_linked` refuses another link on that account until the old link is unlinked |
| Another account claims the same GUID or name/realm | Both frozen; both owners see "frozen"; nobody sees the other account. Operator decides |
| Reinstall (new install id, same GUID) | New completion key and new `completion_ref`. Relinking with a new code attaches the new source; the old source remains listed until removed |
| Second machine, same account | Two install sources on one link. Owner progress is the union of sources the account owns (section 4) |
| Copied Everloot.lua (same install id on two accounts) | Both accounts present the same install id as a source. Proposed: the source is marked `contested` and excluded from private reads for both accounts until resolved; neither link is frozen by this alone |
| Several game accounts, one Everloot account | Separate characters, separate links; each game account's addon file has its own install id, so each is its own source. Totals remain a union of linked characters; this is not a native account-wide or Warband total |
| Same person, two Everloot accounts | Second claim freezes both links. The person unlinks one; the operator can then restore the other |

### 4. Source ownership and private sync consent (COL-C00 contract)

Linking alone never uploads named progress. Desktop and CLI keep their current held-row defaults until this
contract is implemented and accepted.

Proposed model:

- **Source**: one install id bound to one account for private sync, recorded as an HMAC (same secret family,
  separate prefix, e.g. `source:`) with `user_id`, `first_seen`, `last_seen`, `key_version`, `status`
  (`active`, `contested`, `revoked`). A source is created only by an authenticated sender, never by anonymous intake.
- **Consent**: per link, the categories the owner chose to sync privately (first slice: completion only), with
  `granted_at` and `revoked_at`. Consent is separate from `character_visibility` and from publication grants.
- **Consent authority**: granting/revoking consent, removing a source and resolving contested sources require
  a signed-in session and this site's Origin. A `sync:own` key sends facts only for already consented links;
  it cannot grant consent, create publication grants, change visibility or list sources.
- **Credential**: a new API-key scope, proposed `sync:own`, separate from `link:own` and `read:own`. A key with
  only `link:own` may send link rows and nothing else.
- **Private read rule**: the owner sees a fact only when the link is `linked` (not frozen), the link has consent
  for that category, the fact came from a source the same account owns with status `active`, and the fact's
  completion key maps to that link's `completion_ref` for that source. The fact itself must have arrived through
  authenticated `sync:own` private sync with provenance recorded per fact. Anonymous intake and the public
  completion rollup never satisfy this rule, even when their install id/key hash matches a link's ref.
- Publication grants (`kb/src/publication.ts`) stay the only path to public display of owned progress. A private
  consent never creates or implies a publication grant, and a publication grant never authorizes a private read
  for an account.

### 5. Owner read and authorization contracts

All responses are `Cache-Control: private, no-store` and must never be served from a shared cache (SEC-01).
Session writes require this site's Origin; API keys are checked by scope through the existing
`link_account_for_key` pattern.

| Endpoint | Auth | Returns / does |
|---|---|---|
| `POST /api/me/characters/link-codes` (exists) | Session only | New code, shown once |
| `POST /api/me/characters/links` (exists) | Session or `link:own` key | Per-row linked/frozen/refused/retry |
| `GET /api/me/characters/links` (new) | Session only by default; a dedicated session resolver, not `linkAccount(req, true)` | The account's own links: id, name, realm, class, race, faction, level, status, linked_at, last_upload_at. Never `link_key`, `completion_ref`, other accounts or a reason for a freeze beyond "another account also linked it" |
| `DELETE /api/me/characters/links/<id>` (new) | Session only, Origin checked | Calls `unlink_character`; 404 for another account's id (no existence leak) |
| Visibility change | Not exposed in the first slice | `set_visibility` stays unused until a public profile contract exists |
| Owner completion read (COL-C01) | Session | Section 4 read rule; frozen, contested, revoked and other-account data excluded; unknown is shown as unknown, never zero |

`character_visibility`: `page_public`, `show_*`, `ranked_*` and `indexable` remain false and unwired. Each needs
its own accepted contract (public profile, rankings, search indexing) before any route sets or reads it. When
public display is designed, it reuses `set_visibility` and `public_character`, and frozen links stay private.
This explicitly narrows HUB-P03 in the master register: owner list/unlink is Step 1; a visibility endpoint
is deferred until its separate public-profile contract. `public_character` reads links, not sightings.

### 6. Unlink, revocation, deletion and history

| Event | Effect |
|---|---|
| Unlink (`unlink_character`) | Link, visibility, source mapping for that link and consent are deleted (cascade). Private derived history keyed by `link_id` is deleted. Build labels keep their builds; `link_id` becomes null. Private caches and any future public page/search entries are purged. Public sightings are unaffected; those follow the suppression policy |
| Relink after unlink | New `link_id`, empty history. Re-deriving history from retained raw source data is decision D3 |
| Consent revoked for a category | Stop accepting that category for the link; derived private data for that category is deleted; raw source rows follow D3 |
| Sync API key revoked | Stop future sync through that credential immediately. Other valid credentials and source consent are not implicitly revoked; explicit source removal is separate |
| Source revoked (owner removes a machine) | Facts from that source drop out of reads at once; deletion of its raw rows follows D3 |
| Account deletion | Existing `on delete cascade` removes links, visibility, codes and (proposed) sources and consent |
| Hide request (suppression) | Existing behavior: cannot link or show. Proposed: an existing link to a newly suppressed character becomes private-only and is excluded from any public surface |
| Frozen | Owner list shows the frozen state; linked dashboards and private reads excluded under accepted D2 until support resolves the dispute; operator resolution must use `unlink_character` or a reviewed operation with the same deletion/purge effects, not a raw DELETE |

Append-only ingestion is not irrevocable storage. Any history store (HIST-03) must support these deletions and
replay without leaving revoked events behind.

### 7. Secret domain, versioning and rotation

`EVERLOOT_CHARACTER_KEY` is used for census character keys (no prefix), link keys (`link:`), and completion
refs (`completion:`). It also backs public install pseudonyms (`public-install:`) when a separate
`EVERLOOT_PUBLIC_INSTALL_KEY` is absent. Rotating it today would:

- Make every stored `link_key` unmatched. A same-account relink would hit `name_linked` (the old row still holds
  the name), so the owner would be forced to unlink first. Cross-account freezes by game id would stop matching;
  freezes by name/realm would still work.
- Make every stored `completion_ref` unmatched, so private joins break silently.
- Break census agreement for existing census rows.
- Change published install pseudonyms when the public-install key falls back to this secret.

Proposed:

- Add `key_version` to each stored keyed value (links, sources). Keep a server-side map of version to secret;
  the oldest version needed stays available until migration is complete.
- On redeem, the GUID is in transit, so compute the key under the current and previous versions, match the row by
  either, and rewrite it to the current version. Freeze checks compare against both.
- Rows never refreshed stay on the old version. The GUID is not stored, so offline migration is impossible by
  design. The operator decides when the old version may be dropped (D5).
- Separate secrets per domain (census, link, completion/source) are recommended for new values so one rotation
  does not force the others.

No signature, attestation or client-held secret is proposed. The addon cannot keep a secret from the player.

## Compatibility migration for build labels and profiles

1. Add nullable `build_characters.link_id` referencing `character_links(id) on delete set null`, written only by a
   new owner-checked function that requires the label and link to belong to the same user and the link to be
   `linked`. Existing labels stay as they are.
2. Main/active character keep pointing at `build_characters`. HUB-P04 may later add link-based main/active; until
   then a label attached to a link is the bridge.
3. No automatic attachment, even when names match. The account UI may suggest a match; the owner confirms.
4. Keep `completion_ref` for compatibility. Do not backfill active sources, source ownership or consent from
   old refs: they cannot reveal the install id and do not prove authenticated provenance. A source becomes active
   only after a `sync:own` sender presents the install id, the server recomputes a matching ref for that link,
   and the link has session-granted consent. Old anonymous facts remain outside owner-private views.

All schema changes are proposals. Each needs its own reviewed migration, applied by the database owner, with a
written rollback, before its flag is enabled.

## Minimal private vertical slice

Step 1 (HUB-P02, HUB-P03, no schema change):

1. The site makes a code (exists).
2. New addon command `/everloot link <code>` writes one `character_link` row in the addon file.
3. Desktop/CLI send link rows only to `POST /api/me/characters/links` with a `link:own` key; never to intake.
4. Account page lists the account's links with status and an unlink action.
5. Nothing else is uploaded; no visibility flags; no dashboard.

Step 2 (COL-C00, COL-C01, needs accepted schema for sources/consent and `sync:own`):

1. Owner turns on private completion sync for one link.
2. Desktop sends that character's completion rows to an authenticated private endpoint with `sync:own`.
3. Owner sees that one character's completion privately, with freshness and unknown states.

## First implementation task (Step 1)

File boundaries:

- New: `addon/modules/link.lua`; listed in `addon/Everloot.toc` only. Answers/Prices/Builds slot TOCs do not load collector modules.
- Addon tests for the link command and row shape.
- Companion: dedicated link sender module and its tests; uploader keeps excluding `character_link` from intake.
- Desktop: wiring the sender into the existing job with a `link:own` key; renderer status text.
- Web: `GET` on `web/src/app/api/me/characters/links/route.ts`; new `links/[id]/route.ts` for `DELETE`;
  owner list/unlink helpers in `web/src/lib/character-links-store.ts`; account UI component and tests.
- Not touched: `supabase/migrations/*`, intake routes, public player pages, `character_visibility` writers,
  saved-build label routes.

Acceptance tests (each must fail before the change where the path is new):

- Forged claim: a hand-written row with another character's GUID and census-matching race/class/faction links
  privately and returns no private data in later reads; a second legitimate claim freezes both.
- Dispute: owner list shows `frozen` for both accounts and discloses no other account detail; unlinking one does
  not unfreeze the other.
- Copied install id: different characters on two accounts may have separate links but share no private data;
  a claim to the same character GUID freezes both (Step 2 adds the `contested` source test).
- Two accounts, one character name: second account freezes both; `public_character` returns nothing.
- Reinstall: new install id, same GUID, same account refreshes the same link id and keeps one link.
- Second machine: link from install B on the same account keeps the same link id (Step 2: two sources).
- Missing catalog: a linked character without completion or catalog data lists normally and shows no zero totals.
- Expired, reused, foreign and unknown codes; `census_mismatch` spends the code.
- Wrong scope: a key without `link:own` gets 403; a revoked key 401; session `POST`/`DELETE` without Origin 403.
- Cross-account `DELETE` and `GET` return 404/empty; responses are `private, no-store`.
- Unlink keeps build labels and their builds; deleting a build label leaves the link intact.
- Link rows never appear in any intake payload; held named rows remain held after linking.
- Flag off: every new route answers 404.

## Remaining decisions (for the owner, not blocking Step 1 unless noted)

- **D0 (freeze policy accepted 2026-10-28; activation details outstanding):** freeze both links and linked
  dashboards pending support review. Review account-link-existence disclosure wording and establish the
  minimum D8 support policy before enabling Step 1. Code can be prepared behind its flag.
- **D1 (blocks Step 2):** accept the proposed source/consent tables and separate `sync:own` write scope.
  Do not repurpose the existing `read:own` scope for writes.
- **D2 (accepted 2026-10-28):** a frozen link's owner cannot view its linked dashboard or private progress,
  even from their own authenticated active sources, until support resolves the dispute. The freeze never
  grants either account access to the other's data. D1 and D9 still gate Step 2.
- **D3 (blocks HIST-01):** retention of raw source rows after unlink/consent/source revocation: delete at once,
  or a fixed grace period for relinking. Until a different policy is accepted, Step 2 deletes its new private
  raw and derived rows immediately on those revocations; retained anonymous/publication data follows its existing policy.
- **D4:** ruleset source of truth before a second ruleset is enabled.
- **D5:** secret rotation runbook: domain split now or at first rotation; how long old versions are kept.
- **D6:** no public ownership badge. Any future public label must say "linked from addon file" and needs its own
  contract.
- **D7:** session-only link listing is the technical default. API-key listing needs a separately accepted read contract.
- **D8 (minimum blocks enabling Step 1):** operator dispute contact and response wording must exist before a route
  promises review. Accepted evidence and response-time targets remain part of that activation checklist.
- **D9 (blocks Step 2):** contested install-id source policy and how an owner clears it. A copied file can make a
  legitimate source contested, another denial-of-display tradeoff that needs an explicit product decision.

## Out of scope

Public profiles, rankings, indexing, combat logs, PvP, economy, inventory and history storage. Native account-wide
or Warband rules are not modeled; cross-character totals are a union of linked characters.
