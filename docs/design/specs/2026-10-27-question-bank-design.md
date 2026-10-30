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

## Fixes the eval has proven

- **Name aliases (same day).** `kb/src/name-aliases.ts`: the short forms players type (MC, BRD, BWL, ZG, AQ20,
  AQ40, SM, DM, VC, WC, RFC, SFK, ST, UBRS, Strat, Scholo, Mara, Ony, Naxx, Uld, the cities, STV, EPL, WPL, the
  battlegrounds, AH, DMF) mapped to the titles the release carries. `search` expands them before reading the words
  and puts the expanded names' own pages first; `get_by_name` falls back to the alias and to the title with or
  without its article ("The Barrens" / "Barrens"). The eval's alias row went from 0 of 20 resolved to 20 of 20,
  zones from 96% to 100% (`docs/evals/question-eval-2026-10-27-aliases.md`, which also carries the bosses, mounts
  and achievements the merged game-data files added to the bank: 4,434 questions now, 65% resolving, with the
  achievements (13%) and mounts (44%) as the next gap).

- **The files as an evidence kind (same day).** `kb/src/files-evidence.ts`: the committed game-data files' facts
  about the instances, bosses, zones, flight masters, mounts, achievements and talents a question names, as ids and
  facts with a page link, labelled found in game files and unconfirmed with the build; never the files' text.
  `answer_sources` returns them after curated and before lore (protocol 1.21.0 adds `files` to the evidence kinds),
  the site lends the index to the MCP mounts and GET /api/tools, and the eval gains a "with files" column.
  `docs/evals/question-eval-2026-10-27-files.md`: files facts on 75% of all questions, 100% of achievement,
  mount, talent and instance questions, pages on 97%; questions with no evidence 25 → 20, nineteen of them bosses
  of instances the map keeps behind the spoiler switch.

## The answer key (built 2026-10-28)

Forever's answers move between builds; the questions do not. "What riding skill does Brown Horse need" asks for the
same field on every build, whatever its value. So the bank pins the question and its field, and the value is read
again from the game-data files each time the bank is generated (`kb/src/answer-key.ts`). Nothing is typed by hand,
so nothing goes stale.

Each question the files can answer carries `answer: { facts, from, build }`: the facts a correct answer has to
contain, the file and field they came from, and the game build of that file. On build 1.60.1.70685, 1,524 of the
4,424 questions carry one (1,003 before the zone, entrance and talent keys of 2026-10-29):

| template | subject | facts from |
|---|---|---|
| riding-skill | mount | `client-mounts.json` ridingSkill |
| level | instance | `map.json` entrance minLevel, maxLevel |
| where-is, entrance | instance | `map.json` entrance map, then its zone name |
| where-is | zone | `map.json` the zone's continent |
| bosses | instance | `client-encounters.json` names for the instance's map |
| where-is | boss | the instance whose map lists the boss |
| where-is, flight-to | flight | the node's zone from the released zone list; a node in a held-back zone is no question at all |
| talent-class | talent | `talents/*.json` className, every class that has the name |
| what-is | talent | `talents/*.json` the classes and trees that have the name |

A missing file or field gives no answer, never a guess. The 2023 wiki pages carry only their categories and prose,
and observed drops and prices move every day, so neither gives a fixed key; the keys stay with the game files. Achievement criteria have none on purpose: their text stays
on the achievement's page (docs/DATA_POLICY.md), so no tool answer can carry it. Wiki subjects and the other
templates have none yet: their answers live in the knowledge release or in play, not in these files.

**Between builds**, `npm run kb -- question-diff <before.jsonl> <after.jsonl> [--out <report.md>]` compares two
banks question by question and lists the answers a build changed, added and removed, with both builds named.
Order inside a list (a boss list, say) is not a change. The "before" bank is generated from the older files
(`git archive <commit> web/src/data/game-data`, then `question-bank --game-data <that folder>`). Against 70532, the
70658 bank removed "which class has Piercing Ice" (Mage) and added Arcane Wrath (Mage), which is what the build's
own change file (`changes/wowf-70630.json`) records; 70634 to 70658 changed none of these answers, and that
build's change file lists no talent or map changes either. 70658 to 70685 changed none, and neither does its
change file.

