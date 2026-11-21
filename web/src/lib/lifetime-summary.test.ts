import { expect, test } from "vitest";
import { armoryCharacter } from "./armory.fixture";
import { lifetimeSummary } from "./lifetime-summary";

const at = "2026-11-20T08:00:00.000Z";
const withHistory = (slug: string, ranked: Record<string, number>) =>
  armoryCharacter({ slug, name: slug.split("-")[0], details: { revision: 1, playHistory: { asOf: at, groups: [], ranked } } });

test("totals add only the characters that have each count, and say how many did", () => {
  const s = lifetimeSummary([
    withHistory("velkara-duskmantle", { quests: 791, fish: 10 }),
    withHistory("torvin-ashbrook", { quests: 100 }),
    armoryCharacter({ slug: "orla-fenwick", name: "Orla" }),
  ]);
  expect(s.totals.quests).toBe(891);
  expect(s.counted.quests).toBe(2);
  expect(s.totals.fish).toBe(10);
  expect(s.counted.fish).toBe(1);
  // Nobody has a deaths count: no total, not a 0.
  expect(s.totals.deaths).toBeUndefined();
  expect(s.counted.deaths).toBe(0);
  expect(s.read).toBe(2);
  expect(s.rows.map((r) => [r.slug, r.values.quests])).toEqual([["velkara-duskmantle", 791], ["torvin-ashbrook", 100], ["orla-fenwick", undefined]]);
});

test("no characters is an empty summary", () => {
  expect(lifetimeSummary([])).toEqual({ rows: [], totals: {}, counted: { quests: 0, creatures: 0, fish: 0, flights: 0, dungeons: 0, deaths: 0 }, read: 0 });
});
