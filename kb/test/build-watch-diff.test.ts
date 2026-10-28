import { describe, expect, it } from "vitest";
import { buildChangeEntry, diffMap, diffRaid, diffSpellValues, diffTalents } from "../src/build-watch/diff.js";
import { ChangeEntry, hasChanges } from "../src/build-watch/changes.js";
import type { SiteData } from "../src/build-watch/site-data.js";
import { prBody, terminalSummary } from "../src/build-watch/render.js";
import { clientDigestsOf, type DigestInput } from "../src/build-watch/client-digests.js";
import { CONFIG_A, node, raid, spellValues, stamp, trimmed, worldMap } from "./build-watch-fixtures.js";

const classes = (nodes: ReturnType<typeof node>[], over = {}) => [trimmed(1, nodes, over)];

describe("diffTalents", () => {
  const base = [node(1, "Mutilate"), node(2, "Evasion"), node(3, "Vigor")];

  it("reports nothing for identical catalogs", () => {
    expect(Object.values(diffTalents(classes(base), classes(base), false)).flat()).toEqual([]);
  });

  it("finds added and removed talents", () => {
    const d = diffTalents(classes(base), classes([base[0], base[1], node(4, "Riposte", { maxRanks: 3, kind: "tiered" })]), false);
    expect(d.added.map((a) => [a.name, a.kind, a.maxRanks])).toEqual([["Riposte", "tiered", 3]]);
    expect(d.removed.map((r) => r.name)).toEqual(["Vigor"]);
  });

  it("finds moved talents", () => {
    const moved = [{ ...base[0], x: 5000, row: 2, col: 3 }, base[1], base[2]];
    const d = diffTalents(classes(base), classes(moved), false);
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0]).toMatchObject({ name: "Mutilate", from: { x: 1001, row: 0 }, to: { x: 5000, row: 2, col: 3 } });
  });

  it("does not call a talent moved when only its derived row and column shifted", () => {
    const shifted = [{ ...base[0], row: 4, col: 4 }, base[1], base[2]];
    expect(diffTalents(classes(base), classes(shifted), false).moved).toEqual([]);
  });

  it("finds rank, gate and prerequisite changes", () => {
    const next = [
      { ...base[0], maxRanks: 2 },
      { ...base[1], unlock: { spentRequired: { amount: 5, scope: "class" as const, gateGroupId: 1, currencyId: 2, traitTreeId: 3 } } },
      { ...base[2], prereqs: [{ nodeId: 1, rule: "all" as const }] },
    ];
    const d = diffTalents(classes(base), classes(next), false);
    expect(d.ranks).toMatchObject([{ name: "Mutilate", before: 1, after: 2 }]);
    expect(d.gates).toMatchObject([{ name: "Evasion", before: {}, after: { spentRequired: { amount: 5, scope: "class" } } }]);
    expect(d.prereqs).toMatchObject([{ name: "Vigor", before: [], after: [{ nodeId: 1, rule: "all" }] }]);
  });

  it("ignores the order prerequisites are listed in", () => {
    const a = [{ ...base[0], prereqs: [{ nodeId: 2, rule: "any" as const }, { nodeId: 3, rule: "any" as const }] }];
    const b = [{ ...base[0], prereqs: [{ nodeId: 3, rule: "any" as const }, { nodeId: 2, rule: "any" as const }] }];
    expect(diffTalents(classes(a), classes(b), false).prereqs).toEqual([]);
  });

  it("reports a talent swapped for another spell", () => {
    const swapped = node(1, "Mutilate 2");
    swapped.entries[0].spellId = 999;
    const d = diffTalents(classes(base), classes([swapped, base[1], base[2]]), false);
    expect(d.replaced).toMatchObject([{ nodeId: 1, before: [101], after: [999] }]);
  });

  it("reports classes and talent point levels", () => {
    const other = trimmed(2, [node(9, "Bash")], { classId: 11, className: "Druid" });
    const d = diffTalents(classes(base), [...classes(base, { pointLevels: [10, 11] }), other], false);
    expect(d.classesAdded).toEqual([{ classId: 11, className: "Druid", spoiler: false }]);
    expect(d.pointLevels).toMatchObject([{ className: "Rogue", before: [10, 11, 12], after: [10, 11] }]);
    expect(diffTalents([...classes(base), other], classes(base), false).classesRemoved.map((c) => c.className)).toEqual(["Druid"]);
    expect(diffTalents(classes(base), [...classes(base), other], true).classesAdded[0].spoiler).toBe(true);
  });

  it("flags every item as a spoiler for a build that is not live", () => {
    const next = [{ ...base[0], maxRanks: 3 }, node(4, "New")];
    const d = diffTalents(classes(base), classes(next), true);
    expect([...d.added, ...d.ranks, ...d.removed].every((i) => i.spoiler)).toBe(true);
    expect(diffTalents(classes(base), classes(next), false).added[0].spoiler).toBe(false);
  });
});

