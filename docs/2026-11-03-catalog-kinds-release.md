# Catalog kinds: what to check after the merge (2026-11-03)

The merge adds eight game-file catalog kinds to the public search: achievement, faction, title, quest_chain,
mount, legacy_perk, race and instance. They are committed JSON under `web/src/data/game-data/`, indexed by
`kb/src/catalog-index.ts` and unioned with the release at query time.

**No knowledge release is cut for this PR.** Nothing enters the release, so there is nothing to publish
to the registry for it.

## After merge

1. The deploy on `main` carries the files. Wait for it to finish before checking anything.
2. On `https://everloot.app/mcp/public`, call `get_by_name` with `Stormwind` and kind `faction`. Expect the
   Stormwind faction entry.
3. Call `search` for `Deadmines`. Expect the instance hit.
4. For each hit, confirm the licence line carries Blizzard's credit.
5. Open the url on each hit. These must load:
   - `/database/factions/72-stormwind`
   - `/database/instances/36-deadmines`

If a hit is missing, check the deploy first, then the committed JSON for that kind. Do not cut a release to
fix it.

## Things to expect

- The `KNOWLEDGE_KINDS` enum now lists kinds the release itself never holds. This is by design: those kinds
  are served from the catalogs, not the release. Do not remove them from the enum.
- The confirmation line appears on a catalog answer only once the completion rollup agrees on an id. Until
  then, the answer says the entry comes from the game files. That is expected, not a fault.
