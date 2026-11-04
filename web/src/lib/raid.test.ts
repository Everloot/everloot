import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CURRENT_BUILD, TABLES, type BuffTable } from "@/data/game-data/raid";
import {
  applyDrop, coverage, decodeRaid, describeRaid, emptySlots, encodeRaid, findCode, groupsOf, placeClass, removeSlot, resize, roleOf, roster, SIZES, swapSlots, treeNames,
  type Slot, type Slots,
} from "./raid";

const table = TABLES[CURRENT_BUILD];
const slot = (c: Slot["class"], tree: Slot["tree"] = 0): Slot => ({ class: c, tree });

/** A table of our own, so the math is tested without depending on the generated data. */
type Entry = BuffTable["entries"][number];
const entry = (id: string, family: string, cls: string, scope: Entry["scope"], tree: Entry["tree"] = "baseline"): Entry =>
  ({ id, label: id, family, class: cls, scope, tree, names: [id], spellIds: [1] });
const mini: BuffTable = {
  build: "1.0.1",
  label: "test",
  notFound: [],
  trees: {},
  families: [
    { id: "shout", label: "Shout", kind: "buff" },
    { id: "aura", label: "Aura", kind: "buff" },
    { id: "wild", label: "Wild", kind: "buff" },
    { id: "mystery", label: "Mystery", kind: "buff" },
    { id: "armor", label: "Armor", kind: "debuff" },
    { id: "gated", label: "Gated", kind: "buff" },
  ],
  entries: [
    entry("shout", "shout", "warrior", "raid"),
    entry("aura", "aura", "paladin", "party"),
    entry("wild", "wild", "druid", "single"),
    entry("gwild", "wild", "druid", "unknown"),
    entry("mystery", "mystery", "warlock", "mixed"),
    entry("armor", "armor", "rogue", "enemy", 2),
    entry("gated", "gated", "hunter", "raid", "unknown"),
  ],
};

function raid(size: 10 | 20 | 40, placed: Record<number, Slot>): Slots {
  const slots = emptySlots(size);
  for (const [i, s] of Object.entries(placed)) slots[Number(i)] = s;
  return slots;
}

