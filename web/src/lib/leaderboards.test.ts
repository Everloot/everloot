import { describe, expect, it } from "vitest";
import { boardHref, boardQuery, leaderboardsOn, rankEntries, ranksOf, scoreRows } from "./leaderboards";

const ON = { EVERLOOT_LEADERBOARDS: "1", EVERLOOT_CHARACTER_LINKS: "1", EVERLOOT_SHOWCASE: "1", EVERLOOT_PRIVATE_SYNC: "1" };

// Item 1: a head (inventory type 1), item level 60 in the files; item 2: a ring (11), 50.
const FILES = new Map([[1, { inventoryType: 1, level: 60 }], [2, { inventoryType: 11, level: 50 }]]);
const files = (id: number) => FILES.get(id);
function row(name: string, realm: string, equipped: { slot: string; itemId: number; itemLevel: number }[], at = "2026-11-06T10:00:00Z") {
  return { ruleset: "forever", realm, name, race: "Orc", class: "SHAMAN", faction: "Horde", level: 60, captured_at: at, data: { equipped } };
}
const HEAD = { slot: "HeadSlot", itemId: 1, itemLevel: 60 };
const RING = { slot: "Finger0Slot", itemId: 2, itemLevel: 50 };

describe("leaderboards", () => {
  it("is on only with the character pages and private sync on too", () => {
    expect(leaderboardsOn(ON)).toBe(true);
    expect(leaderboardsOn({ ...ON, EVERLOOT_LEADERBOARDS: undefined })).toBe(false);
    expect(leaderboardsOn({ ...ON, EVERLOOT_PRIVATE_SYNC: "0" })).toBe(false);
    expect(leaderboardsOn({ ...ON, EVERLOOT_SHOWCASE: undefined })).toBe(false);
  });

  it("scores each row, files its realm by ruleset and region, and counts what it leaves out", () => {
    const { entries, notCounted } = scoreRows([
      row("Thrall", "CAMWOW US1 Realm 4 PvP", [HEAD, RING]),
      row("Jaina", "CAMWOW EU5 Realm 2 PvE", [{ ...HEAD, itemLevel: 99 }]),
      row("Ghost", "CAMWOW US1 Realm 4 PvP", [{ slot: "HeadSlot", itemId: 3, itemLevel: 60 }]),
      { name: "Broken" },
    ], files);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "Thrall", realmBase: "CAMWOW US1 Realm 4", ruleset: "pvp", region: "us",
      itemLevel: Math.floor(110 / 17), gearScore: Math.floor((44 * 60 + 25 * 50) / 512),
      path: "/characters/forever/camwow-us1-realm-4-pvp/thrall",
    });
    expect(notCounted).toEqual({ level_mismatch: 1, unknown_item: 1, shape: 1 });
  });

  it("ranks highest first, shares a rank on a tie, and ranks within the filter", () => {
    const { entries } = scoreRows([
      row("Ring", "CAMWOW US1 Realm 4 PvP", [RING]),
      row("Early", "CAMWOW US1 Realm 4 PvP", [HEAD], "2026-11-05T00:00:00Z"),
      row("Late", "CAMWOW EU5 Realm 1 RP", [HEAD], "2026-11-06T00:00:00Z"),
    ], files);
    const all = rankEntries(entries, "gear-score", { ruleset: null, region: null });
    expect(all.map((r) => [r.rank, r.entry.name])).toEqual([[1, "Early"], [1, "Late"], [3, "Ring"]]);
    const eu = rankEntries(entries, "gear-score", { ruleset: null, region: "eu" });
    expect(eu.map((r) => [r.rank, r.entry.name])).toEqual([[1, "Late"]]);
    const pvp = rankEntries(entries, "item-level", { ruleset: "pvp", region: "us" });
    expect(pvp.map((r) => r.entry.name)).toEqual(["Early", "Ring"]);
    expect(ranksOf(entries, "camwow us1 realm 4 pvp", "ring")?.["gear-score"].rank).toBe(3);
    expect(ranksOf(entries, "CAMWOW US1 Realm 4 PvP", "Nobody")).toBeNull();
  });

  it("reads only known filter values and writes one address per view", () => {
    expect(boardQuery({})).toEqual({ ruleset: null, region: null });
    expect(boardQuery({ ruleset: "rp-pvp", region: "eu" })).toEqual({ ruleset: "rp-pvp", region: "eu" });
    expect(boardQuery({ region: "mars" })).toBeNull();
    expect(boardQuery({ ruleset: "nope" })).toBeNull();
    expect(boardHref("item-level", { ruleset: "pvp", region: "us" })).toBe("/rankings/item-level?ruleset=pvp&region=us");
    expect(boardHref("gear-score", { ruleset: null, region: null })).toBe("/rankings/gear-score");
  });
});
