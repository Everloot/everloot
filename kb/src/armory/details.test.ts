import { expect, test } from "vitest";
import { ArmoryDetails, detailPath, MAX_QUESTS, normalizeDetails } from "./details.js";
import achievements from "./fixtures/achievements.json";
import reputations from "./fixtures/reputations.json";
import completed from "./fixtures/quests-completed.json";

const at = "2026-11-12T12:00:00.000Z";
test("only follows links for this character on this region's Blizzard API", () => {
  const path = "/profile/wow/character/ember-vale/statistics";
  expect(detailPath({ statistics: { href: `https://eu.api.blizzard.com${path}?namespace=profile-forever-eu` } }, "statistics", "eu", "ember-vale")).toBe(path);
  for (const href of [`https://evil.test${path}`, `https://us.api.blizzard.com${path}`, "https://eu.api.blizzard.com/profile/wow/character/other-person/statistics", `http://eu.api.blizzard.com${path}`]) {
    expect(detailPath({ statistics: { href } }, "statistics", "eu", "ember-vale")).toBeNull();
  }
});
test("normalizes supported statistics, active talents, professions and portrait; retains real zero", () => {
  const d = normalizeDetails({
    statistics: { health: 843, intellect: { effective: 69 }, spell_crit: { value: 4.36 }, armor: { effective: 0 }, nonsense: 999 },
    specializations: { specialization_groups: [{ is_active: true, specializations: [{ specialization: { name: "Demonology", id: 1 }, spent_points: 14, talents: [{ talent: { name: "Unholy Power", id: 2 }, talent_rank: 5 }] }] }] },
    professions: { primaries: [{ profession: { name: "Alchemy", id: 171 }, tiers: [{ skill_points: 66, max_skill_points: 150 }] }] },
    media: { assets: [{ key: "avatar", value: "https://render.worldofwarcraft.com/forever-eu/character/1/2-avatar.jpg" }] },
  }, at);
  expect(d.statistics?.rows).toContainEqual({ label: "Intellect", value: 69, percent: false });
  expect(d.statistics?.rows).toContainEqual({ label: "Armor", value: 0, percent: false });
  expect(d.statistics?.rows.map((r) => r.label)).not.toContain("nonsense");
  expect(d.talents?.trees[0]).toMatchObject({ name: "Demonology", points: 14, talents: [{ name: "Unholy Power", rank: 5 }] });
  expect(d.professions?.rows[0]).toEqual({ name: "Alchemy", rank: 66, max: 150 });
  expect(d.avatar?.url).toContain("-avatar.jpg");
});
test("missing or malformed optional responses cannot manufacture progress or remote images", () => {
  expect(normalizeDetails({}, at)).toEqual({ revision: 1 });
  const d = normalizeDetails({ statistics: { intellect: "69", health: -1 }, specializations: {}, professions: { primaries: [{ profession: { name: "Alchemy" } }] }, media: { assets: [{ key: "avatar", value: "https://evil.test/avatar.jpg" }] } }, at);
  expect(d).toEqual({ revision: 1 });
});
test("reads completed quests from the advertised quests link only", () => {
  const path = "/profile/wow/character/ember-vale/quests";
  expect(detailPath({ quests: { href: `https://eu.api.blizzard.com${path}?namespace=profile-forever-eu` } }, "quests", "eu", "ember-vale")).toBe(`${path}/completed`);
  expect(detailPath({ quests: { href: `https://eu.api.blizzard.com${path}/completed` } }, "quests", "eu", "ember-vale")).toBeNull();
  expect(detailPath({}, "quests", "eu", "ember-vale")).toBeNull();
});
test("keeps completed achievements, faction standings and quest ids, never the whole response", () => {
  const d = normalizeDetails({ achievements, reputations, quests: completed }, at);
  expect(d.achievements).toEqual({ asOf: at, rows: [
    { id: 6, name: "Level 10", completedAt: new Date(1762000000000).toISOString() },
    { id: 7, name: "Level 20", completedAt: new Date(1762500000000).toISOString() },
  ] });
  expect(d.reputations).toEqual({ asOf: at, rows: [
    { id: 530, name: "Darkspear Trolls", standing: "Friendly", tier: 4 },
    { id: 76, name: "Orgrimmar", standing: "Neutral", tier: 3 },
  ] });
  expect(d.quests).toEqual({ asOf: at, completed: [788, 789, 804, 805, 817] });
  const stored = JSON.stringify(d);
  for (const absent of ["criteria", "href", "total_points", "raw", "Quest 788"]) expect(stored).not.toContain(absent);
  expect(ArmoryDetails.parse(d)).toEqual(d);
});
test("an answer with nothing completed is a read; a malformed one is not", () => {
  const d = normalizeDetails({ achievements: { achievements: [{ id: 8, achievement: { name: "Level 30", id: 8 } }], total_points: 0 }, reputations: { reputations: [] }, quests: { quests: [] } }, at);
  expect(d).toEqual({ revision: 1, achievements: { asOf: at, rows: [] }, reputations: { asOf: at, rows: [] }, quests: { asOf: at, completed: [] } });
  expect(normalizeDetails({ achievements: {}, reputations: { reputations: "x" }, quests: null }, at)).toEqual({ revision: 1 });
  const odd = normalizeDetails({
    achievements: { achievements: [{ id: -1, achievement: { name: "Bad" }, completed_timestamp: 1 }, { id: 6, achievement: { name: "" }, completed_timestamp: 1 }, { id: 7, achievement: { name: "Ok" }, completed_timestamp: "soon" }] },
    reputations: { reputations: [{ faction: { id: 1, name: "No standing" }, standing: {} }, { faction: { id: 2, name: "Two" }, standing: { name: "Honored", tier: 5.5 } }] },
  }, at);
  expect(odd.achievements?.rows).toEqual([]);
  expect(odd.reputations?.rows).toEqual([{ id: 2, name: "Two", standing: "Honored" }]);
});
test("bounds and de-duplicates long lists", () => {
  const ids = Array.from({ length: MAX_QUESTS + 500 }, (_, i) => ({ id: MAX_QUESTS + 500 - i }));
  const d = normalizeDetails({ quests: { quests: [...ids, { id: 1 }, { id: 1 }, { id: "2" }, { id: 0 }] } }, at);
  expect(d.quests?.completed).toHaveLength(MAX_QUESTS);
  expect(d.quests?.completed.slice(0, 3)).toEqual([1, 2, 3]);
  expect(ArmoryDetails.safeParse({ revision: 1, quests: { asOf: at, completed: Array.from({ length: MAX_QUESTS + 1 }, (_, i) => i + 1) } }).success).toBe(false);
});
