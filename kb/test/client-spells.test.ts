import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientSpells, ClientSpells, serializeClientSpells, writeClientSpells } from "../src/client-spells.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-26T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

// Fireball (133, rank 1) and its rank 2 (143), Heroic Strike (78, rage), a passive talent (6057), a channeled spell
// (5143), a mount spell (458), a pet summon (4055), an item Use spell (1000), a set bonus (2000) and a spell nothing
// links (9999).
const tables: Record<string, Rows> = {
  SpellName: [133, 143, 78, 6057, 5143, 458, 4055, 1000, 2000, 9999].map((id) => [id, { ID: id, Name_lang: `Spell ${id} name` }]),
  Spell: [[133, { ID: 133, NameSubtext_lang: "Rank 1", Description_lang: "Hurls a fiery ball that causes $s1 Fire damage." }]],
  SpellMisc: [
    [1, { SpellID: 133, DifficultyID: 0, Attributes: [65536, 0], CastingTimeIndex: 16, DurationIndex: 35, RangeIndex: 35, SchoolMask: 4 }],
    [2, { SpellID: 143, DifficultyID: 0, Attributes: [0, 0], CastingTimeIndex: 16, DurationIndex: 0, RangeIndex: 35, SchoolMask: 4 }],
    [3, { SpellID: 78, DifficultyID: 0, Attributes: [0, 0], CastingTimeIndex: 1, DurationIndex: 0, RangeIndex: 2, SchoolMask: 1 }],
    [4, { SpellID: 6057, DifficultyID: 0, Attributes: [64, 0], CastingTimeIndex: 1, DurationIndex: 0, RangeIndex: 1, SchoolMask: 1 }],
    [5, { SpellID: 5143, DifficultyID: 0, Attributes: [0, 4], CastingTimeIndex: 1, DurationIndex: 0, RangeIndex: 4, SchoolMask: 64 }],
    [6, { SpellID: 458, DifficultyID: 0, Attributes: [0, 0], CastingTimeIndex: 14, DurationIndex: 0, RangeIndex: 1, SchoolMask: 1 }],
    [7, { SpellID: 133, DifficultyID: 1, Attributes: [0, 0], CastingTimeIndex: 1, DurationIndex: 0, RangeIndex: 1, SchoolMask: 1 }],
  ],
  SpellCastTimes: [[1, { ID: 1, Base: 0 }], [14, { ID: 14, Base: 3000 }], [16, { ID: 16, Base: 1500 }]],
  SpellDuration: [[35, { ID: 35, Duration: 4000 }]],
  SpellRange: [
    [1, { ID: 1, Flags: 0, RangeMin: [0, 0], RangeMax: [0, 0] }],
    [2, { ID: 2, Flags: 1, RangeMin: [0, 0], RangeMax: [5, 5] }],
    [4, { ID: 4, Flags: 0, RangeMin: [0, 0], RangeMax: [30, 30] }],
    [35, { ID: 35, Flags: 0, RangeMin: [0, 0], RangeMax: [35, 35] }],
  ],
  SpellPower: [
    [1, { SpellID: 133, OrderIndex: 0, ManaCost: 30, PowerCostPct: 0, PowerType: 0 }],
    [2, { SpellID: 78, OrderIndex: 0, ManaCost: 150, PowerCostPct: 0, PowerType: 1 }],
    [3, { SpellID: 5143, OrderIndex: 0, ManaCost: 0, PowerCostPct: 6, PowerType: 0 }],
  ],
  PowerType: [[1, { ID: 1, PowerTypeEnum: 0, NameGlobalStringTag: "MANA", DisplayModifier: 1 }], [2, { ID: 2, PowerTypeEnum: 1, NameGlobalStringTag: "RAGE", DisplayModifier: 10 }]],
  SpellCooldowns: [[1, { SpellID: 78, DifficultyID: 0, RecoveryTime: 0, CategoryRecoveryTime: 6000, StartRecoveryTime: 1500 }]],
  SpellCategories: [[1, { SpellID: 5143, DifficultyID: 0, DispelType: 1, Mechanic: 12 }]],
  SpellDispelType: [[0, { ID: 0, Name_lang: "None" }], [1, { ID: 1, Name_lang: "Magic" }]],
  SpellMechanic: [[12, { ID: 12, StateName_lang: "stunned" }]],
  SpellLevels: [[1, { SpellID: 133, DifficultyID: 0, SpellLevel: 1, BaseLevel: 1, MaxLevel: 5 }], [2, { SpellID: 143, DifficultyID: 0, SpellLevel: 6 }]],
  SpellEffect: [
    [1, { SpellID: 133, DifficultyID: 0, EffectIndex: 0, EffectBasePointsF: 13, EffectDieSides: 6, EffectAuraPeriod: 0, EffectChainTargets: 0, Variance: 0, EffectRadiusIndex: [0, 0] }],
    [2, { SpellID: 133, DifficultyID: 0, EffectIndex: 1, EffectBasePointsF: 0, EffectDieSides: 0, EffectAuraPeriod: 2000, EffectChainTargets: 0, Variance: 0, EffectRadiusIndex: [8, 0] }],
    [3, { SpellID: 6057, DifficultyID: 0, EffectIndex: 0, EffectBasePointsF: 0, EffectDieSides: 0, EffectAuraPeriod: 0, EffectChainTargets: 0, Variance: 0, EffectRadiusIndex: [0, 0] }],
  ],
  SpellRadius: [[8, { ID: 8, Radius: 5 }]],
  SkillLineAbility: [
    [1, { Spell: 133, SupercedesSpell: 0, SkillLine: 8, ClassMask: 128 }],
    [2, { Spell: 143, SupercedesSpell: 133, SkillLine: 8, ClassMask: 128 }],
    [3, { Spell: 78, SupercedesSpell: 0, SkillLine: 26, ClassMask: 1 }],
    [4, { Spell: 5143, SupercedesSpell: 0, SkillLine: 237, ClassMask: 128 }],
  ],
  TraitDefinition: [[1, { ID: 1, SpellID: 6057 }]],
  Mount: [[6, { ID: 6, SourceSpellID: 458 }]],
  BattlePetSpecies: [[39, { ID: 39, SummonSpellID: 4055 }]],
  ItemSetSpell: [[1, { ItemSetID: 1, SpellID: 2000, Threshold: 2 }]],
  ItemEffect: [
    [10, { ID: 10, TriggerType: 0, SpellID: 1000 }],
    [11, { ID: 11, TriggerType: 2, SpellID: 1000 }],
    [12, { ID: 12, TriggerType: 6, SpellID: 9999 }],
  ],
  ItemXItemEffect: [[1, { ItemEffectID: 10, ItemID: 5000 }], [2, { ItemEffectID: 11, ItemID: 4000 }], [3, { ItemEffectID: 12, ItemID: 6000 }]],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-spells-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("spells: the tooltip numbers of a cast spell, from the base difficulty only", () => {
  expect(buildClientSpells(snapshot(tables)).spells["133"]).toEqual({
    school: 4, level: 1, castMs: 1500, range: [0, 35], durationMs: 4000, costs: [[0, 30, 0]],
    effects: [[0, 13, 6, 0, 0, 0, 0], [1, 0, 0, 2000, 0, 5, 0]],
  });
});

test("spells: rage costs in the game's units, a melee range, the longer cooldown, and the rank a spell replaces", () => {
  const { spells } = buildClientSpells(snapshot(tables));
  expect(spells["78"]).toEqual({ school: 1, range: [0, 5, 1], cooldownMs: 6000, costs: [[1, 15, 0]] });
  expect(spells["143"]).toMatchObject({ level: 6, supersedes: 133 });
  expect(spells["133"]?.supersedes).toBeUndefined();
});

test("spells: passive and channeled flags, a percent cost, and the dispel type and mechanic by id", () => {
  const { spells } = buildClientSpells(snapshot(tables));
  expect(spells["6057"]).toEqual({ school: 1, passive: 1 });
  expect(spells["5143"]).toEqual({ school: 64, range: [0, 30], channeled: 1, costs: [[0, 0, 6]], dispel: 1, mechanic: 12 });
});

test("spells: the items whose Use, Equip or Chance on hit line casts it, with the trigger; a learned spell is not one", () => {
  const { spells } = buildClientSpells(snapshot(tables));
  expect(spells["1000"]?.items).toEqual([[4000, 2], [5000, 0]]);
  expect(spells["9999"]).toBeUndefined();
});

test("spells: only the spells something links (skill lines, talents, mounts, pets, set bonuses, items)", () => {
  const ids = Object.keys(buildClientSpells(snapshot(tables)).spells).map(Number).sort((a, b) => a - b);
  expect(ids).toEqual([78, 133, 143, 458, 1000, 2000, 4055, 5143, 6057]);
});

test("spells: the power, dispel and mechanic names the files give, the empty dispel left out", () => {
  const t = buildClientSpells(snapshot(tables));
  expect(t.powerTypes).toEqual({ "0": "MANA", "1": "RAGE" });
  expect(t.dispelTypes).toEqual({ "1": "Magic" });
  expect(t.mechanics).toEqual({ "12": "stunned" });
});

test("spells: the file carries no spell name, rank text or description, one spell per line, and reads back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-spells-out-")), "client-spells.json");
  const written = writeClientSpells(snapshot(tables), path);
  const text = readFileSync(path, "utf8");
  expect(text).not.toContain("Spell 133 name");
  expect(text).not.toContain("Rank 1");
  expect(text).not.toContain("fiery");
  expect(text).toContain('\n  "133": {');
  expect(ClientSpells.parse(JSON.parse(text))).toEqual(written);
  expect(serializeClientSpells(written)).toBe(text);
});
