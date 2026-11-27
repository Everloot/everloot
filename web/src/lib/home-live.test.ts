import { expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import type { GuildProgress, InstanceDef } from "@kb/guilds";
import type { PublicFact } from "./database-activity";
import { censusWeek, ladderTop, loadHomeNewest, loadHomeWeek, newestFacts, pageNamed } from "./home-live";

const fact = (kind: PublicFact["kind"], id: number, publicAt: string): PublicFact => ({
  kind, id, name: `${kind} ${id}`, installs: 3, publicAt, path: `/database/${kind === "item" ? "items" : "npcs"}/${id}`,
});

test("the newest facts come newest first, five of them, and only items take an icon and a quality", () => {
  const entries = [
    fact("npc", 1, "2026-11-20T00:00:00.000Z"), fact("item", 2, "2026-11-25T00:00:00.000Z"), fact("item", 3, "2026-11-21T00:00:00.000Z"),
    fact("item", 4, "2026-11-22T00:00:00.000Z"), fact("item", 5, "2026-11-23T00:00:00.000Z"), fact("npc", 6, "2026-11-24T00:00:00.000Z"),
  ];
  const tips = new Map([[2, { icon: "i2.webp", quality: "Rare" }], [1, { icon: "npc.webp", quality: "Epic" }], [4, { icon: null, quality: "Artifact" }]]);
  const shown = newestFacts(entries, tips);
  expect(shown.map((e) => e.id)).toEqual([2, 6, 5, 4, 3]);
  expect(shown[0]).toMatchObject({ icon: "i2.webp", quality: "rare" });
  // A quality the site has no colour token for reads as none, never a made-up class.
  expect(shown[3]).toMatchObject({ icon: null, quality: null });
  expect(shown[1]).not.toHaveProperty("icon");
  expect(shown[4]).not.toHaveProperty("quality");
});

test("a fact stored under its #id fallback takes the name its own page shows; a page without one keeps the fallback", () => {
  const named = (kind: PublicFact["kind"], id: number, name: string): PublicFact => ({ ...fact(kind, id, "2026-11-25T00:00:00.000Z"), name });
  const entries = [
    named("item", 249881, "Item #249881"), named("npc", 2376, "NPC #2376"), named("item", 276916, "Item #276916"),
    named("quest", 7, "Quest #7"), named("item", 9, "Agreed Name"), named("boss", 4, "Encounter #4"),
  ];
  const names = {
    items: new Map([[249881, "Recipe: Root Tea"], [9, "Files Name"]]), npcs: new Map([[2376, "Torn Fin Oracle"]]),
    objects: new Map<number, string>(), quests: new Map<number, string>(),
  };
  expect(pageNamed(entries, names).map((e) => e.name)).toEqual([
    "Recipe: Root Tea", "Torn Fin Oracle", "Item #276916", "Quest #7", "Agreed Name", "Encounter #4",
  ]);
  expect(pageNamed(entries, null)).toEqual(entries);
});

const instance = (id: number, tier: number, type: InstanceDef["instanceType"]): InstanceDef => ({ instanceMapId: id, name: `Instance ${id}`, instanceType: type, tier, bosses: [] });
const progress = (key: string, instanceMapId: number, killed: number, at: string | null): GuildProgress => ({
  key, guildName: key.toUpperCase(), realm: "Realm", faction: null, instanceMapId, instanceName: `Instance ${instanceMapId}`, tier: 0, killed, bosses: 5, latestKillAt: at, list: [],
});

test("the ladder is the newest instance with a kill, its first rows in ladder order", () => {
  const data = {
    instances: [instance(1, 1, "dungeon"), instance(2, 2, "dungeon"), instance(3, 9, "raid")],
    progress: [
      progress("a", 1, 5, "2026-11-10T00:00:00.000Z"),
      ...["b", "c", "d", "e", "f", "g"].map((k, i) => progress(k, 2, 5 - Math.floor(i / 2), `2026-11-1${i}T00:00:00.000Z`)),
      progress("z", 3, 0, null),
    ],
  };
  const top = ladderTop(data, false);
  expect(top.instance).toEqual({ name: "Instance 2", raid: false });
  expect(top.rows.map((r) => r.guildName)).toEqual(["B", "C", "D", "E", "F"]);
  expect(top.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  expect(top.total).toBe(6);
});

test("before any agreed kill there is no ladder, and the panel is told whether raids are open", () => {
  expect(ladderTop({ instances: [instance(1, 1, "raid")], progress: [] }, true)).toEqual({ instance: null, rows: [], total: 0, raidsOpen: true });
});

test("no ranked week yet: no week, no shares, no movers", () => {
  expect(censusWeek([])).toEqual({ week: null, classes: [], classHidden: false, movers: null });
});

test("without the cloud store each loader answers null, never an empty list that reads as no activity", async () => {
  expect(await loadHomeNewest()).toBeNull();
  expect(await loadHomeWeek()).toBeNull();
});
