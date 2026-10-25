# Private Chat workspace implementation plan

**Goal:** Deliver the approved private account projects, saved-content/chat library and reviewed dictation drafts.

**Architecture:** Extend the existing custom-session account backend with additive private tables and session-only routes. The Chat client switches explicitly between private account data and browser-local chat; provider keys remain per-tab. Existing public item/card routes hydrate page references without copying their facts into private APIs.

**Tech stack:** Existing Next15/React19/TypeScript, Supabase Postgres through existing server account helpers, Vitest and browser speech recognition. No new hosted service or runtime dependency.

**Specs:** `docs/superpowers/specs/2026-10-25-chat-projects-design.md`, `2026-10-25-chat-dictation-design.md` (both approved).

## Global constraints

Preserve custom session identity, all existing account/build/guild flags, page-only item policy, strict CSP, per-tab keys and static Chat shell. Gate workspace activation behind `EVERLOOT_CHAT_WORKSPACE=1` until migration and live ownership checks pass. No raw audio, unsent drafts, credentials or fetched game-file facts in account records, logs or telemetry. New account routes require ownership, no-store and same-origin mutation checks.

## Shared interfaces

Create `web/src/lib/chat/workspace-types.ts` with these client-safe exported types (all timestamps ISO strings):

- `WorkspaceProject`: `id, name, description: string|null, revision:number, updatedAt`.
- `WorkspaceConversation`: existing `Conversation` fields plus `projectId:string|null, pinned:boolean, revision:number`.
- `WorkspaceConversationSummary`: conversation without `messages`.
- `WorkspaceEntry`: `id, projectId:string|null, kind:'build'|'page'|'answer'|'note', title, buildId:string|null, href:string|null, text:string|null, sources:string[], revision:number, updatedAt`.

REST contract, all successful private responses include `accountId`:

- GET `/api/me/chat/projects` -> `{accountId,projects}`; POST `{expectedAccountId,expectedRevision,project:{id,name,description}}` -> `{accountId,project}`.
- GET `/api/me/chat/conversations?cursor=&query=&projectId=` -> `{accountId,conversations:WorkspaceConversationSummary[],nextCursor:string|null}`; GET `.../conversations/<id>` -> `{accountId,conversation}`; POST collection `{expectedAccountId,expectedRevision,conversation:{id,title,projectId,pinned,messages}}` -> `{accountId,conversation}`.
- GET `/api/me/chat/entries?projectId=&cursor=` -> `{accountId,entries,nextCursor}`; POST collection `{expectedAccountId,expectedRevision,entry:{id,projectId,kind,title,buildId,href,text,sources}}` -> `{accountId,entry}`.
- DELETE each `.../<id>` takes `{expectedAccountId,expectedRevision}` and returns `{accountId,ok:true}`. Removing a project moves its records to Unfiled, never deletes original builds.
- POST `/api/me/chat/import` takes one `{expectedAccountId,sourceId:UUID,legacyId:string,conversation:{title,messages}}` -> `{accountId,conversation,created:boolean}`. Stable import identity is per authenticated owner/source/legacy ID; repeated import is idempotent.
- GET `/api/me/chat/export` returns the owner's workspace JSON download. DELETE `/api/me/chat/workspace` explicitly clears only this workspace, not the login account/builds.
- Expected revision0 means create; updates/deletes require the last revision. Return409 `{error,code:'revision_conflict'}` on conflicts,404 for foreign/missing IDs,401 signedout,403 invalidorigin,413 oversize,503 unavailable. An account mismatch is rejected before any mutation. No bearer/MCP access.

Initial bounds: 100 projects,500 conversations,1000 entries and10MiB content per account; 200 messages/1MiB per conversation; message/note text20000chars, title100chars, projectdescription1000chars, URL2048chars, sources20 strings of512chars. List pages50. Mutations300/day/account. Enforce bounds on server and in storage transactions; reject excess visibly without pruning saved content.

Dictation interface: default export `DictationButton` from `components/chat/Dictation.tsx` accepts `{value:string,onChange:(value:string)=>void,disabled?:boolean,sessionKey:string}`. Disabled/changed sessionKey/unmount stops recognition. No Send callback or audio persistence.

## Review focus

- An account switch during a request must never display or save the departing account's content.
- Another device changing a chat must produce a recoverable conflict, not overwrite it.
- Partial import must preserve originals and retry without duplicate or cross-account claims.
- Storage/permission failures must never claim Saved or destroy editable text.
- Dictation must preserve typed edits and never duplicate final events or send automatically.

## Task 1: Private storage and routes

Owner: workspace types/validation/store, new `app/api/me/chat/**`, additive migration, backend tests and operational migration check. Do not edit existing Chat UI, next.config or unrelated auth/guild storage.