describe("diffSpellValues", () => {
  const talents = classes([node(1, "Mutilate"), node(2, "Evasion")]);

  it("reports changed numbers and tooltip hashes, placed at the talent", () => {
    const before = spellValues(1, { 101: {}, 102: {} });
    const after = spellValues(2, { 101: { basePoints: 8, durationMs: 6000 }, 102: { textHash: "bbbbbbbbbbbb" } });
    const d = diffSpellValues(before, after, talents, true);
    const byName = Object.fromEntries(d.map((s) => [s.name, s]));
    expect(byName.Mutilate.changes).toEqual([
      { field: "durationMs", before: null, after: 6000 },
      { field: "effect 1 basePoints", before: 5, after: 8 },
    ]);
    expect(byName.Mutilate).toMatchObject({ spellId: 101, spoiler: true, className: "Rogue", tree: "Assassination" });
    expect(byName.Evasion.changes).toEqual([{ field: "text", before: "aaaaaaaaaaaa", after: "bbbbbbbbbbbb" }]);
  });

  it("leaves unchanged spells and spells on one side only out", () => {
    const d = diffSpellValues(spellValues(1, { 101: {}, 555: {} }), spellValues(2, { 101: {}, 102: {} }), talents, false);
    expect(d).toEqual([]);
  });
});

describe("diffRaid", () => {
  it("reports scope, spell id and tree changes", () => {
    const before = raid("1.60.1.1", "party", [1, 2]);
    const after = raid("1.60.1.2", "raid", [2, 3]);
    after.entries[0].tree = 2;
    const d = diffRaid(before, after, true);
    expect(d.scopeChanges).toMatchObject([{ id: "battle-shout", before: "party", after: "raid", spoiler: true }]);
    expect(d.spellChanges.map((c) => `${c.spellId} ${c.change}`)).toEqual(["3 added", "1 removed", "null talent tree baseline -> 2"]);
  });

  it("reports a rank-level change while the overall scope stays mixed", () => {
    const before = raid("1", "mixed");
    before.entries[0].byRank = [{ rank: 1, spellIds: [1], scope: "party" }, { rank: 2, spellIds: [2], scope: "raid" }];
    const after = raid("2", "mixed");
    after.entries[0].byRank = [{ rank: 1, spellIds: [1], scope: "raid" }, { rank: 2, spellIds: [2], scope: "party" }];
    expect(diffRaid(before, after, false).scopeChanges).toMatchObject([{ before: "mixed", after: "mixed", beforeRanks: "1:party 2:raid", afterRanks: "1:raid 2:party" }]);
  });

  it("is quiet when nothing differs", () => {
    expect(diffRaid(raid("1"), raid("2"), false)).toEqual({ scopeChanges: [], spellChanges: [] });
  });
});

describe("diffMap", () => {
  it("reports zones and entrances that appeared, vanished or moved", () => {
    const before = worldMap(1, [{ id: 1411, name: "Durotar" }, { id: 1412, name: "Mulgore" }]);
    const after = worldMap(2, [{ id: 1411, name: "Durotar", left: 99 }, { id: 1413, name: "Barrens" }]);
    after.entrances[0].worldX = 0;
    const d = diffMap(before, after, true);
    expect(d.map((c) => `${c.kind} ${c.id} ${c.change.split(" ")[0]}`)).toEqual(["zone 1411 bounds", "zone 1413 added", "zone 1412 removed", "entrance 33 position"]);
    expect(d.every((c) => c.spoiler)).toBe(true);
  });
});

