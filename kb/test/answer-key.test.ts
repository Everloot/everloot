import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { diffAnswerKeys, formatAnswerDiff, gameDataAnswerKey } from "../src/answer-key.js";
import { buildQuestionBank, gameDataSubjects, parseQuestionBank, serializeQuestionBank } from "../src/question-bank.js";

const build = (version: string) => ({ product: "wowf", version });

// SYNTHETIC game-data files in the shape of web/src/data/game-data; the names are made up.
function gameDataDir(o: { version?: string; ridingSkill?: number; bosses?: string[] } = {}): string {
  const version = o.version ?? "1.0.0.1";
  const dir = mkdtempSync(join(tmpdir(), "kb-key-"));
  writeFileSync(join(dir, "map.json"), JSON.stringify({
    source: build(version),
    continents: [{ id: 0, name: "Synthetic Kingdoms" }],
    zones: [{ uiMapId: 1, name: "Synthetic Forest", continentId: 0 }],
    entrances: [{ mapId: 34, name: "Synthetic Stockade", uiMapId: 1, minLevel: 20, maxLevel: 24 }, { mapId: 35, name: "Synthetic Vault", uiMapId: 9 }],
    heldBackZones: [{ uiMapId: 77, name: "Synthetic Shore" }],
    flightNodes: [{ id: 2, name: "Synthetic Keep, Synthetic Forest", uiMapId: 1 }, { id: 3, name: "Synthetic Port, Synthetic Shore", uiMapId: 77 }, { id: 4, name: "Synthetic Camp, Synthetic Wilds", uiMapId: 88 }],
  }));
  writeFileSync(join(dir, "client-encounters.json"), JSON.stringify({ build: build(version), instances: { "34": (o.bosses ?? ["Synthetic Warden", "Synthetic Jailer"]).map((name, i) => ({ id: i + 1, name })) } }));
  writeFileSync(join(dir, "client-mounts.json"), JSON.stringify({ build: build(version), mounts: { "6": { name: "Synthetic Horse", spellId: 458, ridingSkill: o.ridingSkill ?? 75 }, "7": { name: "Synthetic Goat", spellId: 459 } } }));
  writeFileSync(join(dir, "client-achievements.json"), JSON.stringify({ build: build(version), achievements: { "49": { title: "Synthetic Feat", criteria: [{ text: "Win once" }, { text: "Win twice" }] }, "50": { title: "Synthetic Count" } } }));
  mkdirSync(join(dir, "talents"));
  writeFileSync(join(dir, "talents", "mage.json"), JSON.stringify({ build: build(version), className: "Mage", trees: [{ name: "Fire", nodes: [{ entries: [{ spellId: 9, name: "Synthetic Blast" }] }] }] }));
  writeFileSync(join(dir, "talents", "priest.json"), JSON.stringify({ build: build(version), className: "Priest", trees: [{ name: "Holy", nodes: [{ entries: [{ spellId: 10, name: "Synthetic Blast" }] }] }] }));
  return dir;
}

const bankOf = (dir: string) => buildQuestionBank(gameDataSubjects(dir), gameDataAnswerKey(dir));

test("gameDataAnswerKey: each template the files can answer gets its facts, the field they came from and the build", () => {
  const bank = bankOf(gameDataDir());
  const answer = (id: string) => bank.find((q) => q.id === id)?.answer;
  expect(answer("riding-skill:mount:synthetic-horse")).toEqual({ facts: ["75"], from: "client-mounts.json mounts.ridingSkill", build: "1.0.0.1" });
  expect(answer("level:instance:synthetic-stockade")?.facts).toEqual(["20", "24"]);
  expect(answer("where-is:instance:synthetic-stockade")?.facts).toEqual(["Synthetic Forest"]);
  expect(answer("bosses:instance:synthetic-stockade")?.facts).toEqual(["Synthetic Warden", "Synthetic Jailer"]);
  expect(answer("where-is:boss:synthetic-warden")?.facts).toEqual(["Synthetic Stockade"]);
  expect(answer("flight-to:flight:synthetic-keep")?.facts).toEqual(["Synthetic Forest"]);
  // A node in a held-back zone is not a question at all; one whose map the zone list lacks has no key, never a guessed zone.
  expect(bank.some((q) => q.subject.name === "Synthetic Port")).toBe(false);
  expect(bank.find((q) => q.id === "where-is:flight:synthetic-camp")).toBeDefined();
  expect(answer("where-is:flight:synthetic-camp")).toBeUndefined();
  // A talent two classes share names both.
  expect(answer("talent-class:talent:synthetic-blast")).toEqual({ facts: ["Mage", "Priest"], from: "talents/*.json className", build: "1.0.0.1" });
  // Criteria text stays on the achievement's page, so no question is keyed to it.
  expect(answer("criteria:achievement:synthetic-feat")).toBeUndefined();
  expect(answer("where-is:zone:synthetic-forest")).toEqual({ facts: ["Synthetic Kingdoms"], from: "map.json zones.continentId -> continents.name", build: "1.0.0.1" });
  expect(answer("entrance:instance:synthetic-stockade")?.facts).toEqual(["Synthetic Forest"]);
  expect(answer("what-is:talent:synthetic-blast")?.facts).toEqual(["Mage", "Priest", "Fire", "Holy"]);
});