describe("coverage", () => {
  test("an empty raid is missing everything", () => {
    const c = coverage(emptySlots(10), mini);
    expect(c.buffs.every((b) => b.raid === "missing" && b.groups.every((g) => g === "missing"))).toBe(true);
    expect(c.summary.missing).toBe(5);
  });

  test("a raid-scope buff reaches every group from any one provider", () => {
    const shout = coverage(raid(20, { 17: slot("warrior") }), mini).buffs.find((b) => b.family.id === "shout")!;
    expect(shout.groups).toEqual(["covered", "covered", "covered", "covered"]);
    expect(shout.raid).toBe("covered");
  });

  test("a party-scope buff reaches only the group that holds the provider", () => {
    const aura = coverage(raid(20, { 0: slot("paladin"), 6: slot("paladin") }), mini).buffs.find((b) => b.family.id === "aura")!;
    expect(aura.groups).toEqual(["covered", "covered", "missing", "missing"]);
    expect(aura.raid).toBe("missing");
  });

  test("slot 5 and slot 6 are different groups", () => {
    const c = coverage(raid(10, { 4: slot("paladin") }), mini);
    expect(c.buffs.find((b) => b.family.id === "aura")!.groups).toEqual(["covered", "missing"]);
  });

  test("a buff cast on players one at a time is 'cast', not 'covered'", () => {
    const wild = coverage(raid(10, { 7: slot("druid") }), mini).buffs.find((b) => b.family.id === "wild")!;
    expect(wild.groups).toEqual(["cast", "cast"]);
  });

  test("a talent-gated effect needs the right tree; any tree is only possible", () => {
    const right = coverage(raid(10, { 0: slot("rogue", 2) }), mini);
    expect(right.debuffs[0].raid).toBe("covered");
    expect(coverage(raid(10, { 0: slot("rogue", 0) }), mini).debuffs[0].raid).toBe("possible");
    expect(coverage(raid(10, { 0: slot("rogue", 3) }), mini).debuffs[0].raid).toBe("missing");
    expect(coverage(raid(10, { 0: slot("mage", 2) }), mini).debuffs[0].raid).toBe("missing");
  });

  test("a baseline effect ignores the tree", () => {
    const a = coverage(raid(10, { 0: slot("warrior", 0) }), mini);
    const b = coverage(raid(10, { 0: slot("warrior", 3) }), mini);
    expect(a.buffs.find((x) => x.family.id === "shout")).toEqual(b.buffs.find((x) => x.family.id === "shout"));
  });

  test("an ambiguous tree reads unknown, whatever the slot's tree", () => {
    for (const tree of [0, 1, 3] as const) {
      expect(coverage(raid(10, { 0: slot("hunter", tree) }), mini).buffs.find((x) => x.family.id === "gated")!.raid).toBe("unknown");
    }
  });

  test("a family counts once and takes its best member", () => {
    const c = coverage(raid(10, { 0: slot("druid", 1) }), mini);
    expect(c.buffs.filter((b) => b.family.id === "wild")).toHaveLength(1);
    expect(c.buffs.find((b) => b.family.id === "wild")!.raid).toBe("cast");
  });

  test("unknown and mixed scope read as unknown when someone brings it, missing when nobody does", () => {
    expect(coverage(raid(10, { 1: slot("warlock") }), mini).buffs.find((b) => b.family.id === "mystery")!.raid).toBe("unknown");
    expect(coverage(raid(10, { 1: slot("mage") }), mini).buffs.find((b) => b.family.id === "mystery")!.raid).toBe("missing");
  });

  test("debuffs are raid-wide: every group shows the same state", () => {
    const c = coverage(raid(20, { 19: slot("rogue", 2) }), mini);
    expect(c.debuffs[0].groups).toEqual(["covered", "covered", "covered", "covered"]);
  });

  test("the summary counts buff families by raid state", () => {
    const c = coverage(raid(10, { 0: slot("warrior"), 1: slot("druid"), 2: slot("warlock") }), mini);
    expect(c.summary).toEqual({ covered: 1, cast: 1, possible: 0, unknown: 1, missing: 2 });
  });

  test("the generated table: Battle Shout reaches the raid, and Gift of the Wild (raid in the files) covers the Mark of the Wild family", () => {
    const c = coverage(raid(20, { 0: slot("warrior"), 5: slot("druid", 2) }), table);
    expect(c.buffs.find((b) => b.family.id === "battle-shout")!.groups).toEqual(["covered", "covered", "covered", "covered"]);
    expect(c.buffs.find((b) => b.family.id === "mark-of-the-wild")!.raid).toBe("covered");
  });

  test("tree gates come from the talent catalog and spell links, each with its proof", () => {
    const entry = (id: string) => table.entries.find((e) => e.id === id)!;
    const gate = (id: string) => [entry(id).tree, entry(id).treeProof];
    expect(gate("trueshot-aura")).toEqual([2, "talent spell"]);
    expect(gate("moonkin-aura")).toEqual([1, "spell chain"]);
    expect(gate("winters-chill")).toEqual([3, "spell chain"]);
    expect(gate("leader-of-the-pack")).toEqual([2, "talent name"]);
    expect(table.entries.filter((e) => e.tree !== "baseline").map((e) => e.id).sort()).toEqual(
      ["leader-of-the-pack", "moonkin-aura", "trueshot-aura", "winters-chill"],
    );
    expect(entry("blessing-of-kings").tree).toBe("baseline");
    expect(entry("battle-shout").tree).toBe("baseline");
    const hunter = (tree: Slot["tree"]) => coverage(raid(10, { 0: slot("hunter", tree) }), table).buffs.find((b) => b.family.id === "trueshot-aura")!.raid;
    expect([hunter(2), hunter(0), hunter(1)]).toEqual(["covered", "possible", "missing"]);
    expect(treeNames(table, "hunter")[1]).toBe("Marksmanship");
  });

  test("Greater Blessings stay unknown, and Salvation and Sanctuary are absent", () => {
    const paladin = coverage(raid(10, { 0: slot("paladin") }), table);
    // Build 70755 no longer has Salvation in the files.
    expect(paladin.buffs.find((b) => b.family.id === "blessing-of-salvation")).toBeUndefined();
    expect(table.entries.filter((e) => e.id.startsWith("greater-")).every((e) => e.scope === "unknown")).toBe(true);
    for (const id of ["blessing-of-salvation", "blessing-of-sanctuary"]) {
      expect(table.entries.some((e) => e.id === id)).toBe(false);
      expect(table.notFound).toContain(id);
    }
  });
});

