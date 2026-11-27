import { expect, test } from "vitest";
import { bossEntries, bossEntry, bossesOfNpc, bossHref, BOSSES_PATH } from "./bosses";
import { CLIENT_ENCOUNTERS } from "@/data/game-data/client-encounters";
import { bossRows, instanceRows } from "./instances";

test("a boss's address is its encounter id and its name's words, like the instance pages'", () => {
  expect(bossHref(2732, "Oggleflint")).toBe("/database/bosses/2732-oggleflint");
  expect(bossHref(2747, "Edwin VanCleef")).toBe("/database/bosses/2747-edwin-vancleef");
  expect(bossHref(9, null)).toBe(`${BOSSES_PATH}/9`);
});

test("every encounter of a listed instance is a boss, in the files' order, with its place and the instance it is in", () => {
  const all = bossEntries();
  const rfc = all.filter((b) => b.instance.instanceMapId === 389);
  expect(rfc.map((b) => b.name)).toEqual(["Oggleflint", "Taragaman the Hungerer", "Jergosh the Invoker", "Bazzalan"]);
  expect(rfc.map((b) => b.order)).toEqual([1, 2, 3, 4]);
  expect(rfc.every((b) => b.total === 4 && b.filesName)).toBe(true);
  expect(bossEntry(2747)?.instance.name).toBe("Deadmines");
  // Ids are unique across the list.
  expect(new Set(all.map((b) => b.id)).size).toBe(all.length);
});

test("an encounter of an instance the site does not list (held back) has no boss page", () => {
  const listed = new Set(instanceRows().keys());
  const hidden = Object.entries(CLIENT_ENCOUNTERS.instances).filter(([id]) => !listed.has(Number(id))).flatMap(([, list]) => list.map((e) => e.id));
  expect(hidden.length).toBeGreaterThan(0);
  for (const id of hidden) expect(bossEntry(id)).toBeUndefined();
});

test("a creature 3 installs tie to an encounter is that boss's creature; others are no boss", () => {
  // SYNTHETIC: three installs killed Oggleflint and tie creature 11517 to it.
  const encounters = ["a", "b", "c"].map((installId) => ({ installId, encounterId: 2732, name: "Oggleflint", instanceMapId: 389, success: true, npcIds: [11517], capturedAt: "2026-11-04T20:00:00Z" }));
  const rows = instanceRows({ asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters } });
  const boss = bossEntry(2732, rows)!;
  expect(boss.row.boss?.npcIds).toEqual([11517]);
  expect(bossesOfNpc(11517, rows).map((b) => b.id)).toEqual([2732]);
  expect(bossesOfNpc(1, rows)).toEqual([]);
});

test("the boss table and the boss pages keep one order: the files', reported or not (Deadmines: Miner Johnson third, VanCleef last)", () => {
  // SYNTHETIC: three installs report every Deadmines boss but Miner Johnson, VanCleef first.
  const reported = [2747, 2741, 2742, 2743, 2744, 2745, 2746];
  const named = new Map(CLIENT_ENCOUNTERS.instances["36"]!.map((e) => [e.id, e.name]));
  const encounters = reported.flatMap((encounterId) => ["a", "b", "c"].map((installId) => ({ installId, encounterId, name: named.get(encounterId)!, instanceMapId: 36, success: true, npcIds: [], capturedAt: "2026-11-04T20:00:00Z" })));
  const rows = instanceRows({ asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters } });
  const table = bossRows(rows.get(36)!).map((r) => r.name);
  const pages = bossEntries(rows).filter((b) => b.instance.instanceMapId === 36);
  expect(pages.map((b) => b.name)).toEqual(table);
  expect(table.indexOf("Miner Johnson")).toBe(2);
  expect(table.at(-1)).toBe("Edwin VanCleef");
  expect(pages.find((b) => b.id === 2747)).toMatchObject({ order: 8, total: 8 });
  expect(pages.map((b) => b.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

test("a boss count is the instance's own difficulty, not every difficulty's copy", () => {
  const rows = instanceRows();
  const count = (id: number) => bossEntries(rows).filter((b) => b.instance.instanceMapId === id).length;
  expect(count(48)).toBe(7);
  expect(count(109)).toBe(8);
  expect(count(90)).toBe(5);
  expect(count(36)).toBe(8);
});
