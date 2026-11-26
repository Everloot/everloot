import { describe, expect, it } from "vitest";
import { buildChangeEntry, diffTalents } from "../src/build-watch/diff.js";
import { ChangeEntry } from "../src/build-watch/changes.js";
import { entityChanges, itemAddedIn } from "../src/build-watch/entity-changes.js";
import type { SiteData } from "../src/build-watch/site-data.js";
import { node, raid, spellValues, stamp, trimmed, worldMap } from "./build-watch-fixtures.js";

const classes = (nodes: ReturnType<typeof node>[]) => [trimmed(1, nodes)];

/** One build's entry from two site states, the way the build watch writes it. */
function entry(buildId: number, before: Partial<SiteData> & { talents: SiteData["talents"] }, after: Partial<SiteData> & { talents: SiteData["talents"] }, live = true): ChangeEntry {
  const site = (s: typeof before, id: number): SiteData => ({ raid: null, map: null, spellValues: null, ...s, talents: s.talents.map((c) => ({ ...c, build: stamp(id) })) }) as SiteData;
  return ChangeEntry.parse(buildChangeEntry({
    product: "wowf", live, detectedAt: `2026-11-${String(buildId % 28 + 1).padStart(2, "0")}T00:00:00.000Z`,
    before: site(before, buildId - 1), after: site(after, buildId),
    encryptedTables: [], source: { definitions: "abc123abc123", library: "test", extractedAt: "2026-11-01T00:00:00.000Z" }, warnings: [],
  }));
}

describe("diffTalents spell ids", () => {
  it("names the spells each changed talent node holds, before the change for a removed one", () => {
    const base = [node(1, "Mutilate"), node(2, "Evasion")];
    const d = diffTalents(classes(base), classes([{ ...base[0]!, maxRanks: 3 }]), false);
    expect(d.ranks).toMatchObject([{ nodeId: 1, spellIds: [101] }]);
    expect(d.removed).toMatchObject([{ nodeId: 2, spellIds: [102] }]);
  });
});

describe("entityChanges", () => {
  const base = [node(1, "Mutilate"), node(2, "Evasion")];
  const b1 = entry(200, { talents: classes(base), spellValues: spellValues(199, { 101: { basePoints: 5 } }) },
    { talents: classes(base), spellValues: spellValues(200, { 101: { basePoints: 8, textHash: "bbbbbbbbbbbb" } }) });
  const b2 = entry(201, { talents: classes(base) }, { talents: classes([{ ...base[0]!, maxRanks: 3 }, base[1]!]) });
  const beta = entry(202, { talents: classes(base), spellValues: spellValues(201, { 101: { basePoints: 8 } }) },
    { talents: classes(base), spellValues: spellValues(202, { 101: { basePoints: 99 } }) }, false);

  it("lists a spell's changes newest build first, values as numbers and the tooltip only as changed", () => {
    expect(entityChanges([b1, b2], { kind: "spell", id: 101 })).toEqual([
      { id: "wowf-201", build: "1.60.1.201", rows: [{ label: "Talent ranks", before: "1", after: "3" }] },
      { id: "wowf-200", build: "1.60.1.200", rows: [{ label: "Tooltip text changed", before: null, after: null }, { label: "Effect 1 base points", before: "5", after: "8" }] },
    ]);
  });

  it("returns nothing for a spell that never changed", () => {
    expect(entityChanges([b1, b2], { kind: "spell", id: 102 })).toEqual([]);
  });

  it("leaves out a build players cannot play yet and items marked as spoilers", () => {
    expect(entityChanges([beta], { kind: "spell", id: 101 })).toEqual([]);
    const marked = { ...b2, talents: { ...b2.talents!, ranks: b2.talents!.ranks.map((r) => ({ ...r, spoiler: true })) } };
    expect(entityChanges([marked], { kind: "spell", id: 101 })).toEqual([]);
  });

  it("reads committed entries without spell ids on talent nodes through the spell value rows only", () => {
    const old = { ...b2, talents: { ...b2.talents!, ranks: b2.talents!.ranks.map(({ spellIds: _drop, ...r }) => r) } };
    expect(entityChanges([old], { kind: "spell", id: 101 })).toEqual([]);
  });

  it("finds a spell swapped into or out of a talent node, and a raid buff gaining it", () => {
    const swapped = node(1, "Mutilate 2");
    swapped.entries[0]!.spellId = 999;
    const r = entry(203, { talents: classes(base), raid: raid("1.60.1.202", "party", [1]) }, { talents: classes([swapped, base[1]!]), raid: raid("1.60.1.203", "party", [1, 999]) });
    expect(entityChanges([r], { kind: "spell", id: 999 })[0]!.rows).toEqual([
      { label: "Talent spell", before: "spell 101", after: "spell 999" },
      { label: "Raid buff Battle Shout: added", before: null, after: null },
    ]);
  });

  it("lists a zone's map changes by its map id", () => {
    const z = entry(204, { talents: classes(base), map: worldMap(203, [{ id: 1411, name: "Durotar", left: 0 }]) },
      { talents: classes(base), map: worldMap(204, [{ id: 1411, name: "Durotar", left: 10 }, { id: 1412, name: "Mulgore" }]) });
    expect(entityChanges([z], { kind: "zone", id: 1412 })[0]!.rows).toEqual([{ label: "Zone added to the map", before: null, after: null }]);
    expect(entityChanges([z], { kind: "zone", id: 1411 })[0]!.rows).toMatchObject([{ label: "Map bounds" }]);
  });
});

