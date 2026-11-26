import { expect, test } from "vitest";
import { entityCardSubtitle } from "./og-card";

test("an entity card's line: the type, the installs line when there is one, then up to three facts", () => {
  expect(entityCardSubtitle({ type: "NPC", installs: 2 })).toBe("NPC · 2 of 3 installs agree");
  expect(entityCardSubtitle({ type: "Armor", installs: 0, omitZero: true })).toBe("Armor");
  expect(entityCardSubtitle({ type: "Mount", installs: null, facts: ["Riding skill 75", "Found in game files, unconfirmed"] }))
    .toBe("Mount · Riding skill 75 · Found in game files, unconfirmed");
  expect(entityCardSubtitle({ type: "Raid", installs: null, facts: ["Level 60", "10 bosses", "Kalimdor", "a fourth"] })).toBe("Raid · Level 60 · 10 bosses · Kalimdor");
});
