# MCP descriptions verification

Verified offline on 2026-11-10. No deployment or registry publication.

The description regression tests first failed on missing page-tool routing and the lack of a
requested-fact check. They now enforce the listings' 2,000-character description ceiling for all
32 tools, explicit next-tool names, separate recordId/gameId, realm candidates, house selection
wording and the own-install census exception. Connection guidance has a separate regression test.

Generated MCP schemas compare equal to the base after removing only description keys. Tool names,
input fields, defaults, limits, required fields and output shapes are unchanged. Protocol 2.1.0 and
MCP server 0.9.1 stay unchanged; this is patch-level documentation under Unreleased.

## Offline question bank

Ran the repo CLI from an empty temporary directory, with both corpus-source environment variables
removed, against the same read-only `2026-10-24-everloot-public.sqlite` release and committed game files:

```text
question-bank --files-only --game-data <game-data> --out <bank.jsonl>
question-eval <bank.jsonl> --db <release.sqlite> --game-data <game-data> --out <report.md> --json <report.json>
```

The before run used the original server source; the after run used the edited descriptions. All
per-question retrieval results and totals are identical:

| Measure | Before | After |
|---|---:|---:|
| Questions | 2786 | 2786 |
| Exact resolution | 1885 | 1885 |
| Search resolution | 23 | 23 |
| Unresolved | 838 | 838 |
| With evidence | 2776 | 2776 |
| With observed evidence | 0 | 0 |
| With file evidence | 2556 | 2556 |
| With a page | 2752 | 2752 |
| Answer keys found | 1527 | 1527 |

This evaluator calls retrieval directly. It neither reads descriptions to choose tools nor measures
model answer quality. Unchanged results are a retrieval regression check, not proof of better tool
selection. The three documented journeys use the merged gameplay and realm discovery contracts;
house wording follows the merged per-house market implementation.

## Validation

- All five packages installed with `npm ci`; protocol rebuilt with the repo script.
- Protocol: 102 passed, one expected failure across eight files.
- KB: 2,017 passed, one skipped across 170 files, including the tool-table and HTTP initialization tests.
- Web MCP/docs: 106 passed across 14 files.
- Web, KB and protocol `npx tsc --noEmit` pass. Web lint passes with four existing warnings.
- Title format, whitespace, changelog placement and description-only generated-schema comparison pass.