describe("the generated table", () => {
  test("is stamped with the build, has unique ids, and a family for every entry", () => {
    expect(table.build).toBe(CURRENT_BUILD);
    expect(new Set(table.entries.map((e) => e.id)).size).toBe(table.entries.length);
    const families = new Set(table.families.map((f) => f.id));
    for (const e of table.entries) {
      expect(families.has(e.family), e.id).toBe(true);
      expect(e.spellIds.length, e.id).toBeGreaterThan(0);
      expect(e.names.length, e.id).toBeGreaterThan(0);
    }
    for (const f of table.families) expect(table.entries.some((e) => e.id === f.id), f.id).toBe(true);
  });

  test("a tree gate has a proof, and baseline has none", () => {
    for (const e of table.entries) expect(e.treeProof !== undefined, e.id).toBe(e.tree !== "baseline");
  });

  test("every tree gate is a tree number the class has", () => {
    for (const e of table.entries) {
      if (typeof e.tree === "number") expect(e.tree, e.id).toBeLessThanOrEqual(table.trees[e.class].length);
    }
  });

  test("keeps the per-rank scope only where ranks disagree, and holds no tooltip text", () => {
    for (const e of table.entries) expect(e.byRank !== undefined, e.id).toBe(e.scope === "mixed");
    expect(JSON.stringify(table)).not.toMatch(/description|tooltip/i);
  });

  test("has nine classes with three tree names each, from the game", () => {
    expect(Object.keys(table.trees)).toHaveLength(9);
    for (const names of Object.values(table.trees)) expect(names).toHaveLength(3);
    expect(treeNames(table, "druid")).toEqual(["Balance", "Feral Combat", "Restoration"]);
  });

  test("the addon's data file lists the same buffs, scopes, aura names and spell ids", () => {
    const lua = readFileSync(new URL("../../../addon/modules/raid_data.lua", import.meta.url), "utf8");
    expect(lua).toContain(`build = "${table.build}"`);
    const row = /^\s*\{ family = "([^"]+)", id = "([^"]+)", scope = "([^"]+)", names = \{([^}]*)\}, spellIds = \{([^}]*)\} \},$/gm;
    const rows = [...lua.matchAll(row)];
    const buffs = table.entries.filter((e) => table.families.find((f) => f.id === e.family)!.kind === "buff");
    const quoted = /"([^"]*)"/g;
    expect(rows.map((r) => [r[2], r[1], r[3], [...r[4].matchAll(quoted)].map((n) => n[1]), r[5].split(", ").map(Number)])).toEqual(
      buffs.map((e) => [e.id, e.family, e.scope, e.names, e.spellIds]),
    );
  });
});

describe("share code", () => {
  test("round trips every size, class and tree", () => {
    const classes = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"] as const;
    for (const size of SIZES) {
      const slots = emptySlots(size).map((_, i) => (i % 7 === 6 ? null : slot(classes[i % 9], (i % 4) as Slot["tree"])));
      const decoded = decodeRaid(encodeRaid({ size, build: CURRENT_BUILD, slots }));
      expect(decoded).toEqual({ ok: true, value: { size, build: CURRENT_BUILD, slots } });
    }
  });

  test("an empty raid is a short code and trailing empty slots are left out", () => {
    expect(encodeRaid({ size: 40, build: "1.60.1.70450", slots: emptySlots(40) })).toBe("ELR1-40-1.60.1.70450-");
    const code = encodeRaid({ size: 10, build: "1.60.1.70450", slots: raid(10, { 0: slot("mage", 3) }) });
    expect(code).toBe("ELR1-10-1.60.1.70450-NzM");
    expect(decodeRaid(code)).toMatchObject({ ok: true });
  });

  test("the payload is base64url of class and tree digits", () => {
    // Mage tree 3 is "73", slot 2 is empty ("00"), slot 3 is a warrior with any tree ("10").
    expect(encodeRaid({ size: 10, build: "1.60.1.70450", slots: raid(10, { 0: slot("mage", 3), 2: slot("warrior", 0) }) })).toBe(
      "ELR1-10-1.60.1.70450-NzMwMDEw",
    );
  });

  test("reads a code the addon wrote (addon/tests/raid_contract.py)", () => {
    const r = decodeRaid("ELR1-10-1.60.1.70450-MTA5MDcwMDAwMDYwNTAyMDMw");
    expect(r.ok && r.value.slots.map((s) => s && s.class)).toEqual([
      "warrior", "druid", "mage", null, null, "shaman", "priest", "paladin", "hunter", null,
    ]);
  });

  test("findCode pulls a code out of a link", () => {
    expect(findCode("https://everloot.app/tools/raid#raid=ELR1-10-1.60.1.70450-NzM")).toBe("ELR1-10-1.60.1.70450-NzM");
  });

  test("padding on the end is ignored; surrounding spaces too", () => {
    expect(decodeRaid(" ELR1-10-1.60.1.70450-NzM= ")).toMatchObject({ ok: true });
  });

  test("a code for a later version is refused with a clear message", () => {
    const r = decodeRaid("ELR2-10-1.60.1.70450-NzM");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/version 2/);
  });

  test("the talent code is not a raid code", () => {
    expect(decodeRaid("EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg").ok).toBe(false);
  });

  test.each([
    ["a size that is not offered", "ELR1-15-1.60.1.70450-NzM"],
    ["a damaged build", "ELR1-10-1..70450-NzM"],
    ["a build with one group", "ELR1-10-70450-NzM"],
    ["characters outside the alphabet", "ELR1-10-1.60.1.70450-Nz!"],
    ["an odd number of digits", "ELR1-10-1.60.1.70450-Nw"],
    ["a class that does not exist", "ELR1-10-1.60.1.70450-MDE"],
    ["a tree that does not exist", "ELR1-10-1.60.1.70450-NzQ"],
    ["more slots than the size", "ELR1-10-1.60.1.70450-" + btoa("7".repeat(22)).replace(/=+$/, "")],
    ["no code at all", ""],
  ])("refuses %s", (_name, code) => {
    expect(decodeRaid(code).ok).toBe(false);
  });
});

