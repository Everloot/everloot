# Maintainer access and support cases (OPS-01, OPS-02)

Date: 2026-10-28. Status: **proposed**. Read-only audit plus a proposed role/action matrix and support/dispute
case lifecycle. It changes no code, SQL, configuration, flags or access. Nobody is granted a role by this document;
prospective collaborators and their assignments stay in the owner's private project control.

Parent documents: [unified player platform](2026-10-28-unified-player-platform.md) (team operations section),
[owned-character identity ADR](2026-10-28-owned-character-identity.md) (D0, D2, D8),
[gap register](../../2026-10-28-platform-gap-register.md) (OPS-01..04) and
[readiness plan](../../superpowers/plans/2026-10-28-platform-readiness.md) (team operations work package).

Accepted inputs this document honors, not re-decides:

- Owner decision 2026-10-28 (identity ADR D0/D2): competing claims freeze both character links **and** their
  linked dashboards, including each account's own authenticated private progress, until support resolves the
  dispute. No data is ever shared between accounts.
- Team direction (platform spec): individual accounts, scoped roles, no shared credentials, attributable sensitive
  actions, no blanket impersonation, no billing, tenancy or subscription model implied.

## 1. Audit: what exists today

Code baseline: `5e5fd33d`, with web and database sources inherited from `7ae6c787`. Evidence is code and documentation, not a read-back of production
flags, grants or data.

### Authentication and authorization

| Area | Exists | Evidence | Gap for OPS |
|---|---|---|---|
| Player sessions | Opaque cookie, SHA-256 hash in private `sessions`; or better-auth when auth v2 is on | `web/src/lib/supabase/server.ts` (`getUser`, `requireAuth`), `web/src/lib/auth/auth.ts` (plugins `genericOAuth`, `multiSession` only) | No role, staff flag or admin plugin. `AccountUser` is `{ id, name }` only |
| Server data access | Relevant link/player/guild routes use service-role PostgREST; their browser roles have no table or function grants | `authQuery` in `web/src/lib/supabase/server.ts`; `supabase/tests/character_links.sql`, `players.sql`, `guilds.sql` assert `anon`/`authenticated` denial | Good base: staff checks belong in server code and security-definer functions, not browser-role access |
| API keys | Per-account keys with scopes `read:public`, `read:own`, `link:own`; expiry, revoke, roll, delete | `web/src/lib/api-keys.ts`, `web/src/lib/api-key-policy.ts`, `supabase/migrations/20261019120000_data_guard.sql` | Player scopes only. No staff scope, and none should be added (staff actions are session-only, section 3) |
| Route guard pattern | Flag off → 404; session write needs this site's Origin (missing Origin → 403); signed out → 401; wrong key scope → 403; `private, no-store` | `linkAccount` in `web/src/lib/character-links-store.ts` | Reusable shape for an `opsAccount(req, permission)` guard |
| Moderator precedent | `guide_moderators`: one-row table written only by the database operator by hand; service role may only select; nothing in a request names a reviewer | `supabase/migrations/20261027140000_guide_submissions.sql` (lines 82–93), `web/src/lib/guide-submissions.ts` header | Single-purpose, single-person, no grant history, no revocation record, no audit. Review flow itself not built |

### Operator actions that exist, and how they are performed

| Action | How today | Evidence | Attributable record? |
|---|---|---|---|
| Settle a frozen character link | Hand-written SQL: delete losing links, `update ... set status = 'linked'` | Comments at end of `supabase/migrations/20261021190000_character_links.sql` | No. Visibility already cascades on link deletion; raw SQL still lacks the proposed atomic audit and future private-source purge contract. The identity ADR requires a reviewed resolution operation |
| List frozen links | Hand-written SQL | Same file | No |
| Issue/revoke a publication grant | Private CLI; evidence verified out of band; grant row stores `verifiedBy` and `evidence` | `scripts/issue-publication-grant.ts`, `web/src/lib/sharing-store.ts` | Partial: `verifiedBy` is free text, not an account id; no reason/outcome log |
| Undo a character or guild hide | "The owner's tool": by hand, after an email | `supabase/migrations/20261022160000_players_realm_key.sql` (section 4), `20261025120000_guilds.sql` (section 3); `web/src/app/players/opt-out/page.tsx`, `web/src/app/guilds/hide/page.tsx` | No |
| Account deletion | Email request, performed by hand; schema cascades | `web/src/app/account/page.tsx` (Data and privacy section) | No |
| Privacy requests (access, correction, deletion) | Email | `web/src/app/privacy/page.tsx` (`#rights`) | No |
| Guide review | Not built; statuses beyond `submitted`/`withdrawn` reserved | `web/src/lib/guide-submissions.ts` (`GUIDE_STATUSES`) | No |

