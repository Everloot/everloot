# PR 2: Field reads with paging on get_entity and fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_entity` and `fetch` accept an optional JSON pointer and page arrays at 48 rows, so an assistant reads one sub-array of a record without the whole body.

**Architecture:** A pure pointer module resolves RFC 6901 pointers against a record's structured data and slices arrays. The two handlers call it when `field` is present and, when absent, cut any top-level array longer than 48 rows with a `nextOffset` note. Output schemas gain optional fields; the ChatGPT `search` tool is untouched.

**Tech Stack:** TypeScript, zod 4, vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-mcp-parity-batch-design.md` (section "PR 2").

**Branch:** `feat/mcp-field-reads` from `main` (rebase onto `feat/mcp-catalog-kinds` only on merge day). Held unmerged.

## Global Constraints

- No new tools. `search` (ChatGPT) keeps its shape and takes no new parameters.
- `limit` default 48, maximum 48, minimum 1; `offset` default 0, minimum 0. Values above the maximum are clamped, not rejected.
- An invalid or missing pointer never errors: the answer says "No such field" and lists the top-level keys.
- Tests: `cd kb && npm test && npm run typecheck`; `cd packages/protocol && npm test && npm run build` (commit regenerated `schema/mcp/*.json`).
- Commits `-s`. PR title: `feat(mcp): get_entity and fetch read one field of a record and page long arrays`.
- The page tools (`item_page`, `npc_page`, `object_page`, `quest_page`, `vendor_page`) are out of scope for this PR; say so in the PR body.

## Review Focus

1. A pointer with escaped characters (`/a~1b/~0`): resolves per RFC 6901 (`~1` is `/`, `~0` is `~`) (Task 1 test).
2. A pointer into a string or number (`/name/0`): "No such field", keys of the nearest object listed (Task 1 test).
3. `offset` past the end of an array: an empty `value` and no `nextOffset`, not an error (Task 1 test).
4. A record whose `data` is `{}` (most lore pages): `field` answers "No such field" with an empty key list and the whole-record path still returns the body (Task 2 test).
5. `fetch` with `field` on an id that does not exist: the existing "No record with id" error, unchanged (Task 2 test).

---

### Task 1: The pointer and paging module

**Files:**
- Create: `kb/src/json-pointer.ts`, `kb/src/json-pointer.test.ts`

**Interfaces:**
- Produces: `readPointer(root: unknown, pointer: string): { ok: true; value: unknown } | { ok: false; keys: string[] }` (`""` is the root; keys = own enumerable keys of the deepest object reached, `[]` for a non-object).
- Produces: `pageArray(value: unknown, offset: number, limit: number): { value: unknown; nextOffset?: number }` (non-arrays pass through unchanged; `limit` clamped to `[1, 48]`, `offset` to `>= 0`).
- Produces: `MAX_ROWS = 48`.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([
  ["", { a: 1 }, { ok: true, value: { a: 1 } }],
  ["/a/0/b", { a: [{ b: "x" }] }, { ok: true, value: "x" }],
  ["/a~1b/~0", { "a/b": { "~": 2 } }, { ok: true, value: 2 }],
  ["/missing", { a: 1, b: 2 }, { ok: false, keys: ["a", "b"] }],
  ["/name/0", { name: "Thrall" }, { ok: false, keys: [] }],
  ["/a/9", { a: [1] }, { ok: false, keys: [] }],
])("readPointer(%s)", (p, root, want) => expect(readPointer(root, p)).toEqual(want));
test("pageArray slices and reports nextOffset only when rows remain", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  expect(pageArray(arr, 0, 48)).toEqual({ value: arr.slice(0, 48), nextOffset: 48 });
  expect(pageArray(arr, 96, 48)).toEqual({ value: [96, 97, 98, 99] });
  expect(pageArray(arr, 500, 48)).toEqual({ value: [] });
  expect(pageArray(arr, 0, 1000).value).toHaveLength(48);
  expect(pageArray("text", 0, 48)).toEqual({ value: "text" });
});
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run src/json-pointer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two functions (about 40 lines; no dependency).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(kb): a JSON pointer reader with 48-row paging"`.

---

### Task 2: Schema and handlers

**Files:**
- Modify: `packages/protocol/src/mcp.ts` (`get_entity.inputSchema`, `get_entity.outputSchema`, `fetch.inputSchema`, `fetchedDocument`)
- Modify: `kb/src/search.ts` (`getDocument` returns `data` too)
- Modify: `kb/src/mcp-server.ts` (`get_entity` and `fetch` handlers, `handleGetEntity`)
- Create: `kb/src/field-reads.test.ts`

**Interfaces:**
- Input, both tools: `field: z.string().max(200).optional()` describe `"A JSON pointer into the record's data, such as /criteria or /reagents/0. Without it, the whole record."`; `offset: z.number().int().min(0).default(0)` describe `"Row to start at when the field is an array; use nextOffset from the last answer."`; `limit: z.number().int().min(1).max(48).default(48)` describe `"Rows per answer, at most 48."`.
- `get_entity.outputSchema` gains `field: z.object({ pointer: z.string(), value: z.unknown(), nextOffset: z.number().int().optional() }).optional()` and `keys: z.array(z.string()).optional()` (present only on a miss).
- `fetchedDocument` gains the same two optional fields at the top level; `text` holds the JSON of the field value when `field` is given (so ChatGPT shows the slice), otherwise the body as today.
- `getDocument` returns `{ ...hit, body, data: Record<string, unknown> }` (parse the `data` column; `{}` on parse failure).
- Whole-record path: every top-level array in `data` longer than 48 rows is replaced by its first 48 plus a sibling key `<name>NextOffset: 48`; the text answer ends with `"Arrays are cut at 48 rows; read more with field and offset."` only when a cut happened.

- [ ] **Step 1: Write the failing tests** against a fixture release with one `quest_chain` row whose `data.questIds` has 60 ids and one lore page with `data: {}`:

```ts
test("get_entity with field returns the slice and nextOffset", async () => {
  const out = await handlers.get_entity({ id, field: "/questIds", offset: 0, limit: 48 });
  expect(out.structured.field).toEqual({ pointer: "/questIds", value: ids.slice(0, 48), nextOffset: 48 });
  expect(out.text).toMatch(/nextOffset 48/);
});
test("a bad pointer lists the keys", async () => {
  const out = await handlers.get_entity({ id, field: "/nope" });
  expect(out.structured.keys).toEqual(["build", "questCount", "questIds"]);
  expect(out.text).toMatch(/^No such field \/nope/);
});
test("a lore page with empty data answers No such field with no keys", async () => {
  expect((await handlers.get_entity({ id: loreId, field: "/x" })).structured.keys).toEqual([]);
});
test("whole record cuts long arrays and says so", async () => {
  const out = await handlers.fetch({ id: String(id) });
  const doc = JSON.parse(out.text);
  expect(doc.text).toMatch(/Arrays are cut at 48 rows/);
});
test("fetch with field puts the slice in text", async () => {
  const doc = JSON.parse((await handlers.fetch({ id: String(id), field: "/questIds", offset: 48 })).text);
  expect(JSON.parse(doc.text)).toEqual(ids.slice(48));
  expect(doc.field.nextOffset).toBeUndefined();
});
test("fetch with field on an unknown id keeps the existing error", async () => {
  await expect(handlers.fetch({ id: "999999", field: "/x" })).rejects.toThrow(/No record with id/);
});
```

- [ ] **Step 2: Run**: `cd kb && npx vitest run src/field-reads.test.ts`. Expected: FAIL.
- [ ] **Step 3: Change the schemas**, then `getDocument`, then the two handlers, using Task 1's functions. Keep `handleGetEntity`'s text for the whole-record case as it is, plus the cut note.
- [ ] **Step 4: Run** `cd kb && npm test && npm run typecheck`; `cd packages/protocol && npm test && npm run build`. Expected: PASS; commit the regenerated schema JSON.
- [ ] **Step 5: Commit**: `git commit -s -m "feat(mcp): get_entity and fetch read one field of a record and page long arrays"`.

---

### Task 3: PR

- [ ] **Step 1**: `git push -u origin feat/mcp-field-reads`; `gh pr create --draft` with the title above and a body stating the parameter trio, the 48-row rule, that page tools are unchanged, and the attribution line. Do not mark ready; do not merge.
