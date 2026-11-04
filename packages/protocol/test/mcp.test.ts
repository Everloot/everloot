import { expect, test } from "vitest";
import { KNOWLEDGE_KINDS } from "../src/index.js";

test("KNOWLEDGE_KINDS carries the catalog kinds after the original nine", () => {
  expect(KNOWLEDGE_KINDS.slice(9)).toEqual(["achievement", "faction", "title", "quest_chain", "mount", "legacy_perk", "race", "instance"]);
});