- [ ] Write failing validation/route tests for two-account CRUD, ownership of parent/build references, revisions, origin, pagination, quotas, bounded payloads, idempotent imports and export sanitation.
- [ ] Implement shared types and strict validators, authenticated routes and additive private storage. Use existing `getUser/authQuery` architecture; no Supabase Auth assumptions. Generate the migration via the official CLI workflow; keep all remote DB operations for reviewed root activation.
- [ ] Verify project unlink, owner account deletion cascade and workspace-only deletion; local SQL fixture tests where available. Run focused types/tests/lint and return changed files plus a concrete activation verification recipe.

## Task 2: Projects, library and sync UI

Owner: ChatClient/ConversationRail/Composer/Message/ItemResult integration, new client workspace modules/components/tests, `app/chat/page.tsx` flag wiring, privacy/docs updates specific to workspace. Reuse Task1 contract exactly; do not edit backend-owned types/routes/SQL or dictation implementation/config.

- [ ] Write failing tests for project CRUD, pinned/recent/search/filter, move/rename, all four saved entry kinds, live build reference, save-to-project from item/answer, account vs browser mode, legacy import, conflict/not-saved states and account-switch cleanup.
- [ ] Implement the approved UI using existing tokens; private APIs only while enabled/signedin, scoped local history for each account. Never persist fetched card facts. Attach selected note text only through an explicit visible context chip. Existing Chat is the flag-off fallback.
- [ ] Integrate `DictationButton` in Composer once its file exists, using the active conversation/project identity as sessionKey. Keep composer model choice discoverable without a key. No tools gain write access.
- [ ] Verify existing item cards, provider boundary, keyboard/phone drawer behavior and old local chats. Export/delete controls live inside the workspace; existing account deletion remains its email-based flow, with new rows cascading when that account is removed.

## Task 3: Dictation and scoped microphone policy

Owner: new Dictation.tsx and pure recognition helper/tests, next.config.js and next-config.test.ts only. Task2 owns Composer; provide the shared prop contract rather than editing it.

- [ ] Write failing tests for unsupported APIs, refusal/error, final-segment deduplication, typed edits, length bound, language, stop/unmount/session change/disabled, no auto-Send and scoped policy paths.
- [ ] Implement the click-initiated recognition adapter and accessible UI with a first-use speech-service disclosure, language control and Stop. Keep audio out of app storage/network code; unsupported browsers keep typing.
- [ ] Permit microphone self only on Chat paths and served-prefix counterparts; all other pages remain denied. Preserve all CSP headers. Run focused tests/types/lint; use simulated recognition only, never the real operator microphone.

## Task 4: Integration, review and release

Root owns conflict integration, actual local Postgres tests, independent whole-feature review, full checks/build/browser verification, migration application, activation and release serialization. Existing database is already provisioned; reuse it. No new service or credential scope is needed by design.

- [ ] Verify real SQL isolation/quotas/concurrency and account cleanup with disposable local fixtures, then independently review schema/server/client/dictation as a whole and fix substantive findings.
- [ ] Verify local desktop/mobile flows, provider/item boundaries, browser permission failures with simulated recognition, two isolated account sessions, import retry/conflict and accurate saved state.
- [ ] Coordinate migration with the existing owner, apply only the reviewed additive migration, verify it against the intended project and enable only after private CRUD/isolation checks pass. If access is genuinely missing, complete all reviewable code/checks before requesting the exact missing access.
- [ ] Open/link PRs, complete required CI, serialize production release, verify genuine account sync and private row cleanup, then update shared status and stop watchers.

Execution: Carlos explicitly approved implementation; proceed without another plan-approval round. Independent modules may be built in parallel against the fixed interfaces above. Exact internal helpers are each owner's decision. Decisions and evidence must remain in this plan/shared handoff across turns.

## Integration ruling: private build saves

Production has no saved-build tables. Enabling the old global saved-build switch also enables optional read:own/MCP and public-default calculator saves. Keep that switch unchanged for this private-workspace release. Apply its reviewed storage migration only after prerequisite checks/local tests; reuse the existing build functions through session-only `/api/me/chat/builds` routes gated by the workspace switch. New workspace-created builds explicitly set shared=false and showName=false; existing referenced builds keep their current sharing choice. The routes never accept a share request or expose builds through bearer keys/MCP.

Add a small private build form and live picker inside ProjectView. GET returns the owner's existing AccountBuilds plus accountId; POST takes expectedAccountId and validated existing build-input fields, creates private by default and preserves sharing on owned updates. Responses carry accountId and build. Open the saved code in the existing calculator using editPath; when global saved builds are off, edits can be saved through the workspace form. This reuses original build IDs rather than a parallel store. Backend/route and form have a separate scoped owner; root wires it into ProjectView after the UI task is complete. Workspace export includes owned referenced build codes as user-created data where available; it still excludes keys and fetched card facts.
