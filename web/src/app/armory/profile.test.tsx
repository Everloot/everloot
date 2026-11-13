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