describe("item changes", () => {
  const base = [node(1, "Mutilate")];
  /** An entry carrying an item section, as the build watch writes it from two item digest files. */
  const withItems = (buildId: number, items: NonNullable<ChangeEntry["items"]> | null, live = true): ChangeEntry =>
    ({ ...entry(buildId, { talents: classes(base) }, { talents: classes(base) }, live), items });
  const section = (buildId: number, over: Partial<NonNullable<ChangeEntry["items"]>> = {}) =>
    ({ spoiler: false, comparedTo: buildId - 1, added: [], removed: [], changed: [], ...over });

  it("gives the oldest build players can play that added the item", () => {
    const entries = [withItems(302, section(302, { added: [7] })), withItems(301, section(301, { added: [7] }))];
    expect(itemAddedIn(entries, 7)).toEqual({ id: "wowf-301", build: "1.60.1.301" });
  });

  it("gives nothing for an item no compared build added: it was there when the digests were first taken", () => {
    const entries = [withItems(300, null), withItems(301, section(301, { added: [8] })), entry(299, { talents: classes(base) }, { talents: classes(base) })];
    expect(itemAddedIn(entries, 7)).toBeNull();
  });

  it("never says so from a build players cannot play, or a section marked as a spoiler", () => {
    expect(itemAddedIn([withItems(301, section(301, { added: [7] }), false)], 7)).toBeNull();
    expect(itemAddedIn([withItems(301, section(301, { added: [7], spoiler: true }))], 7)).toBeNull();
    expect(entityChanges([withItems(301, section(301, { changed: [{ id: 7, fields: ["name"] }], spoiler: true }))], { kind: "item", id: 7 })).toEqual([]);
  });

  it("words the parts that changed, newest build first, and an item removed from the files", () => {
    const entries = [
      withItems(301, section(301, { changed: [{ id: 7, fields: ["sellPrice", "tooltip-added", "somethingNew"] }] })),
      withItems(302, section(302, { removed: [7], changed: [{ id: 9, fields: ["name"] }] })),
    ];
    expect(entityChanges(entries, { kind: "item", id: 7 })).toEqual([
      { id: "wowf-302", build: "1.60.1.302", rows: [{ label: "Removed from the game files", before: null, after: null }] },
      { id: "wowf-301", build: "1.60.1.301", rows: [
        { label: "Sell price changed", before: null, after: null },
        { label: "Tooltip added to the game files", before: null, after: null },
        { label: "somethingNew changed", before: null, after: null },
      ] },
    ]);
  });
});
