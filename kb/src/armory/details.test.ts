import { expect, test } from "vitest";
import { detailPath, normalizeDetails } from "./details.js";

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
