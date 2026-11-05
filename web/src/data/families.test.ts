import { describe, expect, test } from "vitest";
import { guildSlug } from "../../../kb/src/guilds";
import { FAMILIES, figureLabel, getFamily } from "./families";
import { REALMS } from "./realms";

// /guilds/<slug> serves a family first and a realm's guild list otherwise, so a family named like a realm would hide
// that realm's list. guildSlug is the realm slug guildPath and realmPath write.
test("no family slug is the slug of a realm the site knows", () => {
  const realmSlugs = new Set(REALMS.map((r) => guildSlug(r.name)));
  for (const family of FAMILIES) expect(realmSlugs.has(family.slug), family.slug).toBe(false);
});

describe("guild family record", () => {
  test("Olympus is a sourced record, and an unknown slug is absent", () => {
    const olympus = getFamily("olympus");
    expect(olympus?.name).toBe("Olympus");
    expect(getFamily("missing")).toBeUndefined();
    expect(FAMILIES).toHaveLength(1);
  });

  test("every fact has a unique id, an https page, and a date", () => {
    const ids = FAMILIES.flatMap((family) => family.facts.map((fact) => fact.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const fact of FAMILIES.flatMap((family) => family.facts)) {
      expect(fact.url.startsWith("https://")).toBe(true);
      expect(fact.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fact.statement.length).toBeGreaterThan(20);
    }
  });

  test("the guild hall count stays labeled as their exact figure, with who was online", () => {
    const hall = getFamily("olympus")?.facts.find((fact) => fact.id === "olympus-viii-hall");
    expect(hall).toMatchObject({
      kind: "guild-site",
      guild: "Olympus VIII",
      members: { value: 44, bound: "exact" },
      online: 7,
    });
    expect(figureLabel(hall!)).toBe("44 · 7 online");
    expect(figureLabel(getFamily("olympus")!.facts.find((fact) => fact.id === "forum-ten-thousand")!)).toBe("10,000+");
    expect(figureLabel(getFamily("olympus")!.facts.find((fact) => fact.id === "olympus-viii-second-site")!)).toBe("unrecorded");
    expect(figureLabel(getFamily("olympus")!.facts.find((fact) => fact.id === "mute-screenshot-xli")!)).toBe("unrecorded");
  });

  test("the Battle.net check records that Forever's guessed namespaces were refused", () => {
    expect(getFamily("olympus")?.blizzard).toEqual({
      checked: "2026-09-30",
      retailProfile: "answers",
      classicEraStatic: "answers",
      foreverGuessed: "refused",
      forumUrl: "https://us.forums.blizzard.com/en/blizzard/t/world-of-warcraft-forever-api-namespace/59774",
    });
  });
});