There is no audit table. A repository search for `audit` in `supabase/` and `web/src/lib` finds only test strings.

### Support channels and project tracking

| Channel | What it says | Evidence | Fit for private cases |
|---|---|---|---|
| `/contact` | Email `hello@everloot.app` for corrections, privacy, takedown, bugs, partnerships; Blizzard Support for game accounts | `web/src/app/contact/page.tsx` | Real route. Does not mention character links or disputes |
| Privacy rights | Same address; may ask the requester to prove the address, grant or install id; "We answer within a month" | `web/src/app/privacy/page.tsx` | Existing published wording for **privacy requests** only. Not accepted for disputes (D8) |
| Account deletion | Same address; "We answer within a month" | `web/src/app/account/page.tsx` | Same caveat |
| Security | GitHub private advisory or the same address, "Security" subject | `SECURITY.md` | Separate path; keep separate |
| GitHub issues | Public bug, wrong-data, feature, ecosystem forms; blank issues off; contact links | `.github/ISSUE_TEMPLATE/*.yml`, `config.yml` | **Public. Never for disputes or account data** |
| Discord | `#bug-reports` posts sync both ways with GitHub issues | `.github/workflows/discord-bridge.yml` | **Public mirror. Never for disputes or account data** |
| Implementation tracker | Generated from `kb/src/bridge-plan.ts`; MCP `everloot_plan` returns it | `docs/TRACKER.md` | Public engineering status; no people, no cases |
| Code ownership | Single code owner | `.github/CODEOWNERS` | Repository review only |

Battle.net accounts store no email (`users` holds `bnet_id`, `battletag`), so an email cannot prove which
Everloot account sent it. Email-sign-in accounts do store an address.

### Character-link state relevant to disputes

Per the identity ADR and `web/src/lib/character-links-store.ts`: freezes happen automatically in `redeem_link`;
`public_character` hides frozen links; no player-facing list of links exists yet (`GET /api/me/characters/links`
is Step 1, not built), so a frozen player currently has nowhere to see the state or a contact route.
`/api/me/characters/[id]` DELETE removes a build label, not a link.

## 2. Principles and safe technical defaults

These are defaults an implementer can apply without further owner input. Section 7 lists what still needs the owner.

1. **Staff is a grant on a normal account.** One individual Everloot account per person. No shared login,
   no shared API key, no service-role key on a maintainer's machine for routine support.
2. **Session only.** Staff actions require a signed-in session; writes also require this site's Origin. No API-key scope can
   perform or read staff actions.
3. **Permissions, not a single admin bit.** Each action checks one named permission, re-read from the database
   on every request (no role cached in the session or cookie), so revocation applies on the next request.
4. **Invisible to non-staff.** Ops routes answer 404 to signed-out and non-staff accounts (as flag-off routes do);
   staff without the specific permission get 403.
5. **No impersonation.** No "view as player", no session minting, no reading another account's private dashboard.
   Support sees case metadata and the minimal link state needed to decide, never private progress.
6. **No secrets in records.** Never store or show `link_key`, `completion_ref`, GUIDs, install ids, link codes,
   API keys, session tokens or uploaded files in cases, timelines or audit rows.
7. **Writes through reviewed functions.** Resolution uses security-definer functions that perform the change
   and write the audit row in one transaction (existing pattern). No raw table edits from routes.