test("gameDataAnswerKey: a missing field or file gives no answer, never a guess", () => {
  const bank = bankOf(gameDataDir());
  const has = (id: string) => bank.some((q) => q.id === id && q.answer);
  expect(has("riding-skill:mount:synthetic-goat")).toBe(false);
  expect(has("level:instance:synthetic-vault")).toBe(false);
  expect(has("where-is:instance:synthetic-vault")).toBe(false);
  // Templates the files cannot answer stay without one.
  expect(has("what-is:mount:synthetic-horse")).toBe(false);
  expect(bank.find((q) => q.id === "what-is:mount:synthetic-horse")).not.toHaveProperty("answer");
  const empty = mkdtempSync(join(tmpdir(), "kb-key-empty-"));
  expect(gameDataAnswerKey(empty)("riding-skill", { kind: "mount", name: "Synthetic Horse", id: "6" })).toBeUndefined();
  // The answer survives the bank's file round trip.
  expect(parseQuestionBank(serializeQuestionBank(bank))).toEqual(bank);
});

test("diffAnswerKeys: a new build's changed, added and removed answers, by question id; reordered facts are not a change", () => {
  const before = bankOf(gameDataDir({ version: "1.0.0.1" }));
  const after = bankOf(gameDataDir({ version: "1.0.0.2", ridingSkill: 150, bosses: ["Synthetic Jailer", "Synthetic Warden"] }));
  expect(diffAnswerKeys(before, before)).toEqual({ builds: { before: ["1.0.0.1"], after: ["1.0.0.1"] }, changed: [], added: [], removed: [] });
  const diff = diffAnswerKeys(before, after);
  expect(diff.builds).toEqual({ before: ["1.0.0.1"], after: ["1.0.0.2"] });
  expect(diff.changed).toEqual([{ id: "riding-skill:mount:synthetic-horse", text: "what riding skill does Synthetic Horse need", before: ["75"], after: ["150"] }]);

  const fewer = bankOf(gameDataDir({ bosses: ["Synthetic Warden"] }));
  const lost = diffAnswerKeys(before, fewer);
  expect(lost.changed.map((c) => c.id)).toEqual(["bosses:instance:synthetic-stockade"]);
  expect(lost.removed.map((c) => c.id)).toEqual(["where-is:boss:synthetic-jailer"]);
  expect(diffAnswerKeys(fewer, before).added.map((c) => c.id)).toEqual(["where-is:boss:synthetic-jailer"]);

  const md = formatAnswerDiff(diff);
  expect(md).toContain("Before: 1.0.0.1. After: 1.0.0.2.");
  expect(md).toContain("1 changed, 0 added, 0 removed.");
  expect(md).toContain("| what riding skill does Synthetic Horse need | 75 | 150 |");
  expect(md).toContain("## Added (0)\n\nNone.");
  // A cap keeps each list short and says how many it left out.
  const capped = formatAnswerDiff(diffAnswerKeys(before, bankOf(gameDataDir({ version: "1.0.0.3", ridingSkill: 150, bosses: ["Synthetic Warden"] }))), { maxRows: 1 });
  expect(capped).toContain("## Changed (2)");
  expect(capped.match(/^\| (?!question)/gm)).toHaveLength(2);
  expect(capped).toContain("…and 1 more (run `question-diff` without --max-rows for all).");
  // A backslash is escaped before the pipe, so neither can end a cell early.
  const odd = formatAnswerDiff({ builds: { before: [], after: [] }, changed: [{ id: "x", text: "a|b", before: ["c\\"], after: ["d\\|e"] }], added: [], removed: [] });
  expect(odd).toContain("| a\\|b | c\\\\ | d\\\\\\|e |");
});
