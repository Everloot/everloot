# The question bank: measuring the answer engine against what players ask

**Date:** 2026-10-27
**Status:** phase 1 built in the same pull request as this spec (the bank, the eval, the first report). Phases 2 and 3 are design only.
**Builds on:** sourced answers (`answer_sources`, [spec](2026-10-17-sourced-answers-design.md)), the agent chat ([spec](2026-10-18-agent-chat-design.md)), the client data placement (docs/2026-10-18-client-data-placement.md).

## Why

Carlos, 2026-10-27: the chat and the knowledge structure should have "full knowledge based and understanding on the
ecosystem and what people ask", and we "need to do some training to our system to digest all the details and
questions that people may look or search."

Everloot does not train a model: the chat runs on a key the player brings or a free route, and there is no data or
budget for fine-tuning weights. What can be trained is the system around the model: the questions it is measured
against, the retrieval that feeds it, and the gaps the measurement exposes. Until now the data waves were chosen
from the files' side (which tables exist) and nothing measured the demand side (which questions fail). This spec
adds the measurement.

## Hard limits

- **Our own questions.** The bank is generated from Everloot's own data and a hand-written long tail. No forum, Discord
  or search log is scraped. Real player phrasings come only from the question ledger (phase 3), once the data policy
  covers it.
- **No model in the eval.** Phase 1 scores retrieval, which is deterministic and free: did the name resolve, did
  evidence come back, is there a page. A model-written answer is phase 2 and needs a key.
- **Nothing published by itself.** The report lists names from the game-data files and wiki page titles, which the
  pages already show. It never carries player data.

## Phase 1 (built)

### The bank, `npm run kb -- question-bank --db <public release>`

Subjects, in this order:

1. **The game-data files** (`web/src/data/game-data`, each optional so the bank grows as files land): zones and
   instances and flight nodes from `map.json`, bosses from `client-encounters.json`, mounts from `client-mounts.json`,
   achievements from `client-achievements.json`, professions and item categories from `client-layer.json`, talent
   names from `talents/*.json`.
2. **Wiki page titles from the knowledge release**, by what their categories say they are (instances, quests, named
   mobs and characters, items, zones), `--per-kind` of each spread across the alphabet so the sample is the same on
   every run. Disambiguation titles are left out.
3. **Instance aliases** players type (MC, BRD, BWL, ZG, AQ40, SM, DM, VC, WC, …), each expecting its instance.
4. **The long tail**: forty questions about Forever, classes, leveling, gold, travel, addons, the ecosystem, Everloot
   itself, the realm population, the market, raids, talents, keys and attunements, reputation, events and lore.
   These expect evidence, not a record.

Templates are the shapes players type, per subject kind: where is, entrance, level, bosses, drops, where does it drop,
who sells, worth, what is, how do I get, riding skill, criteria, quest giver, how to complete, reward, how to level a
profession, what it makes, which class has a talent, best of a category, how to fly there. One question per template
and subject, with a stable id (`<template>:<kind>:<slug>`), one JSON line each.

### The eval, `npm run kb -- question-eval <bank.jsonl> --db <public release>`

For every question, with no model: `get_by_name` on the subject's name (exact), else `search` on the question text
(by search, when a hit carries the subject's name), else unresolved; an alias is scored on its text alone. Then
`answer_sources` on the question: how many pieces, which kinds (observed, curated, lore), and whether any points
at an everloot.app page. Player observations join when `EVERLOOT_PUBLIC_CORPUS_URL` or `EVERLOOT_UPLOADS` is set;
otherwise the report says the observed layer is unrecorded, not empty.

The report is markdown under `docs/evals/`, dated: totals, per template, per subject kind, then the two gap lists,
the unresolved subjects per kind and the questions with no evidence per template. The JSON beside it (`--json`) is
the diff baseline. Committing the report is what makes the number move visibly.

### What the first report is for

The gap lists are the demand signal. A kind with many unresolved names (bosses, mounts, achievements) says the
knowledge release needs that kind as an entity with a page link, ids and facts only, the files' text staying on the
page. A template with no evidence (riding skill, criteria, worth) says a tool or an evidence kind is missing. The
aliases say whether short forms map at all. Each fix is a normal pull request, and the next report proves it.

## Phase 2 (design only): a model in the loop

Run the bank, or a sample of it, through the chat's own planner (`web/src/lib/chat/agent.ts`) with a fixture
provider or a cheap model, and score whether the answer cites the evidence and names the page. This is what the
"cite" column would mean. It costs tokens per run, so it runs on demand, never on every push.

## Phase 3 (the question ledger)

**3a, built (same day, Carlos's go):** for each lookup the chat makes through `/api/tools`, one daily usage
counter, `ledger.<tool>.hit` or `ledger.<tool>.miss`, for `search_knowledge`, `get_by_name`, `get_entity`,
`search` and `answer_sources` (`web/src/lib/question-ledger.ts`). The tool's name and found-or-not, nothing else:
no question text, no looked-up name, no account. docs/DATA_POLICY.md, "The question ledger", and the privacy
page say so. Lookups over the MCP mounts (the Desktop App, in-game `/ask`, the public MCP) are counted by call
today, not by hit or miss: counting those the same way is the next step on this phase.

**3b, design only, needs its own data-policy line:** which named subjects fail to resolve, kept as game names
without the question. That is what would feed the bank with the aliases players actually use.

## Tests

`kb/test/question-bank.test.ts`: subjects from synthetic game-data files (missing files add nothing), the bank's
templates and stable ids and round trip, wiki subjects by category with the first rule winning, resolution exact /
search / none / n/a, and the report's totals, gap lists and markdown.
