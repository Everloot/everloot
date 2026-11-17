import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { armoryCharacter } from "@/lib/armory.fixture";
import { Equipment, ProfileDetailsView } from "./profile";

test("gear includes every slot, empty states and our item links without a character model", () => {
  const html = renderToStaticMarkup(<Equipment character={armoryCharacter()} tips={new Map()} />);
  expect(html.match(/data-equipment-slot=/g)).toHaveLength(19);
  expect(html).toContain("Not equipped");
  expect(html).toContain('href="/database/items/16846"');
  expect(html).toContain("Giantstalker");
  expect(html).toContain("Main hand");
});
test("supported details show source dates and useful tools; missing categories stay absent", () => {
  const details = { revision: 1 as const, statistics: { asOf: "2026-11-12T12:00:00.000Z", rows: [{ label: "Intellect", value: 69, percent: false }] }, talents: { asOf: "2026-11-12T12:00:00.000Z", trees: [{ name: "Demonology", points: 14, talents: [{ name: "Unholy Power", rank: 5 }] }] }, professions: { asOf: "2026-11-12T12:00:00.000Z", rows: [{ name: "Alchemy", rank: 66, max: 150 }] } };
  const html = renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter({ class: "Warlock", classId: 9, details })} />);
  expect(html).toContain("Intellect");
  expect(html).toContain("Unholy Power");
  expect(html).toContain('href="/tools/talents/warlock"');
  expect(html).toContain("66 / 150");
  expect(html).toContain("2026-11-12 12:00 UTC");
  expect(renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter()} />)).toBe("");
});
test("progress from Blizzard links to our pages and keeps each read time", () => {
  const at = "2026-11-17T08:00:00.000Z";
  const details = { revision: 1 as const,
    achievements: { asOf: at, rows: [{ id: 6, name: "Level 10", completedAt: "2026-11-01T12:26:40.000Z" }] },
    reputations: { asOf: at, rows: [{ id: 530, name: "Darkspear Trolls", standing: "Friendly", tier: 4 }] },
    quests: { asOf: at, completed: [788, 789, 804] } };
  const html = renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter({ details })} />);
  expect(html).toContain('href="/database/achievements/6"');
  expect(html).toContain("2026-11-01");
  expect(html).toContain('href="/database/factions/530"');
  expect(html).toContain("Friendly");
  expect(html).toMatch(/>3<\/span> completed quests/);
  expect(html.match(/data-armory-credit/g)).toHaveLength(3);
  const empty = renderToStaticMarkup(<ProfileDetailsView character={armoryCharacter({ details: { revision: 1, achievements: { asOf: at, rows: [] }, reputations: { asOf: at, rows: [] } } })} />);
  expect(empty).toContain("None completed when it was read.");
  expect(empty).not.toContain("Reputations");
});
