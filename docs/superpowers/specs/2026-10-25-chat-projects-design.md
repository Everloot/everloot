# Private projects and the Chat library

Status: approved by Carlos for implementation, 2026-10-25.

## Decisions Carlos made

- Expand Chat with Projects/folders, pinned and recent conversations, a complete chat view, and clear model selection.
- A project collects useful WoW content: builds, saved items/pages, chats, pinned answers and personal notes.
- Projects and their contents are private to the player's account and available across devices.
- Speech-to-text produces an editable draft; sending remains an explicit action. The companion design is `2026-10-25-chat-dictation-design.md`.

## Intent and approaches

Give players a place to return to a goal such as Warrior leveling, raid preparation or gold farming with the relevant material together.

Chosen approach: private account projects integrated into Chat. Existing account sessions and storage are reused. References point to existing builds and database entries; they do not create a second build or copy game-file facts.

Considered alternatives: browser-only folders would preserve today's simpler storage but fail the selected cross-device requirement. A file-upload knowledge workspace would add ingestion and retrieval work that Carlos did not request; it is excluded from this version.

## Proposed experience

### Sidebar and library

- New chat, Projects, Pinned, Recent and View all. The full view supports title search and project filtering; renaming, pinning and moving chats are explicit controls.
- Projects have a name and optional description/character label. A project opens an overview with Saved, Chats and Notes sections and a New chat action scoped to that project.
- One conversation belongs to at most one project, or Unfiled. Pinned conversations remain visible without appearing twice in the Recent subset.
- Mobile uses a dismissible drawer, closes after a selection and returns focus to its trigger. Desktop keeps the sidebar available and collapsible.
- Existing model selection stays in the composer and becomes discoverable without a key through an Everloot search choice and a provider setup link. Only configured providers can generate model answers; selecting a model never adds a provider or silently switches billing destinations.
- Tool lookups remain automatic and read-only, with plain progress text. Save, rename, move and delete controls are ordinary player actions; the model receives no new write tools.

### Saving content

- Save to project opens an existing-project picker with a create-project option. Support the item result card, an answer, an existing saved build and an Everloot page link. A project can also receive a manually written note.
- Existing builds are linked by stable owned build ID. Their updates remain visible; a project does not change a build's sharing setting. Private project membership does not make an already shared source private.
- Items/pages are stored as validated same-site references, IDs and optional player-written labels. The existing page routes hydrate display names/icons/tooltips. No game-file names or tooltip facts are copied into account JSON or a public export.
- A saved answer keeps the player-selected text and its existing citations; a note is escaped plain text. No arbitrary HTML, embedded websites or file uploads.
- Removing a project moves its chats and saved entries to Unfiled; it never deletes the original builds or referenced pages. Chats, notes and saved entries can be deleted individually with clear scope.
- Project notes and saved answers are not automatically sent to a model. A player can explicitly attach selected text as context, with a visible removable chip. No entire-library retrieval is introduced.

## Account sync and migration

- Proposed default: new signed-in chats use private account storage, with an Account / This browser choice visible before the first message. A project chat always uses Account; a local chat can be moved into a project only through an explicit upload/save action. Signed-out players keep local chat and are asked to sign in to create projects. No account content is downloaded into persistent local caches.
- Existing browser conversations are never uploaded automatically. Offer Import browser chats with a preview/count and the target account shown, then an explicit confirmation. A completed import binds the old local IDs to that account on this browser. Repeating the import for that account is idempotent; a different account cannot silently claim or display those bound copies. Never infer that old, unowned browser chats belong to the currently signed-in person.
- Keep the original local copies as an account-bound backup after import and offer Remove local copies separately. Legacy chats that have not been imported remain in a clearly labelled This browser section. Recent/View all distinguish Account and This browser records; signing out or switching accounts hides the departing account's server content and bound local backups. Local mode for new signed-in chats is namespaced to that account on this browser.
- Do not sync provider keys, session tokens, raw audio, unsent drafts or fetched card facts. Existing per-tab key behavior is unchanged.
- The card-fact restriction concerns facts automatically read from the page-only game-file layer. User-written item names and the existing public-tool-derived message text, citations, page links and tool-query metadata can remain in private transcripts unchanged. Never scrub or rewrite a player's ordinary question merely because it names an item.
- Each record has an owner, stable ID and revision. Paginate library reads; save completed turns and explicit edits rather than each streamed token. Show Saving, Saved and Not saved states accurately.
- Failed writes keep the unsaved content recoverable. Conflicting edits on another device return a conflict instead of silently overwriting newer data; offer refresh or save a separate copy. Message IDs make retrying completed turns idempotent.
- Clear private in-memory state on sign-out/account change and cancel pending work. Private responses are no-store and never enter shared page caches, analytics, the public corpus, MCP, sitemaps or search indexes.
- Enforce reviewed account and per-record quotas on the server and in the UI. Reject excess saves visibly; never silently prune pinned chats or project content to make space. Exact limits are an implementation decision to document before release.

## Storage and security constraints

- Reuse Everloot's existing server session identity. It uses custom sessions/Better Auth rather than Supabase Auth JWTs; do not assume `auth.uid()` identifies the player.
- Use additive private storage with RLS enabled and no direct anon/authenticated table access, matching the existing account architecture. Server-side reads and writes must enforce ownership for both records and referenced builds/projects; service-role bypass is not an ownership check.
- Mutation routes validate the authenticated session, origin/CSRF expectations, payload bounds and revision. An account cannot infer another account's project or content by guessing IDs. No new bearer-key/MCP access to private projects in this version.
- Keep every project/library page beneath `/chat` so the existing strict CSP and third-party-script exclusion apply. Keep `/chat` static with client-side private fetches where practical; no site-wide nonce policy or public-page rendering migration.
- Update privacy/data-policy copy for account-stored conversations and notes. Include account-data export and deletion, and verify account deletion removes project content. Keys and game-file facts are excluded from exports.

## Delivery order and release prerequisites

1. Private storage/API, ownership tests, account import/export/delete and conflict behavior.
2. Sidebar/library/project screens, save actions, build references and model-picker presentation.
3. Dictation in its own small change after the core workspace is verified.

Use the existing database and deployment lane. Review and test the additive migration before activation; do not enable a half-working workspace when storage is unavailable. Coordinate with the separate guild migration and ongoing header/assets work. No new paid service is part of this design.

## Verification and non-goals

Verify two-account isolation for every CRUD operation and referenced build, sign-out/account-change cleanup, explicit idempotent browser import, two-device save/conflict handling, retries/offline errors, export/deletion, old local conversations, keyboard/mobile use and existing item-card/provider boundaries. A production enablement check must use actual private test records and verify their cleanup.

Excluded: public/shared projects, collaboration, external connectors, uploads, automatic browsing/execution, automatic library-to-model context, model-based titles, subscription login adapters, provider-key sync, full voice conversation and desktop/addon sync. Those require separate decisions.

Builder choices: choose the smallest modules and additive schema fitting the existing account architecture. Document quota values and migration activation checks. Do not invent a second auth system, a new hosted service or a generalized knowledge-ingestion framework.

## Design-check decisions

The independent builder check identified microphone headers, local-import ownership, default chat storage and transcript-vs-card facts as ambiguities. These are resolved above and in the dictation design as proposed defaults for Carlos to approve. Account sync does not silently migrate existing conversations or provider credentials.