describe("layout helpers", () => {
  test("groups are five slots and resizing keeps the first slots", () => {
    const slots = raid(20, { 0: slot("mage"), 19: slot("druid") });
    expect(groupsOf(slots)).toHaveLength(4);
    expect(groupsOf(slots)[3]).toHaveLength(5);
    const small = resize(slots, 10);
    expect(small).toHaveLength(10);
    expect(small[0]).toEqual(slot("mage"));
    expect(resize(small, 40)).toHaveLength(40);
  });
});

describe("swapSlots", () => {
  test("swaps two members", () => {
    const s: Slots = [slot("mage", 1), slot("priest", 2), null];
    expect(swapSlots(s, 0, 1)).toEqual([slot("priest", 2), slot("mage", 1), null]);
  });
  test("moves a member into an empty slot, across groups, without touching the input", () => {
    const s = emptySlots(10);
    s[0] = slot("rogue", 3);
    const next = swapSlots(s, 0, 7);
    expect(next[0]).toBeNull();
    expect(next[7]).toEqual(slot("rogue", 3));
    expect(s[0]).toEqual(slot("rogue", 3));
  });
  test("returns the same array when nothing changes", () => {
    const s: Slots = [slot("mage"), null, null];
    expect(swapSlots(s, 0, 0)).toBe(s);
    expect(swapSlots(s, 1, 2)).toBe(s);
    expect(swapSlots(s, 0, 3)).toBe(s);
    expect(swapSlots(s, -1, 0)).toBe(s);
  });
  test("a moved raid still round-trips through the share code", () => {
    const s = emptySlots(20);
    s[0] = slot("warrior", 3);
    const moved = swapSlots(s, 0, 12);
    const back = decodeRaid(encodeRaid({ size: 20, build: "1.0.1", slots: moved }));
    expect(back).toMatchObject({ ok: true, value: { slots: moved } });
  });
});