8. **Responses** are `Cache-Control: private, no-store` (SEC-01), as `NO_STORE` in `character-links-store.ts`.
9. **Private cases never go to GitHub or Discord.** Engineering follow-ups get a public issue with no account,
   character or evidence detail, linked from the private case.
10. **No response-time promise** in product copy until the owner accepts one (D8).

## 3. Proposed permissions and role bundles

Permissions are the unit of authorization. Roles are named bundles for convenience; a grant may also be a single
permission. All rows below are **proposed**.

| Permission | Allows | Never allows |
|---|---|---|
| `case.view` | Case list/detail: id, category, state, assignee, timestamps, next action, timeline notes, requester account id and the link ids named on the case with their status, name, realm and linked_at | Private progress, dashboards, other links of the account, keyed values, other accounts' identity beyond "another account holds a frozen link" |
| `case.work` | Create a case, assign (self or others), add notes, set next action, move between non-terminal states | Resolve a dispute, export, private data |
| `case.close` | Close non-dispute cases with a resolution (answered, duplicate, withdrawn, no action) | Any data change |
| `dispute.resolve` | Run the reviewed dispute function: keep one link, unlink others, or unlink all; close the case | Choose an outcome without a recorded reason; read private progress |
| `case.export` | Export one case's metadata and timeline for a legal/privacy obligation | Bulk export; private player data |
| `private.read` | **Not granted by any role.** Reserved name; any private-data access needs a separate owner-approved contract with per-access reason and audit | — |
| `request.fulfil` | Mark an account-deletion or hide-undo request fulfilled after running the existing reviewed path | Delete without a case |
| `staff.manage` | Grant or revoke staff permissions to other accounts | Grant to itself; grant `private.read` |
| `ops.metadata` | Service health, sync failure counts, release versions (OPS-04) | Player identity, cases |

| Action | Support | Dispute reviewer | Maintainer (engineering) | Staff admin |
|---|---|---|---|---|
| See case list/detail | yes (`case.view`) | yes | no | no, unless also support |
| Assign, note, next action | yes (`case.work`) | yes | no | no |
| Close non-dispute case | yes (`case.close`) | yes | no | no |
| Resolve character dispute | **no** | yes (`dispute.resolve`) | no | no |
| Export a case | no | no | no | only with explicit `case.export` grant |
| Read private progress or dashboards | no | no | no | no |
| Act as / sign in as a player | no | no | no | no |
| Grant or revoke staff permissions | no | no | no | yes (`staff.manage`), never self |
| Service metadata view | no | no | yes (`ops.metadata`) | no |
| Release, deploy, database migration | outside the app: GitHub/Vercel/Supabase access, per OPS-04 runbooks | | | |

The first `staff.manage` holder is written by the database owner by hand, as `guide_moderators` is today.
`guide_moderators` stays as it is; folding it into staff grants is a later, separate change.

## 4. Case model and lifecycle (OPS-02)

### Fields (proposed)

| Field | Notes |
|---|---|
| `id` | UUID, internal |
| `ref` | Short random reference shown to the requester (e.g. 8 characters, unambiguous alphabet); not sequential, carries no account or character data |
| `category` | `character_dispute`, `account_deletion`, `privacy_request`, `hide_undo`, `data_correction`, `other` |
| `state` | See below |
| `requester_user_id` | Set when the case is opened from a signed-in session; null for email-only cases |
| `contact_note` | How to reach the requester (e.g. "replied by email"); no copied message bodies by default |
| `subject_link_ids` | Character links named on the case (dispute cases), each owned by a party to the case |
| `assignee_user_id` | Staff account, nullable; must hold `case.work` at assignment time |
| `next_action`, `next_action_due` | Free text and optional internal date; never shown to the requester as a promise |
| `resolution_code`, `resolution_summary` | Set on close; summary is internal |
| `created_at`, `updated_at`, `closed_at` | |

A dispute involves two or more accounts. Proposed: **one case per account**, each linked internally to a shared
`dispute_group` id. A requester's `subject_link_ids` contains only their own links; group membership never
adds another account's link to a requester response. Each requester only ever sees their own case; authorized
staff see the group. This keeps "never share
between accounts" structural rather than a display rule.

### States

