# Written-answer eval, 2026-10-29

Model `gemma3:4b`, 60 questions with an answer key, each sent with answer_sources' evidence under the in-game /ask rules. Correct: the reply carries every fact of the key; partial: some; declined: the model said the sources do not answer; wrong: none. Player observations not connected: the evidence has no observed pieces, unlike in-game /ask.

## Totals

| | questions | correct | partial | declined | wrong | error |
|---|---|---|---|---|---|---|
| all | 60 | 95% | 0% | 2% | 3% | 0% |

## By template

| | questions | correct | partial | declined | wrong | error |
|---|---|---|---|---|---|---|
| where-is | 21 | 95% | 0% | 0% | 5% | 0% |
| level | 1 | 100% | 0% | 0% | 0% | 0% |
| bosses | 2 | 0% | 0% | 50% | 50% | 0% |
| riding-skill | 8 | 100% | 0% | 0% | 0% | 0% |
| talent-class | 28 | 100% | 0% | 0% | 0% | 0% |

## Answers that missed

| question | expected | reply |
|---|---|---|
| where is Undercity | Tirisfal Glades | Undercity is a zone of the Eastern Kingdoms. It was formerly the capital city of the Forsaken, now known as the Ruins of Undercity. |
| which bosses are in Blackfathom Deeps | Baron Aquanis, Ghamoo-ra, Aku'mai, Lady Sarevess, Geilhast, Gelihast, Lorgus Jett, Old Serra'kis, Twilight Lord Kelris | Not in the sources. |
| which bosses are in Dire Maul | Zevrim Thornhoof, Hydrospawn, Lethtendris, Pusillin, Alzzin the Wildshaper, Tendris Warpwood, Illyanna Ravenoak, Magister Kalendris, Immol'thar, Prince Tortheldrin, Guard Mol'dar, Stomper Kreeg, Guard Fengus, Guard Slip'kik, Captain Kromcrush, Cho'Rush the Observer, King Gordok, Lord Hel'nurath, Tsu'zee | All bosses in Dire Maul drop The Emerald Dream, Frost Shock and You, Harnessing Shadows, and The Arcanist’s Cookbook. Data from Everloot (https://everloot.app), CC BY-SA 4.0. |