describe("buildChangeEntry", () => {
  const site = (buildId: number, nodes: ReturnType<typeof node>[], raidScope = "party", config = CONFIG_A): SiteData => ({
    talents: [trimmed(buildId, nodes, {}, config)], raid: raid(`1.60.1.${buildId}`, raidScope), map: worldMap(buildId), spellValues: spellValues(buildId, { 101: {} }, config),
  });
  const input = (over = {}) => ({
    product: "wow_classic_beta", live: false, detectedAt: "2026-10-17T10:00:00.000Z",
    before: site(1, [node(1, "Mutilate"), node(2, "Evasion")]), after: site(2, [node(1, "Mutilate")], "raid"),
    encryptedTables: [{ table: "Spell", blocks: 29 }, { table: "SpellName", blocks: 14 }, { table: "Item", blocks: 0 }],
    source: { definitions: "abc123abc123", library: "lib@1", extractedAt: "2026-10-17T10:00:00.000Z" }, warnings: [], ...over,
  });

  it("builds a valid entry with talent, raid and map sections", () => {
    const entry = buildChangeEntry(input());
    expect(() => ChangeEntry.parse(entry)).not.toThrow();
    expect(entry).toMatchObject({ id: "wow_classic_beta-2", initial: false, spoiler: true, previous: { buildId: 1 }, catalog: { classes: 1, nodes: 1 } });
    expect(entry.talents!.removed.map((r) => r.name)).toEqual(["Evasion"]);
    expect(entry.raidBuffs).toMatchObject({ comparedTo: "1.60.1.1", scopeChanges: [{ id: "battle-shout", before: "party", after: "raid", spoiler: true }] });
    expect(entry.mapChanges).toEqual([]);
    expect(entry.encryptedBlocks).toEqual({ total: 43, tables: [{ table: "Spell", blocks: 29 }, { table: "SpellName", blocks: 14 }] });
    expect(hasChanges(entry)).toBe(true);
  });

  it("records a baseline when nothing is committed yet", () => {
    const entry = buildChangeEntry(input({ before: null }));
    expect(entry).toMatchObject({ initial: true, previous: null, talents: null, mapChanges: null, raidBuffs: { comparedTo: null, scopeChanges: [] } });
    expect(hasChanges(entry)).toBe(false);
  });

  it("is not a spoiler when the product is live", () => {
    const entry = buildChangeEntry(input({ live: true }));
    expect(entry.spoiler).toBe(false);
    expect(entry.raidBuffs!.scopeChanges[0].spoiler).toBe(false);
  });

  it("warns when the table definitions changed between the two builds", () => {
    const after = site(2, [node(1, "Mutilate")]);
    after.talents[0].build.definitions = "ffffffffffff";
    expect(buildChangeEntry(input({ after })).warnings.join(" ")).toContain("definitions differ");
  });

  it("says so when there are no committed spell values to compare with", () => {
    const before = site(1, [node(1, "Mutilate")]);
    before.spellValues = null;
    expect(buildChangeEntry(input({ before })).warnings.join(" ")).toContain("no committed spell values");
  });

  it("lists spell number changes", () => {
    const before = site(1, [node(1, "Mutilate")]);
    const after = site(2, [node(1, "Mutilate")]);
    after.spellValues = spellValues(2, { 101: { basePoints: 9 } });
    expect(buildChangeEntry(input({ before, after })).talents!.spellValues).toMatchObject([{ spellId: 101, changes: [{ field: "effect 1 basePoints", before: 5, after: 9 }] }]);
  });
});

