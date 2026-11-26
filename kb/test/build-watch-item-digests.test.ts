import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChangeEntry, hasChanges } from "../src/build-watch/changes.js";
import { buildChangeEntry } from "../src/build-watch/diff.js";
import { diffItemDigests, itemDigestsOf, readItemDigests, writeItemDigests } from "../src/build-watch/item-digests.js";
import { prBody } from "../src/build-watch/render.js";
import type { Rows } from "../src/talents/build-catalog.js";
import { node, stamp, trimmed } from "./build-watch-fixtures.js";

/** Item and ItemSparse rows in the client's column names. Nothing here comes from game files. */
type Sparse = { id: number; name?: string; level?: number; price?: number; bonding?: number };
function tables(sparse: Sparse[], items: { id: number; icon?: number; subclass?: number }[]): (t: string) => Rows | undefined {
  const t: Record<string, Rows> = {
    ItemSparse: new Map(sparse.map((s) => [s.id, {
      ID: s.id, Display_lang: s.name ?? `Item ${s.id}`, OverallQualityID: 2, ItemLevel: s.level ?? 10, RequiredLevel: 5,
      Bonding: s.bonding ?? 1, InventoryType: 0, SellPrice: s.price ?? 100, MaxCount: 0,
    }])),
    Item: new Map(items.map((i) => [i.id, { ID: i.id, ClassID: 15, SubclassID: i.subclass ?? 0, InventoryType: 0, IconFileDataID: i.icon ?? 1000 + i.id }])),
  };
  return (name) => t[name];
}

const BLOCKS = { Item: 16, ItemSparse: 31 };
const digests = (buildId: number, get: ReturnType<typeof tables>, blocks = BLOCKS) => itemDigestsOf(stamp(buildId), get, blocks);

const base = tables([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);

describe("item digests", () => {
  it("holds one digest per item the Item or ItemSparse table lists, hashes only", () => {
    const d = digests(100, base);
    expect(Object.keys(d.items)).toEqual(["1", "2", "3", "4"]);
    // A named ItemSparse row gives every part; an Item row alone gives the icon part.
    expect(d.items["1"]).toMatch(/^[0-9a-f]{44}$/);
    expect(d.items["4"]).toMatch(/^[0-9a-f]{4}$/);
    expect(JSON.stringify(d)).not.toContain("Item 1");
  });

  it("writes one item per line and reads back the same", () => {
    const root = mkdtempSync(join(tmpdir(), "item-digests-"));
    try {
      const d = digests(100, base);
      writeItemDigests(root, d);
      expect(readItemDigests(root)).toEqual(d);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists items added and removed, and the parts of an item that changed", () => {
    const next = tables(
      [{ id: 1, price: 250 }, { id: 2, name: "Renamed", bonding: 2 }, { id: 4 }, { id: 5 }],
      [{ id: 1 }, { id: 2, icon: 9 }, { id: 4 }, { id: 5 }, { id: 6 }],
    );
    const { items, warnings } = diffItemDigests(digests(100, base), digests(101, next), false);
    expect(warnings).toEqual([]);
    expect(items).toEqual({
      spoiler: false, comparedTo: 100, added: [5, 6], removed: [3],
      changed: [{ id: 1, fields: ["sellPrice"] }, { id: 2, fields: ["name", "binding", "icon"] }, { id: 4, fields: ["tooltip-added"] }],
    });
  });

  it("is quiet when nothing changed", () => {
    expect(diffItemDigests(digests(100, base), digests(101, base), false).items).toMatchObject({ added: [], removed: [], changed: [] });
  });

  it("lists nothing when the item tables skip a different number of encrypted blocks: an old item could read as new", () => {
    const { items, warnings } = diffItemDigests(digests(100, base), digests(101, base, { Item: 15, ItemSparse: 31 }), false);
    expect(items).toBeNull();
    expect(warnings).toEqual(["the item tables skip a different number of encrypted blocks than before (Item), so new and changed items are not listed"]);
  });
});

describe("the change entry's item section", () => {
  const site = (id: number) => ({ talents: [trimmed(id, [node(1, "Mutilate")])], raid: null, map: null, spellValues: null });
  const input = { product: "wowf", detectedAt: "2026-11-27T00:00:00.000Z", encryptedTables: [], source: { definitions: "abc123abc123", library: "test", extractedAt: "x" }, warnings: [] };
  const later = tables([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 7 }], [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 7 }]);

  it("records the new items, marked as spoilers in a build that is not live", () => {
    const e = ChangeEntry.parse(buildChangeEntry({ ...input, live: false, before: site(100), after: site(101), beforeItems: digests(100, base), afterItems: digests(101, later) }));
    expect(e.items).toEqual({ spoiler: true, comparedTo: 100, added: [7], removed: [], changed: [] });
    expect(hasChanges(e)).toBe(true);
    expect(prBody(e, { supersedes: [] })).toContain("### Items added (1)\n\n- [spoiler] item 7");
  });

  it("is null with a warning when no item digests are committed, and absent when the extraction gave none", () => {
    const e = buildChangeEntry({ ...input, live: true, before: site(100), after: site(101), afterItems: digests(101, later) });
    expect(e.items).toBeNull();
    expect(e.warnings).toContain("no committed item digests to compare with, so new and changed items are not listed");
    expect("items" in buildChangeEntry({ ...input, live: true, before: site(100), after: site(101) })).toBe(false);
  });

  it("still parses an entry written before the item section", () => {
    const e = buildChangeEntry({ ...input, live: true, before: site(100), after: site(101) });
    expect(ChangeEntry.safeParse(e).success).toBe(true);
  });
});
