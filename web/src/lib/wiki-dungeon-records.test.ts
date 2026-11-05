import { expect, test } from "vitest";
import { worldFactsFromRecords } from "../../../kb/src/world-pages";
import type { ItemFacts } from "../../../kb/src/item-page";
import type { InstanceRow } from "./instances";
import { dungeonRecords } from "./wiki-dungeon-records";

const row: InstanceRow = {
  instanceMapId: 36, name: "Synthetic Mine", raid: false, difficulty: null, level: null,
  difficulties: [], files: [], confirmed: [], reported: 3, encounters: [], reportedBosses: new Map(),
  bosses: [{ encounterId: 1, name: "Synthetic boss", npcIds: [100], kills: 3, reporters: 3, lastSeen: null }],
};
const items: ItemFacts = { names: [], npcs: [], rates: [
  { itemId: 200, sourceNpcId: 100, kills: 10, drops: 2, rate: 0.2, reporters: 3, public: true },
  { itemId: 201, sourceNpcId: 100, kills: 2, drops: 1, rate: 0.5, reporters: 2, public: false },
  { itemId: 202, sourceNpcId: 999, kills: 10, drops: 1, rate: 0.1, reporters: 3, public: true },
] };
const quests = (count: number, category = "Synthetic Mine", tag = "dungeon") => worldFactsFromRecords(
  Array.from({ length: count }, (_, i) => ({ kind: "quest", installId: `install-${i}`, questId: 300,
    title: "Synthetic quest", level: 10, category, tag, rewardItemIds: [], capturedAt: "2026-11-02T10:00:00Z" })),
);

test("loot belongs to a confirmed boss NPC and a public rate; unrelated and under-threshold rows stay out", () => {
  expect(dungeonRecords(row, items, quests(0)).loot.map((drop) => drop.itemId)).toEqual([200]);
  expect(dungeonRecords({ ...row, bosses: [] }, items, quests(0)).loot).toEqual([]);
});

test("dungeon quests require agreement on the category and dungeon tag, rather than matching words in the title", () => {
  expect(dungeonRecords(row, items, quests(3)).quests.map((quest) => quest.questId)).toEqual([300]);
  expect(dungeonRecords(row, items, quests(2)).quests).toEqual([]);
  expect(dungeonRecords(row, items, quests(3, "Another dungeon")).quests).toEqual([]);
  expect(dungeonRecords(row, items, quests(3, "Synthetic Mine", "group")).quests).toEqual([]);
});

test("unavailable storage does not publish cached observations or turn unknown data into a measured zero", () => {
  const result = dungeonRecords(row, { ...items, unreachable: true }, quests(3));
  expect(result).toMatchObject({ loot: [], quests: [], unavailable: true });
});
