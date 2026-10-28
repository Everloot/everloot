import { describe, expect, test } from "vitest";
import { CLASSES } from "@/design/tokens";
import { CURRENT_BUILD, TABLES, type BuffTable } from "@/data/game-data/raid";
import { parseClassContext } from "./class-context";
import { coverage, decodeRaid, GROUP_SIZE, SIZES } from "./raid";
import {
  EMPTY_GROUP, GROUP_SIZES, absentClasses, addClass, classCounts, groupCoverage, groupHash, groupHref, groupSlots, parseGroup, partiesOf,
  raidHref, raidSizeFor, removeClass, reviewedRoles, withSize,
  type GroupCoverage, type GroupPlan,
} from "./class-group";

const table = TABLES[CURRENT_BUILD];
const read = (hash: string) => parseGroup(new URLSearchParams(hash));
const plan = (size: GroupPlan["size"], classes: GroupPlan["classes"]): GroupPlan => ({ size, classes });

/** A table of our own, so the coverage is tested without depending on the generated data. */
type Entry = BuffTable["entries"][number];
const entry = (id: string, family: string, cls: string, scope: Entry["scope"], tree: Entry["tree"] = "baseline"): Entry =>
  ({ id, label: id, family, class: cls, scope, tree, names: [id], spellIds: [1] });
const mini: BuffTable = {
  build: "1.0.1",
  label: "test",
  notFound: [],
  trees: { hunter: ["Beast Mastery", "Marksmanship", "Survival"], rogue: ["Assassination", "Combat", "Subtlety"] },
  families: [
    { id: "shout", label: "Shout", kind: "buff" },
    { id: "aura", label: "Aura", kind: "buff" },
    { id: "wild", label: "Wild", kind: "buff" },
    { id: "trueshot", label: "Trueshot", kind: "buff" },
    { id: "mystery", label: "Mystery", kind: "buff" },
    { id: "split", label: "Split", kind: "buff" },
    { id: "sunder", label: "Sunder", kind: "debuff" },
  ],
  entries: [
    entry("shout", "shout", "warrior", "raid"),
    entry("aura", "aura", "paladin", "party"),
    entry("wild", "wild", "druid", "single"),
    entry("trueshot", "trueshot", "hunter", "raid", 2),
    entry("mystery", "mystery", "warlock", "mixed"),
    entry("split", "split", "rogue", "raid", "unknown"),
    entry("sunder", "sunder", "warrior", "enemy"),
  ],
};

/** The coverage with family ids for names, to keep the expectations short. */
const ids = (c: GroupCoverage) => ({
  brought: c.brought.map((b) => [b.family.id, b.classes, b.cast]),
  nobody: c.nobody.map((n) => [n.classSlug, n.effects.map((e) => [e.family.id, e.talent])]),
  talent: c.talent.map((t) => [t.family.id, t.classSlug, t.tree]),
  party: c.party.map((p) => [p.family.id, p.parties]),
  unknown: c.unknown.map((u) => [u.family.id, u.classSlug, u.reason]),
});

