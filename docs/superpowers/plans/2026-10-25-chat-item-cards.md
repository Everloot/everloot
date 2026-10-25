# Chat item cards implementation plan

**Goal:** Resolve item questions to the correct database item and display its live card and published drop evidence inside Chat, with or without a provider key.

**Architecture:** Page-side lookup and rendering use `/search/suggest?in=item` and `/database/card/item/<id>`. Published drop data uses `/api/tools/item_page`. Store item IDs with messages; card facts never enter model history or tool outputs.

**Tech stack:** Existing Next.js App Router, React, TypeScript, Vitest and game card components; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-chat-item-cards-design.md` (approved by Carlos).

## Global constraints

Preserve publishing gates, protected-page CSP and per-tab provider keys. Never invent drops, expose page-only facts to a model, log raw questions or change environment configuration. Existing conversations must remain readable.

## Review focus

Similar names must not replace exact matches. Ambiguity must offer choices. Temporary storage failure must not imply zero drops. Older conversations must render without new metadata. Failed or stopped lookups must not write into another conversation.

## Task 1: Item lookup and reference integration

Files: new `web/src/lib/chat/items.ts` and its test; existing `agent.ts`, `store.ts`, `ChatClient.tsx` and corresponding tests.

- [ ] Write and run failing tests: Linen Cloth wins over Red Linen Robe; ordinary non-item questions retain existing behavior; ambiguous names return choices; lookup failure falls back safely; saved messages retain only item references.
- [ ] Implement a small browser-side resolver for supported item questions. Validate returned IDs and canonical links, never guess a candidate. Expose typed item references to rendering and attach them to assistant messages in both no-key and provider flows. Keep references and page facts separate from model input.
- [ ] Verify cancellation and old-message compatibility in focused tests, then commit the tested change.

## Task 2: Live item card and drop evidence

Files: new `web/src/components/chat/ItemResult.tsx` and its test; existing `Message.tsx` and Chat integration tests.

- [ ] Write and run failing tests for game card display, published drop counts, pending reports, empty results, unavailable data, item choices and canonical links.
- [ ] Implement the live component with existing `GameCard`; fetch the existing page-side card and player-data item tool, abort on unmount, and show evidence and freshness where available. Render ambiguous choices as accessible controls that open the selected item in Chat.
- [ ] Verify page-only card facts are never persisted or passed to provider requests; run lookup, Chat and publishing guard tests; commit.

## Task 3: Verification and release

- [ ] Run types, lint and production build plus relevant tests. Inspect the full diff independently and fix substantive findings.
- [ ] Verify actual desktop and narrow-screen Chat, no-key Linen Cloth, unavailable-data behavior, database links and retained protected-page behavior.
- [ ] Open and link a PR with evidence; use required CI and existing deployment serialization before merge. Verify production before reporting deployed.

Execution: Carlos explicitly approved implementation. Continue in this thread without another plan approval round. Use a focused implementation delegate and an independent whole-branch review; root owns integration and release verification.