describe("drag and drop", () => {
  test("a class dropped on an empty slot fills it on any tree", () => {
    const s = emptySlots(10);
    const next = applyDrop(s, { kind: "class", class: "mage" }, { kind: "slot", index: 6 });
    expect(next[6]).toEqual(slot("mage", 0));
    expect(s[6]).toBeNull();
  });
  test("a class dropped on a filled slot replaces it; the same class keeps its tree", () => {
    const s: Slots = [slot("priest", 1), slot("warrior", 3), null];
    expect(applyDrop(s, { kind: "class", class: "druid" }, { kind: "slot", index: 0 })).toEqual([slot("druid", 0), slot("warrior", 3), null]);
    expect(applyDrop(s, { kind: "class", class: "warrior" }, { kind: "slot", index: 1 })).toBe(s);
    expect(placeClass(s, 1, "warrior")).toBe(s);
  });
  test("a member dropped on an empty slot moves, on a filled one swaps", () => {
    const s: Slots = [slot("rogue", 2), null, slot("shaman", 3)];
    expect(applyDrop(s, { kind: "slot", index: 0 }, { kind: "slot", index: 1 })).toEqual([null, slot("rogue", 2), slot("shaman", 3)]);
    expect(applyDrop(s, { kind: "slot", index: 0 }, { kind: "slot", index: 2 })).toEqual([slot("shaman", 3), null, slot("rogue", 2)]);
  });
  test("a member dropped on the trash leaves the raid", () => {
    const s: Slots = [slot("rogue", 2), slot("mage", 1)];
    expect(applyDrop(s, { kind: "slot", index: 1 }, { kind: "trash" })).toEqual([slot("rogue", 2), null]);
    expect(removeSlot(s, 0)).toEqual([null, slot("mage", 1)]);
  });
  test("drops that change nothing return the same array", () => {
    const s: Slots = [slot("mage"), null];
    expect(applyDrop(s, { kind: "class", class: "mage" }, { kind: "trash" })).toBe(s);
    expect(applyDrop(s, { kind: "slot", index: 1 }, { kind: "trash" })).toBe(s);
    expect(applyDrop(s, { kind: "slot", index: 0 }, { kind: "slot", index: 0 })).toBe(s);
    expect(applyDrop(s, { kind: "class", class: "druid" }, { kind: "slot", index: 5 })).toBe(s);
    expect(removeSlot(s, -1)).toBe(s);
  });
  test("a raid built by drops round-trips through the share code", () => {
    let s = emptySlots(40);
    s = applyDrop(s, { kind: "class", class: "warrior" }, { kind: "slot", index: 0 });
    s = applyDrop(s, { kind: "class", class: "priest" }, { kind: "slot", index: 39 });
    s = applyDrop(s, { kind: "slot", index: 0 }, { kind: "slot", index: 21 });
    const back = decodeRaid(encodeRaid({ size: 40, build: "1.0.1", slots: s }));
    expect(back).toMatchObject({ ok: true, value: { slots: s } });
    expect(s[21]).toEqual(slot("warrior"));
  });
});

describe("roles", () => {
  test("reads the role from class and tree", () => {
    expect(roleOf(slot("warrior", 3))).toBe("tank");
    expect(roleOf(slot("warrior", 2))).toBe("damage");
    expect(roleOf(slot("paladin", 1))).toBe("healer");
    expect(roleOf(slot("paladin", 2))).toBe("tank");
    expect(roleOf(slot("priest", 3))).toBe("damage");
    expect(roleOf(slot("shaman", 3))).toBe("healer");
    expect(roleOf(slot("druid", 3))).toBe("healer");
    expect(roleOf(slot("druid", 1))).toBe("damage");
  });
  test("feral is unknown, since it can tank or deal damage", () => {
    expect(roleOf(slot("druid", 2))).toBe("unknown");
  });
  test("any tree is unknown, except for classes with one role", () => {
    expect(roleOf(slot("priest", 0))).toBe("unknown");
    expect(roleOf(slot("warrior", 0))).toBe("unknown");
    expect(roleOf(slot("mage", 0))).toBe("damage");
    expect(roleOf(slot("hunter", 2))).toBe("damage");
  });
  test("roster counts classes and roles", () => {
    const r = roster([slot("warrior", 3), slot("priest", 2), slot("priest", 0), slot("mage"), null]);
    expect(r.filled).toBe(4);
    expect(r.classes.priest).toBe(2);
    expect(r.classes.druid).toBe(0);
    expect(r.roles).toEqual({ tank: 1, healer: 1, damage: 1, unknown: 1 });
  });
});

test("a raid is described by its size and roles, for page titles and link previews", () => {
  const slots = emptySlots(10);
  slots[0] = { class: "warrior", tree: 3 };
  slots[1] = { class: "priest", tree: 2 };
  slots[2] = { class: "mage", tree: 0 };
  slots[3] = { class: "druid", tree: 2 };
  expect(describeRaid(10, slots)).toEqual({ title: "10-player raid", roles: "1 tank, 1 healer, 1 damage, 1 not known", filled: 4 });
  expect(describeRaid(20, emptySlots(20)).roles).toBe("0 tanks, 0 healers, 0 damage");
});