```
new → triage → in_review ⇄ waiting_on_requester
                    ↓
        resolved | closed_no_action | withdrawn
(any closed state) → reopened → triage
```

- `new`: created; no assignee needed.
- `triage`: assignee set, category confirmed.
- `waiting_on_requester`: next action belongs to the requester.
- `resolved` / `closed_no_action` / `withdrawn`: terminal; require `resolution_code`.
- Dispute cases in a group close together through the dispute function.

### Private timeline and audit

Timeline events are append-only rows: `case_id`, `at`, `actor_user_id` (the authenticated requester or staff id;
null only for a system or unauthenticated external action, with explicit actor kind),
`kind` (`created`, `assigned`, `state_changed`, `note`, `next_action`, `resolution`, `export`), `reason`, `outcome`.
Notes are minimal: what was checked and decided, not pasted files or chat logs.

Sensitive actions also write an `ops_audit` row, independent of cases so that permission changes are covered:
`actor_user_id`, `at`, `action` (`staff.grant`, `staff.revoke`, `dispute.resolve`, `case.export`,
`request.fulfil`, later `link.freeze`/`unfreeze` if added), `target_kind`, `target_id`, `case_id`, `reason`
(required), `outcome` (`ok` or refusal code). Never keyed values, tokens, file contents or emails. Rows are not
editable by the service role; deletion follows account-deletion and retention decisions (D-OPS-5).

### Character-dispute flow

1. Freeze is automatic (existing `redeem_link`). Each owner list (Step 1) shows the frozen link and text that
   another account also linked it, with the contact route (section 5). Their linked dashboard and private
   progress are hidden for both accounts (accepted D2).
2. The signed-in owner asks for review from the frozen link (proposed `POST /api/me/characters/links/<id>/review`,
   session and Origin only). This creates or returns that account's case and its `ref`; it proves which account
   asked without collecting an email. Email remains the follow-up channel.
3. A support member triages: confirms the group, sets next action. They see each case's link status, name,
   realm, linked_at and requester account id. They do not see either account's private data.
4. A dispute reviewer decides with the accepted evidence policy (D-OPS-2) and runs the dispute function with
   a reason. Outcomes: keep one link (others removed via `unlink_character` semantics, kept link set `linked`),
   remove all links, or keep frozen and wait.
5. Each requester gets a response about **their own** link only. No message names, confirms or describes the
   other account.
6. Unlinking a link on the losing side removes its visibility row and private data per the ADR's section 6.

Race, class, faction, level, realm, name and GUID are never proof on their own (identity ADR, Assurance 3).

## 5. D8: contact route and response wording (draft for owner review)

**Contact route (existing, real):** `hello@everloot.app`, already published on `/contact`, `/privacy` and
`/account`. Proposed addition: the authenticated "Ask for a review" action in step 2 above, so the case is tied
to an account. No new mailbox, form vendor, Discord channel or phone line is proposed. Who reads the mailbox
and how often is an owner decision kept outside this repository.

**Draft wording — not accepted.** Each line is a proposal; none promises a time.

- Owner list, frozen link: "Another Everloot account also linked this character, so it is paused on both
  accounts. Its dashboard is hidden until we review it. We never show either account the other's data."
  Action: "Ask for a review". Secondary: "Questions: hello@everloot.app".
- After asking: "Review requested. Your reference is {ref}. Check this page for updates, or contact
  hello@everloot.app with your reference. Do not
  send your Everloot.lua file, link codes or API keys."
- Resolved, kept: "Review finished. This character is linked to your account again."
- Resolved, removed: "Review finished. This character is no longer linked to your account. Your saved builds
  and character labels are unchanged."
- Closed without change: "We could not settle this yet, so the character stays paused on every account."
- Response time: **omitted** until the owner accepts a commitment. The existing "We answer within a month"
  covers privacy and deletion requests only and must not be copied into dispute copy without acceptance.

## 6. Next code slice (proposed, after owner acceptance of sections 3–4)

Slice OPS-03a: permission check and denial tests, behind a flag, no UI and no player-visible change.

