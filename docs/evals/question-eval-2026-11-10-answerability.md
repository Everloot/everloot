# Answerability regression evaluation

The historical banks are frozen before the change: the 2,786-question files-only bank
and the 7,448-question bilingual bank including sampled archive titles. Both use
the committed game files and the read-only 2026-10-24 public release, with observations
disconnected, dataAsOf null and answer_sources limit 8. No model, environment file,
network source or external gameplay values are involved.

The old scorer credited every returned mention as evidence and credited answer keys
against claims plus source titles. Its baseline was 2,776/2,786 with evidence and
1,527/1,527 keys found; the larger bank was 7,437/7,448 with evidence and
3,054/3,054 keys found. Those are retrieval and key-token coverage, not accuracy.

The revised scorer reports observed, files and lore retrieval separately from real
answers. Only a claim bearing the requested predicate earns answer credit; a keyed
question must also carry every key fact in answering claims. Titles and explicit
unavailable-fact messages earn no credit. Archive lore cannot establish Forever
gameplay. Unsupported question shapes conservatively earn no real-answer credit,
so this is a deterministic acceptance measure, not a model accuracy estimate.

Both retrieval versions are rescored with the same predicate rules below. Frozen
bank sizes exclude the three new cross-tool workflow cases so comparisons use
identical questions. SQL reads were memoized by query and arguments, returning
cloned results; the database handle stayed read-only.

Generate the separate acceptance bank with `question-bank --cross-tool` (with either
`--files-only` or a read-only release). Its tool-path metadata covers item-name
discovery, realm resolution and price history. The retrieval evaluator evaluates
answer_sources only; it does not claim to measure model tool selection or agreement
between tools. A synthetic regression in question-bank.test.ts separately executes
the search_knowledge, item_page, market_value, auction_history and answer_sources
handlers and checks their shared item identity, resolved realm and public scan day.

Additional regressions cover missing zone levels, lore-only acquisition, numbers
unrelated to a requested price, and answer-bearing claims ahead of subject matches
at a one-piece limit. Missing values remain unavailable rather than importing Classic
or Wowhead data. The MCP output schema and registered tool set are unchanged.

## Same-scorer before and after

| Bank | Metric | Before | After |
|---|---|---:|---:|
| 2,786-question files-only bank | Any evidence | 2,776/2,786 (99.64%) | 2,776/2,786 (99.64%) |
| 2,786-question files-only bank | Observed | 0/2,786 (0.00%) | 0/2,786 (0.00%) |
| 2,786-question files-only bank | Files | 2,556/2,786 (91.74%) | 2,556/2,786 (91.74%) |
| 2,786-question files-only bank | Lore | 2,773/2,786 (99.53%) | 2,773/2,786 (99.53%) |
| 2,786-question files-only bank | Real answer | 1,788/2,786 (64.18%) | 1,788/2,786 (64.18%) |
| 2,786-question files-only bank | All key facts in answering claims | 1,468/1,527 (96.14%) | 1,468/1,527 (96.14%) |
| 7,448-question bilingual bank | Any evidence | 7,437/7,448 (99.85%) | 7,437/7,448 (99.85%) |
| 7,448-question bilingual bank | Observed | 0/7,448 (0.00%) | 0/7,448 (0.00%) |
| 7,448-question bilingual bank | Files | 5,231/7,448 (70.23%) | 5,231/7,448 (70.23%) |
| 7,448-question bilingual bank | Lore | 7,432/7,448 (99.79%) | 7,432/7,448 (99.79%) |
| 7,448-question bilingual bank | Real answer | 3,770/7,448 (50.62%) | 3,770/7,448 (50.62%) |
| 7,448-question bilingual bank | All key facts in answering claims | 2,936/3,054 (96.14%) | 2,936/3,054 (96.14%) |
