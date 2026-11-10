# Answerability review regression evaluation

Frozen banks: 2,786 files-only questions and 7,448 bilingual questions, including sampled archive titles.
Both runs use the read-only 2026-10-24 public release, committed game files, observations disconnected,
dataAsOf null and limit 8. No model, network lookup, environment file or external gameplay values.
Questions were generated once before the fixes and reused unchanged afterward. SQL reads were memoized
by query and arguments with cloned results, preserving the read-only release semantics.

Before is PR #1101 after merging main through #1100 (0df3d377); after includes the review repairs.
These compare the old and repaired predicate recognition, not a fixed-scorer retrieval experiment.
Retrieval remains unchanged; the answerability increase reflects corrected classification of permitted
claims, chiefly acquisition. This is not model accuracy or evidence of new data coverage.

| Bank | Metric | Before review fixes | After all review fixes |
|---|---|---:|---:|
| 2,786 files-only | Any evidence | 2,776/2,786 (99.64%) | 2,776/2,786 (99.64%) |
| 2,786 files-only | Observed | 0/2,786 (0.00%) | 0/2,786 (0.00%) |
| 2,786 files-only | Files | 2,556/2,786 (91.74%) | 2,556/2,786 (91.74%) |
| 2,786 files-only | Lore | 2,773/2,786 (99.53%) | 2,773/2,786 (99.53%) |
| 2,786 files-only | Real answer | 1,788/2,786 (64.18%) | 2,051/2,786 (73.62%) |
| 2,786 files-only | All key facts in answering claims | 1,468/1,527 (96.14%) | 1,468/1,527 (96.14%) |
| 7,448 bilingual | Any evidence | 7,437/7,448 (99.85%) | 7,437/7,448 (99.85%) |
| 7,448 bilingual | Observed | 0/7,448 (0.00%) | 0/7,448 (0.00%) |
| 7,448 bilingual | Files | 5,231/7,448 (70.23%) | 5,231/7,448 (70.23%) |
| 7,448 bilingual | Lore | 7,432/7,448 (99.79%) | 7,432/7,448 (99.79%) |
| 7,448 bilingual | Real answer | 3,770/7,448 (50.62%) | 4,298/7,448 (57.71%) |
| 7,448 bilingual | All key facts in answering claims | 2,936/3,054 (96.14%) | 2,936/3,054 (96.14%) |

All 283 English mount/achievement how-get questions now have answering evidence (previously 9/283).
Acquisition accepts mount taught-by/riding-skill facts and achievement criteria, while get-to navigation
never becomes acquisition. Subject names are removed before predicate detection, price history requires
market context, riding skill precedes level, and worth-it opinions do not request a price.

`unavailable: { predicate, message }` is optional metadata, separate from bounded factual evidence.
Its message points to market_value/auction_history, entity_relations (sold_by/dropped_by), item_page,
quest_page, talent_tree, profession_path or the relevant record tool. It cannot inflate ledger hits or
companion naming, and empty evidence still prints No evidence found.
The protocol remains 2.1.0 under Unreleased; generated schema/dist rebuild without drift.

Metrics are defined in docs/design/specs/2026-10-27-question-bank-design.md. Real-answer credit needs a
predicate-bearing claim and all keyed facts when keyed; titles and unavailable notices earn no credit.
Archive lore cannot establish current Forever gameplay. Unsupported question shapes earn no real-answer
credit. Cross-tool cases stay outside the frozen bank counts: question-bank --cross-tool generates them,
and synthetic handler acceptance tests check item discovery, realm aliases and public scan-day agreement.

Re-check repairs exclude travel/reputation acquisition and incidental levels, route profession leveling to
profession_path, preserve where-to-learn riding as location, recognize how-much prices and leave class
opinions without a predicate. One predicate, after removing subject and matched article names, governs
ranking and unavailable metadata. Connected observations retain unrecorded notes within the fill budget.
The files bank loses answer credit for the bare aliases "VC level" and "RFC level" under the required
asking-shape rule; retrieval and keyed-fact counts stay unchanged.

Validation: npm ci in all five packages; KB 2,081 passed/one skipped; protocol 103 passed/one expected
failure; companion 180 passed; web MCP/ledger/routes 46 passed. Web, KB and companion npx tsc --noEmit
pass. Web lint passes with two existing warnings; changed KB lint passes with two existing warnings.
Protocol schema/dist rebuild has no drift. Static predicate and unavailable sweeps reuse the frozen banks;
all unavailable notices print, no result exceeds limit 8, and no data-policy piece enters evidence.
Unavailable notices in the 7,448-question sweep: 2,261 before this re-check and 2,267 after.