| File (new unless noted) | Owner lane | Content |
|---|---|---|
| `web/src/lib/ops/permissions.ts` | web | Permission names, role bundles, pure `can(grants, permission)`; `private.read` not in any bundle |
| `web/src/lib/ops/permissions.test.ts` | web | Matrix tests for every row in section 3 |
| `web/src/lib/ops/access.ts` | web | Dedicated session-only `opsAccount(req, permission)`: flag off 404, non-staff 404, writes with missing/foreign Origin 403, permission missing 403, key presented 403, `NO_STORE`; do not copy the existing write-only guard's Origin requirement onto page reads |
| `web/src/lib/ops/access.test.ts` | web | Denied-access and revocation tests below |
| `web/src/lib/ops/staff-store.ts` | web | Reads live grants through one security-definer RPC via `authQuery` |
| `supabase/migrations/<timestamp>_ops_staff.sql` | database owner | `staff_grants` (user, permission, granted_by, granted_at, revoked_at, reason), `ops_audit`, grant/revoke functions; RLS on, no `anon`/`authenticated` grants, service role execute only, written rollback |
| `supabase/tests/ops_staff.sql` | database owner | Privilege assertions in the style of `supabase/tests/character_links.sql` |

Slice OPS-03b (later): `support_cases`, case events, dispute function; routes `web/src/app/api/ops/cases/route.ts`,
`web/src/app/api/ops/cases/[id]/route.ts`; pages under `web/src/app/ops/`; the player review route under
`web/src/app/api/me/characters/links/`. It depends on identity Step 1's owner list. Not touched by either slice:
intake routes, public player pages, `character_visibility` writers, `guide_moderators`, auth providers.

Review the schema slice against the active Cloudflare lane before assigning (readiness plan).

### Denied-access and revocation tests (each must fail before the change)

- Signed-out and signed-in non-staff: every ops route 404, body reveals nothing.
- Staff with `case.view` only: case write, close, resolve and export answer 403 and write no audit row.
- Support without `dispute.resolve`: dispute function refuses even when called with a valid case.
- Any request carrying an API key (any scope) to an ops route: 403; no staff action is reachable by key.
- Session write without or with a foreign Origin: 403.
- Self-grant of any permission and any grant of `private.read`: refused and audited as refused.
- Revocation: a grant revoked between two requests in the same session is denied on the second request.
- Account deletion of a staff member removes their grants; their past audit rows keep `actor_user_id` per D-OPS-5.
- Case detail for a dispute never returns private progress, keyed values or the other party's account id to
  the requester route; the staff route returns only the fields in section 4.
- Dispute resolution goes through the function: links, visibility rows and audit row change together or not
  at all; a raw unlink path does not exist in route code.
- All ops responses carry `private, no-store`.

## 7. Decisions

### Owner decisions (unresolved)

- **D8 / D-OPS-1:** accept the contact route and the draft wording in section 5, and decide whether any
  response-time commitment is made for disputes. Who monitors `hello@everloot.app` stays private.
- **D-OPS-2:** what evidence a dispute reviewer may accept, given that the file bridge offers no trusted proof
  of game-character control. Until decided, the only safe outcomes are "stay frozen" or a voluntary unlink by
  one party.
- **D-OPS-3:** accept the permission list and role bundles in section 3, including that no role has
  `private.read` and that export is a separate grant.
- **D-OPS-4:** sign-in strength for staff accounts (for example a second factor) before any grant.
- **D-OPS-5:** retention of closed cases, timeline notes and audit rows, and what an account deletion does to
  cases that name it.
- **D-OPS-6:** whether the private case store is Supabase (proposed, existing pattern) or an existing private
  tracker; either way, not GitHub or Discord.
- People: who, if anyone, receives which grant. Recorded privately; not in this repository.

### Safe technical defaults (no further decision needed)

Section 2 in full, plus: one case per account in a dispute group; 404 for non-staff; per-request permission
read; append-only timeline and audit; no impersonation feature; no new vendor, paid service, tenancy or billing.

## Out of scope

Organization tenancy, billing, subscriptions, staff impersonation, public status pages, enabling any flag,
granting any access, and OPS-04 runbook content.