**In the eval**, a new column, "answer in evidence": of the questions with an answer key, how many got
`answer_sources` evidence carrying every fact (a whole word or number, any case: 75 is not found in 175). The
report's last list, "Answers missing from the evidence", names the question and the facts it lacked. That is what
the model is handed, so a fact missing there is one no model can answer from.

The first run found four gaps in `files-evidence.ts`. Three are fixed in the same pull request, taking the column
from 82% to 98% of the keyed questions (`docs/evals/question-eval-2026-10-29-answer-key.md` is the run after); the
fourth waits on a policy decision:

- **Boss lists (4%, open).** An instance's fact gives the number of encounters, not their names, so "which bosses
  are in Shadowfang Keep" cannot be answered from the evidence. Naming them was tried and taken back in review: no
  DATA_POLICY line allows game-file encounter names through the API or MCP (the policy's game-file section allows
  the client layer and the race table there; the files evidence of #536 already names each boss in its own fact,
  also without a line). The maintainer decides whether the files evidence gets a policy line; until then the key
  keeps the names and the eval shows the gap.
- **Shared talents (99% → 100%).** Evidence kept one fact per name, so a talent two classes have (Deflection,
  Flurry, Precision, …) came back with one class. It keeps one per fact now.
- **Held-back zones (review, 2026-10-29).** Five flight masters sit in zones the map holds back as unreleased. Naming
  their zone was tried and taken back: DATA_POLICY keeps new zones hidden unless the reader turns spoilers on, and
  the public MCP tool leaves them out altogether. They are now left out of the files evidence (name and zone; the
  #536 index had already been naming the nodes), the answer key and the bank.
- **Achievement criteria** were scored against text the policy keeps on the page; they left the key instead.

What this is for: the changed list is what to recheck in game after a patch; the column says whether the facts reach
the model. Whether the model's written answer then carries them (in game or on the site) is phase 2.

## Phase 2 (built 2026-10-29): a model in the loop

`npm run kb -- question-answer-eval <bank.jsonl> --db <release> --base-url <OpenAI-compatible URL> --model <name>`
(`kb/src/answer-eval.ts`): a sample of the questions with an answer key (every k-th, `--sample`, 200 by default),
each sent with `answer_sources`' evidence under the in-game `/ask` rules (two sentences, plain text, "Not in the
sources." when they do not answer), and the reply scored against the key. Correct: every fact; partial: some;
declined: the exact refusal; wrong: none; error: no reply. A reasoning model needs room to answer after it thinks
(`--max-tokens`, 1500 by default), so an empty reply is an error, never a wrong answer. Facts match as whole words,
curly or straight apostrophes, a word's plural included. Any local Ollama or vLLM works (`http://localhost:11434/v1`);
the key, if any, is read from `--key-file`. One call per question, so it runs on demand, never in CI.

Player observations join the evidence when the public corpus is reachable, as they do for in-game `/ask`; the report
says whether they did. First runs, 60 questions on local models through Ollama on the maintainer's machine, without
player observations:

| model | correct | declined | wrong | error |
|---|---|---|---|---|
| gemma3:4b | 57 | 1 | 2 | 0 |
| gemma4:12b | 54 | 2 | 0 | 4 (token budget) |

The misses are what to work on: the boss lists the evidence cannot name yet (the 12B model declines, the 4B invents
an answer), a flight master's zone answered with its continent (Undercity), and a reasoning model's budget.
Reports: `docs/evals/answer-eval-2026-10-29-gemma3-4b.md`, `-gemma4-12b.md`.

Rules tuned on the same 80 questions (half Spanish) with gemma3:4b, after the boss names and the Spanish search:
76 correct with the first rules; 78 with two more, "for where or how to get somewhere, name the zone first" and
"prefer players' observations and the game files over the 2023 wiki", which fixed the flight and entrance misses
(`answer-eval-2026-10-29-gemma3-4b-rules.md`). Asking the model to reply in the question's language was tried and
dropped: in Spanish the 4B model translated class and tree names ("Druida", "Sagrado") even when told not to, and named
the wrong class for two talents, down to 57 and then 58 correct. Spanish questions are answered in English, the names
as the English client shows them, until a stronger model keeps them; a hosted model is the one to retry it with.

## Questions in Spanish (built 2026-10-29)

Carlos: many Spanish-speaking players run the English client because the Spanish client's names are from a region
they don't relate to, and ask in Spanish anyway. So the Spanish questions keep the names in English, as the English
client shows them, and phrase the rest the way a Puerto Rican player types, gamer words included ("qué bosses hay en
Deadmines", "qué dropea", "dónde queda"). `TEMPLATES_ES` phrases every template, `TOPICS_ES` is a sample of the long
tail, and the aliases stay English. `question-bank --spanish` adds them after the English ones, ids prefixed `es:`,
with the same answer key; it is off by default, so the build-watch diff lists each changed answer once. The eval
gives each Spanish template its own row ("where-is (es)") and adds a by-language section.

First run (8,686 questions): Spanish matched English on resolution (66% exact) and on answer in evidence (98%),
because a named question is found by its English name. The gap the table did not show was the questions that name
nothing: "cuánto cuesta un mount" and "dónde aprendo riding" came back with lore that only shared the word "mount" or
"riding", and 20 unresolved names got evidence that matched "dónde" or "queda". The words that carry those questions
(cost, learn) are Spanish, and the wiki is English.

So search reads Spanish first (`kb/src/spanish.ts`): a question that reads as Spanish (a word only Spanish questions
use, or ¿ ¡) loses its filler words and has its asking words glossed into the English the pages use ("cuesta" is
cost, "aprendo" is learn); names are kept, and a capitalized word after the first counts as a name. English
questions are never touched: on the rerun every English result is identical. "cuándo sale Forever" now meets the
launch-date entry, "dónde aprendo riding" the riding trainers, "necesito llave para Scholomance" the key quests, and
the 20 false matches are gone (`docs/evals/question-eval-2026-10-29-spanish.md` is the rerun). A client set to
Spanish (esES or esMX names) is not covered: it needs the localized names, which the game files hold per locale.

## Phase 3 (the question ledger)

**3a, built (same day, Carlos's go):** for each lookup the chat makes through `/api/tools`, one daily usage
counter, `ledger.<tool>.hit` or `ledger.<tool>.miss`, for `search_knowledge`, `get_by_name`, `get_entity`,
`search` and `answer_sources` (`web/src/lib/question-ledger.ts`). The tool's name and found-or-not, nothing else:
no question text, no looked-up name, no account. docs/DATA_POLICY.md, "The question ledger", and the privacy
page say so. Lookups over the MCP mounts (the Desktop App, in-game `/ask`, AI clients) are counted the same way
since 2026-10-29 (`mcpLedgerMetrics`): each `tools/call` of a lookup tool is matched to its JSON answer by id, and only
whether the structured answer found anything is read. The per-tool call counters now take the protocol's tool list,
so `answer_sources` and the newer tools no longer count as "other".

**3b, design only, needs its own data-policy line:** which named subjects fail to resolve, kept as game names
without the question. That is what would feed the bank with the aliases players actually use.

## Tests

`kb/test/question-bank.test.ts`: subjects from synthetic game-data files (missing files add nothing), the bank's
templates and stable ids and round trip, wiki subjects by category with the first rule winning, resolution exact /
search / none / n/a, and the report's totals, gap lists and markdown. `kb/test/answer-key.test.ts`: each template's
facts, field and build from synthetic files, no answer for a missing field or file, and the diff's changed, added and
removed lists with reordered facts not counted.
