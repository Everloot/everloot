# Recon: localized names in the Forever client — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A written yes/no with a cost on whether the current CDN build carries localized name strings the client-mining pipeline can extract for items, NPCs, quests, spells and the nine catalog kinds.

**Architecture:** Read-only. Uses the `everloot-client-mining` skill (load it with the Skill tool first) to scan the current build's tables and their locale columns. No tables are published, no keys read, nothing decrypted.

**Spec:** `docs/superpowers/specs/2026-11-03-mcp-parity-batch-design.md` (section "Recon: localized names").

**Branch:** `docs/localized-names-recon` from `main`. Docs only.

## Global Constraints

- No code changes. No new tables added to `CLIENT_TABLES`. No decryption.
- Every number in the report says which build and which command produced it.

---

### Task 1: Scan and report

**Files:**
- Create: `docs/2026-11-0X-localized-names-recon.md` (X = the day the scan runs)

- [ ] **Step 1**: Invoke the `everloot-client-mining` skill and follow its scan procedure against the current `wowf` build (`npm run kb -- client-extract --product wowf` or the skill's scan command). Record the build id and version.
- [ ] **Step 2**: For each of `ItemSparse`, `Creature`, `QuestV2`/`QuestInfo`, `SpellName`, `Achievement`, `Faction`, `CharTitles`, `QuestLine`, `Mount`, `ChrRaces`, `LFGDungeons`, `SkillLine`: which columns end in `_lang`, whether the extracted rows hold one string per locale or only the client's locale (check the pinned WoWDBDefs definition and one row), and which locales appear.
- [ ] **Step 3**: Row counts per table and bytes for a name-only extraction (`id`, `name` per locale), from the snapshot's `client_rows` sizes.
- [ ] **Step 4**: Write the report: a one-line verdict ("the build ships <n> locales in these tables" or "the build ships enUS only; other locales need the localized CDN products, which were not scanned"), the table above, the byte estimate, and the cost: what `KNOWLEDGE_KINDS` rows would need (a `names` map in `data`), and which of Azeroth DB's ten locales (`enUS deDE esES esMX frFR koKR ptBR ruRU zhCN zhTW`) are reachable. No recommendation beyond the facts; Carlos decides.
- [ ] **Step 5**: `git commit -s -m "docs(kb): what the Forever client holds for localized names"`; `git push -u origin docs/localized-names-recon`; `gh pr create --draft` (docs only). Report the verdict line in the hand-back.