describe("rendering", () => {
  const site = (buildId: number, nodes: ReturnType<typeof node>[], extra: Partial<SiteData> = {}): SiteData => ({
    talents: [trimmed(buildId, nodes)], raid: raid(`1.60.1.${buildId}`, buildId === 1 ? "party" : "raid"), map: worldMap(buildId), spellValues: spellValues(buildId, {}), ...extra,
  });
  const make = (next: ReturnType<typeof node>[], extra: Partial<SiteData> = {}) => buildChangeEntry({
    product: "wow_classic_beta", live: false, detectedAt: "2026-10-17T10:00:00.000Z",
    before: site(1, [node(1, "Mutilate")]), after: site(2, next, extra),
    encryptedTables: [{ table: "Spell", blocks: 29 }], source: { definitions: null, library: "lib@1", extractedAt: "2026-10-17T10:00:00.000Z" }, warnings: [],
  });

  it("puts the build, spoiler notice, encrypted blocks and each change in the body", () => {
    const entry = make([{ ...node(1, "Mutilate"), maxRanks: 4 }, node(5, "Shadowstep")]);
    const body = prBody(entry, { supersedes: [31] });
    expect(body).toContain("build=2");
    expect(body).toContain("**Spoiler.**");
    expect(body).toContain("Catalog: 1 classes, 2 talent nodes");
    expect(body).toContain("Encrypted blocks skipped, never decrypted: 29 (Spell 29)");
    expect(body).toContain("[spoiler] Rogue / Assassination: Shadowstep (single, 1 rank)");
    expect(body).toContain("Mutilate: 1 -> 4 ranks");
    expect(body).toContain("Battle Shout: party -> raid");
    expect(body).toContain("#31");
    expect(body).toContain("blue tracker");
    expect(body).toContain("asset URL setting points at it");
  });

  it("lists map changes and added classes as spoilers", () => {
    const entry = make([node(1, "Mutilate")], { map: worldMap(2, [{ id: 1411, name: "Durotar" }, { id: 1500, name: "New Zone" }]) });
    expect(prBody(entry, { supersedes: [] })).toContain("[spoiler] zone New Zone (1500): added");
    const more = make([node(1, "Mutilate")], { talents: [trimmed(2, [node(1, "Mutilate")]), trimmed(2, [node(9, "Bash")], { classId: 11, className: "Druid" })] });
    expect(prBody(more, { supersedes: [] })).toContain("- [spoiler] Druid");
  });

  it("cannot be turned into a mention, link or html by a spell name", () => {
    const body = prBody(make([node(1, "Mutilate"), node(7, "@everyone <img src=x> [a](http://b)")]), { supersedes: [] });
    expect(body).not.toMatch(/@everyone|<img|\[a\]/);
  });

  it("caps long lists and stays under GitHub's body limit", () => {
    const many = Array.from({ length: 3000 }, (_, i) => node(100 + i, `Talent number ${i} with a fairly long name to use up room`));
    const body = prBody(make([node(1, "Mutilate"), ...many]), { supersedes: [] });
    expect(body).toContain("and 2960 more in the JSON entry");
    expect(body.length).toBeLessThan(65_000);
  });

  it("says plainly when nothing changed", () => {
    const entry = make([node(1, "Mutilate")]);
    entry.raidBuffs!.scopeChanges = [];
    expect(prBody(entry, { supersedes: [] })).toContain("No differences");
  });

  it("gives a terminal summary with counts", () => {
    const text = terminalSummary(make([node(1, "Mutilate"), node(5, "Shadowstep")]));
    expect(text).toContain("wow_classic_beta 1.60.1.2");
    expect(text).toContain("Talents added: 1");
    expect(text).toContain("encrypted blocks skipped: 29");
  });

  it("lists client table changes and their counts", () => {
    const tables = (rows: [number, Record<string, unknown>][], definitions = "abc123abc123"): DigestInput[] => [
      { table: "ItemSparse", rows: new Map(rows) },
    ];
    const entry = buildChangeEntry({
      product: "wow_classic_beta", live: false, detectedAt: "2026-10-17T10:00:00.000Z",
      before: site(1, [node(1, "Mutilate")]), after: site(2, [node(1, "Mutilate")]),
      beforeDigests: clientDigestsOf(stamp(1), tables([[1, { Name_lang: "A" }]])),
      afterDigests: clientDigestsOf({ ...stamp(2), definitions: "def456def456" }, tables([[1, { Name_lang: "A" }], [2, { Name_lang: "B" }], [3, { Name_lang: "C" }]])),
      encryptedTables: [], source: { definitions: null, library: "lib@1", extractedAt: "x" }, warnings: [],
    });
    const body = prBody(entry, { supersedes: [] });
    expect(body).toContain("### Client data (2)");
    expect(body).toContain("table definitions changed: every table may read as changed");
    expect(body).toContain("ItemSparse: 1 -> 3 rows, content changed");
    expect(body).toContain("- Client tables: 1 read (1 before), 3 rows (1 before), 1 changed");
    expect(terminalSummary(entry)).toContain("Client data: 2");
  });
});