describe("a group link", () => {
  test("carries the size and the classes in the order chosen, a class as often as it is in the group", () => {
    expect(read("size=10&classes=mage,mage,priest")).toEqual({ ok: true, plan: plan(10, ["mage", "mage", "priest"]) });
    expect(read("classes=warrior,priest")).toEqual({ ok: true, plan: plan(5, ["warrior", "priest"]) });
    expect(read("size=40")).toEqual({ ok: true, plan: plan(40, []) });
  });

  test("with neither, it is an empty group of five, and that group's link is the plain address", () => {
    expect(EMPTY_GROUP).toEqual(plan(5, []));
    expect(read("")).toEqual({ ok: true, plan: EMPTY_GROUP });
    expect(read("classes=")).toEqual({ ok: true, plan: EMPTY_GROUP });
    expect(groupHash(EMPTY_GROUP)).toBe("");
    expect(groupHref(EMPTY_GROUP)).toBe("/classes/group");
  });

  test("is read whole or refused whole, with the reason", () => {
    const refusals: [string, string][] = [
      ["classes=mage,deathknight", '"deathknight" is not one of the nine classes.'],
      ["classes=Mage", '"Mage" is not one of the nine classes.'],
      ["size=7&classes=mage", '"7" is not a group size: 5, 10, 20 or 40.'],
      ["size=05", '"05" is not a group size: 5, 10, 20 or 40.'],
      ["classes=mage,mage,mage,mage,mage,priest", "A group of 5 holds 5 classes; the link gives 6."],
      ["size=10&classes=" + Array(11).fill("rogue").join(","), "A group of 10 holds 10 classes; the link gives 11."],
      ["size=5&size=10", "The link gives size more than once."],
      ["classes=mage&classes=priest", "The link gives classes more than once."],
      ["classes=mage,,priest", "The link lists an empty class."],
      ["classes=mage,", "The link lists an empty class."],
      [`size=${"9".repeat(50)}`, `"${"9".repeat(40)}…" is not a group size: 5, 10, 20 or 40.`],
    ];
    for (const [hash, error] of refusals) expect(read(hash), hash).toEqual({ ok: false, error });
    // A class is refused as a hub link refuses it.
    expect(read("classes=deathknight")).toEqual(parseClassContext({ class: "deathknight" }));
  });

  test("ignores anything else a link carries, and the page's own links hold only the size and the classes", () => {
    const opened = read("size=5&classes=mage&name=Arthas&realm=Dreadmist&guild=Everloot");
    expect(opened).toEqual({ ok: true, plan: plan(5, ["mage"]) });
    expect(groupHash(plan(5, ["mage"]))).toBe("#size=5&classes=mage");
    expect(groupHref(plan(10, ["mage", "mage", "priest"]))).toBe("/classes/group#size=10&classes=mage,mage,priest");
    for (const p of [plan(5, []), plan(10, []), plan(20, ["druid"]), plan(40, [...CLASSES, ...CLASSES])]) {
      const hash = groupHash(p);
      expect(hash, hash).toMatch(/^(#size=(5|10|20|40)(&classes=[a-z]+(,[a-z]+)*)?)?$/);
      expect(read(hash.slice(1)), hash).toEqual({ ok: true, plan: p });
    }
  });
});

describe("planning a group", () => {
  test("a class takes the next open place, a full group takes no more, and removing one moves the rest up", () => {
    let p = EMPTY_GROUP;
    for (const c of ["warrior", "warrior", "priest", "mage", "rogue"] as const) p = addClass(p, c);
    expect(p).toEqual(plan(5, ["warrior", "warrior", "priest", "mage", "rogue"]));
    expect(addClass(p, "druid")).toBe(p);
    expect(removeClass(p, 1)).toEqual(plan(5, ["warrior", "priest", "mage", "rogue"]));
    expect(removeClass(p, 5)).toBe(p);
  });

  test("the sizes are a party of five and the raid builder's raids, and a size is taken only when it holds every class chosen", () => {
    expect(GROUP_SIZES).toEqual([5, 10, 20, 40]);
    expect(GROUP_SIZES).toEqual([GROUP_SIZE, ...SIZES]);
    const six = plan(10, ["mage", "mage", "mage", "mage", "mage", "priest"]);
    expect(withSize(six, 5)).toBe(six);
    expect(withSize(six, 20)).toEqual(plan(20, six.classes));
    expect(withSize(plan(10, ["mage"]), 5)).toEqual(plan(5, ["mage"]));
  });

  test("parties are five places each, filled in the order the classes were added, with the open places counted", () => {
    expect(partiesOf(plan(5, ["mage", "priest"]))).toEqual([{ classes: ["mage", "priest"], open: 3 }]);
    expect(partiesOf(plan(10, ["warrior", "warrior", "priest", "mage", "mage", "druid"]))).toEqual([
      { classes: ["warrior", "warrior", "priest", "mage", "mage"], open: 0 },
      { classes: ["druid"], open: 4 },
    ]);
    expect(partiesOf(plan(40, [])).map((p) => p.open)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(groupSlots(plan(5, ["mage"]))).toEqual([{ class: "mage", tree: 0 }, null, null, null, null]);
  });

  test("classes in the group more than once, and the classes not in it, are named in the game's class order", () => {
    const p = plan(10, ["mage", "priest", "mage", "warrior", "mage"]);
    expect(classCounts(p)).toEqual([{ classSlug: "warrior", count: 1 }, { classSlug: "priest", count: 1 }, { classSlug: "mage", count: 3 }]);
    expect(absentClasses(p)).toEqual(["paladin", "hunter", "rogue", "shaman", "warlock", "druid"]);
    expect(classCounts(EMPTY_GROUP)).toEqual([]);
    expect(absentClasses(EMPTY_GROUP)).toEqual([...CLASSES]);
    expect(absentClasses(plan(10, [...CLASSES]))).toEqual([]);
  });
});

describe("what a group brings", () => {
  test("an empty group brings nothing; each effect is listed under the classes that bring it, with the talent tree it needs", () => {
    expect(ids(groupCoverage(EMPTY_GROUP, mini))).toEqual({
      brought: [],
      nobody: [
        ["warrior", [["shout", null], ["sunder", null]]],
        ["paladin", [["aura", null]]],
        ["hunter", [["trueshot", { tree: "Marksmanship" }]]],
        ["rogue", [["split", { tree: null }]]],
        ["warlock", [["mystery", null]]],
        ["druid", [["wild", null]]],
      ],
      talent: [],
      party: [],
      unknown: [],
    });
  });

  test("what the classes bring is brought, and an effect cast on one player at a time says so", () => {
    const c = ids(groupCoverage(plan(5, ["warrior", "druid", "druid"]), mini));
    expect(c.brought).toEqual([["shout", ["warrior"], false], ["wild", ["druid"], true], ["sunder", ["warrior"], false]]);
    expect(c.nobody.map(([cls]) => cls)).toEqual(["paladin", "hunter", "rogue", "warlock"]);
  });

  test("an effect a member brings only with a talent names the tree and is not counted as brought", () => {
    const c = ids(groupCoverage(plan(5, ["hunter"]), mini));
    expect(c.talent).toEqual([["trueshot", "hunter", "Marksmanship"]]);
    expect(c.brought).toEqual([]);
    expect(c.nobody.map(([cls]) => cls)).not.toContain("hunter");
  });

  test("an effect whose reach or talent tree the files do not settle is unknown, not brought", () => {
    const c = ids(groupCoverage(plan(5, ["warlock", "rogue"]), mini));
    expect(c.unknown).toEqual([["mystery", "warlock", "reach"], ["split", "rogue", "tree"]]);
    expect(c.brought).toEqual([]);
  });

  test("a party effect reaches only the party its caster is in, so the parties without one are named", () => {
    const tenOf = ["paladin", "warrior", "warrior", "warrior", "warrior", "warrior"] as const;
    expect(ids(groupCoverage(plan(10, [...tenOf]), mini)).party).toEqual([["aura", [2]]]);
    expect(ids(groupCoverage(plan(20, ["paladin"]), mini)).party).toEqual([["aura", [2, 3, 4]]]);
    expect(ids(groupCoverage(plan(5, ["paladin"]), mini)).brought).toContainEqual(["aura", ["paladin"], false]);
  });

  test("every effect stands where the raid builder's coverage of the same places puts it, each in one place", () => {
    const plans = [
      EMPTY_GROUP,
      plan(5, ["mage", "priest"]),
      plan(10, ["paladin", "shaman", "hunter", "druid", "warlock", "paladin", "rogue"]),
      plan(40, [...CLASSES, ...CLASSES, ...CLASSES, "shaman", "paladin"]),
    ];
    for (const p of plans) {
      const builder = coverage(groupSlots(p), table);
      const families = [...builder.buffs, ...builder.debuffs];
      const of = (id: string) => families.find((f) => f.family.id === id)!;
      const ours = groupCoverage(p, table);
      for (const b of ours.brought) expect(["covered", "cast"], b.family.id).toContain(of(b.family.id).raid);
      for (const b of ours.brought) expect(b.cast, b.family.id).toBe(of(b.family.id).raid === "cast");
      for (const t of ours.talent) expect(of(t.family.id).raid, t.family.id).toBe("possible");
      for (const u of ours.unknown) expect(of(u.family.id).raid, u.family.id).toBe("unknown");
      for (const m of ours.party) expect(of(m.family.id).groups.flatMap((g, i) => (g === "missing" ? [i + 1] : [])), m.family.id).toEqual(m.parties);
      const nobody = ours.nobody.flatMap((n) => n.effects.map((e) => e.family.id));
      for (const id of nobody) expect(of(id).groups.every((g) => g === "missing"), id).toBe(true);
      const placed = [ours.brought, ours.talent, ours.unknown, ours.party].map((list) => list.map((x) => x.family.id));
      expect(new Set([...placed.flat(), ...nobody]), String(p.classes)).toEqual(new Set(families.map((f) => f.family.id)));
      for (const list of [...placed, [...new Set(nobody)]]) for (const other of placed) {
        if (list !== other) expect(list.filter((id) => other.includes(id)), String(p.classes)).toEqual([]);
      }
    }
  });

  test("with this build's rules: a Mage and a Priest bring Arcane Intellect, Winter's Chill needs Frost, and nobody brings what a Druid or Hunter does", () => {
    const c = groupCoverage(plan(5, ["mage", "priest"]), table);
    expect(c.brought.map((b) => b.family.label)).toEqual(expect.arrayContaining(["Arcane Intellect", "Power Word: Fortitude"]));
    expect(c.talent.map((t) => [t.family.label, t.classSlug, t.tree])).toEqual([["Winter's Chill", "mage", "Frost"]]);
    const druid = c.nobody.find((n) => n.classSlug === "druid")!.effects.map((e) => [e.family.label, e.talent]);
    expect(druid).toEqual(expect.arrayContaining([["Mark of the Wild", null], ["Moonkin Aura", { tree: "Balance" }], ["Leader of the Pack", { tree: "Feral Combat" }]]));
    expect(c.nobody.find((n) => n.classSlug === "hunter")!.effects.map((e) => [e.family.label, e.talent])).toEqual([["Trueshot Aura", { tree: "Marksmanship" }]]);
    expect(c.nobody.map((n) => n.classSlug)).toEqual(absentClasses(plan(5, ["mage", "priest"])));
  });
});

describe("into the raid builder", () => {
  test("a group opens there with the same classes in the same places, each on any tree, under this build's rules", () => {
    const p = plan(10, ["warrior", "priest", "priest", "mage", "rogue", "druid"]);
    const href = raidHref(p, table);
    expect(href.startsWith("/tools/raid#raid=ELR1-10-")).toBe(true);
    const decoded = decodeRaid(href.slice("/tools/raid#raid=".length));
    expect(decoded).toEqual({ ok: true, value: { size: 10, build: table.build, slots: groupSlots(p) } });
  });

  test("the raid builder plans 10, 20 or 40, so a group of five opens as the first group of a 10-player raid", () => {
    expect(GROUP_SIZES.map(raidSizeFor)).toEqual([10, 10, 20, 40]);
    const decoded = decodeRaid(raidHref(plan(5, ["mage", "priest"]), table).split("#raid=")[1]);
    expect(decoded.ok && decoded.value.size).toBe(10);
    expect(decoded.ok && decoded.value.slots).toEqual([{ class: "mage", tree: 0 }, { class: "priest", tree: 0 }, ...Array(8).fill(null)]);
    const full = plan(40, [...CLASSES, ...CLASSES, ...CLASSES, ...CLASSES, "mage", "mage", "mage", "mage"]);
    expect(decodeRaid(raidHref(full, table).split("#raid=")[1])).toEqual({ ok: true, value: { size: 40, build: table.build, slots: groupSlots(full) } });
  });
});

describe("roles", () => {
  test("a class's roles are the ones its reviewed guides are written for, and it has none without a guide", () => {
    expect(reviewedRoles([])).toEqual([]);
    expect(reviewedRoles([{ roles: ["damage"] }, { roles: ["damage", "tank"] }])).toEqual(["tank", "damage"]);
  });
});
