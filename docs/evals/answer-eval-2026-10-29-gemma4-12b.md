# Written-answer eval, 2026-10-29

Model `gemma4:12b`, 60 questions with an answer key, each sent with answer_sources' evidence under the in-game /ask rules. Correct: the reply carries every fact of the key; partial: some; declined: the model said the sources do not answer; wrong: none.

## Totals

| | questions | correct | partial | declined | wrong | error |
|---|---|---|---|---|---|---|
| all | 60 | 90% | 0% | 3% | 0% | 7% |

## By template

| | questions | correct | partial | declined | wrong | error |
|---|---|---|---|---|---|---|
| where-is | 21 | 86% | 0% | 0% | 0% | 14% |
| level | 1 | 100% | 0% | 0% | 0% | 0% |
| bosses | 2 | 0% | 0% | 100% | 0% | 0% |
| riding-skill | 8 | 100% | 0% | 0% | 0% | 0% |
| talent-class | 28 | 96% | 0% | 0% | 0% | 4% |

## Answers that missed

| question | expected | reply |
|---|---|---|
| where is Kresh | Wailing Caverns | empty reply: the token budget ran out (raise --max-tokens) |
| where is Tuten'kash | Razorfen Downs | empty reply: the token budget ran out (raise --max-tokens) |
| where is Rattlegore | Scholomance | empty reply: the token budget ran out (raise --max-tokens) |
| which bosses are in Blackfathom Deeps | Baron Aquanis, Ghamoo-ra, Aku'mai, Lady Sarevess, Geilhast, Gelihast, Lorgus Jett, Old Serra'kis, Twilight Lord Kelris | Not in the sources. |
| which bosses are in Dire Maul | Zevrim Thornhoof, Hydrospawn, Lethtendris, Pusillin, Alzzin the Wildshaper, Tendris Warpwood, Illyanna Ravenoak, Magister Kalendris, Immol'thar, Prince Tortheldrin, Guard Mol'dar, Stomper Kreeg, Guard Fengus, Guard Slip'kik, Captain Kromcrush, Cho'Rush the Observer, King Gordok, Lord Hel'nurath, Tsu'zee | Not in the sources. |
| which class has Lone Wolf | Hunter | empty reply: the token budget ran out (raise --max-tokens) |
