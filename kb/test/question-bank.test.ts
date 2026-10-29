import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDb } from "../src/db.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { buildQuestionBank, gameDataSubjects, INSTANCE_ALIASES, parseQuestionBank, serializeQuestionBank, TEMPLATES, TOPICS, wikiSubjects } from "../src/question-bank.js";
import type { AnswerKey } from "../src/answer-key.js";
import { carries, evaluateBank, formatEvalReport, resolve } from "../src/question-eval.js";

// SYNTHETIC game-data files in the shape of web/src/data/game-data; the names are made up.
function gameDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-bank-"));
  writeFileSync(join(dir, "map.json"), JSON.stringify({
    zones: [{ uiMapId: 1, name: "Synthetic Forest" }, { uiMapId: 2, name: "Synthetic Dunes" }],
    entrances: [{ mapId: 34, name: "Synthetic Stockade", raid: false }, { mapId: 34, name: "Synthetic Stockade", raid: false }],
    flightNodes: [{ id: 2, name: "Synthetic Keep, Synthetic Forest" }],
  }));
  writeFileSync(join(dir, "client-encounters.json"), JSON.stringify({ instances: { "34": [{ id: 1, name: "Synthetic Warden" }] } }));
  writeFileSync(join(dir, "client-mounts.json"), JSON.stringify({ mounts: { "6": { name: "Synthetic Horse", spellId: 458, ridingSkill: 75 } } }));
  writeFileSync(join(dir, "client-layer.json"), JSON.stringify({ categories: { skills: [{ id: 164, name: "Synthetic Smithing" }], classes: [{ id: 2, name: "Weapon", label: "Weapons", slug: "weapons", items: 3 }] } }));
  mkdirSync(join(dir, "talents"));
  writeFileSync(join(dir, "talents", "mage.json"), JSON.stringify({ trees: [{ nodes: [{ entries: [{ spellId: 9, name: "Synthetic Blast" }] }] }] }));
  return dir;
}

test("gameDataSubjects: one subject per name and kind from every file that exists; missing files add nothing", () => {
  const subjects = gameDataSubjects(gameDataDir());
  expect(subjects).toEqual([
    { kind: "zone", name: "Synthetic Forest", id: 1 }, { kind: "zone", name: "Synthetic Dunes", id: 2 },
    { kind: "instance", name: "Synthetic Stockade", id: 34 },
    { kind: "flight", name: "Synthetic Keep", id: 2 },
    { kind: "boss", name: "Synthetic Warden", id: "34:1" },
    { kind: "mount", name: "Synthetic Horse", id: "6" },
    { kind: "profession", name: "Synthetic Smithing", id: 164 },
    { kind: "item_category", name: "Weapons", id: 2 },
    { kind: "talent", name: "Synthetic Blast", id: 9 },
  ]);
  expect(gameDataSubjects(mkdtempSync(join(tmpdir(), "kb-bank-empty-")))).toEqual([]);
});

test("buildQuestionBank: every template of a subject's kind, stable ids, then the aliases and the long tail", () => {
  const bank = buildQuestionBank([{ kind: "instance", name: "Synthetic Stockade", id: 34 }, { kind: "mount", name: "Synthetic Horse", id: "6" }]);
  const stockade = bank.filter((q) => q.subject.name === "Synthetic Stockade");
  expect(stockade.map((q) => q.template)).toEqual(TEMPLATES.filter((t) => t.kinds.includes("instance")).map((t) => t.id));
  expect(stockade[0]).toEqual({ id: "where-is:instance:synthetic-stockade", text: "where is Synthetic Stockade", template: "where-is", subject: { kind: "instance", name: "Synthetic Stockade", id: 34 }, expects: { resolve: true, evidence: true } });
  expect(bank.find((q) => q.template === "riding-skill")?.text).toBe("what riding skill does Synthetic Horse need");
  expect(bank.filter((q) => q.template === "alias")).toHaveLength(INSTANCE_ALIASES.length);
  const topics = bank.filter((q) => q.template === "topic");
  expect(topics).toHaveLength(TOPICS.length);
  expect(topics[0]!.expects).toEqual({ resolve: false, evidence: true });
  expect(parseQuestionBank(serializeQuestionBank(bank))).toEqual(bank);
  // The same input gives the same bank, in the same order.
  expect(buildQuestionBank([{ kind: "mount", name: "Synthetic Horse", id: "6" }, { kind: "instance", name: "Synthetic Stockade", id: 34 }]).map((q) => q.id).sort()).toEqual(bank.map((q) => q.id).sort());
});

const page = (extId: string, name: string, categories: string[], body = `${name} is a thing.`): EntityInput => ({
  kind: "lore_page", extId, name, body, gameVersion: "lore", sourceUrl: `https://example.test/${extId}`, retrievedAt: "2023-11-13", data: { categories },
});

async function seed() {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [
    page("stockade", "Synthetic Stockade", ["Instances"], "The Synthetic Stockade is a dungeon under the keep."),
    page("warden", "Synthetic Warden", ["Named mobs"], "The Synthetic Warden guards the stockade."),
    page("horse", "Synthetic Horse", ["Mount items"]),
    page("forest", "Synthetic Forest", ["Zones"]),
    page("errand", "A Synthetic Errand", ["Elwynn Forest quests"]),
    page("ambiguous", "Thing (disambiguation)", ["Instances"]),
  ]);
  return db;
}

test("wikiSubjects: page titles by their categories, the first rule wins, disambiguation titles left out, perKind caps each kind", async () => {
  const db = await seed();
  const subjects = wikiSubjects(db, 5);
  expect(subjects).toEqual([
    { kind: "wiki_instance", name: "Synthetic Stockade", id: expect.any(Number) },
    { kind: "wiki_quest", name: "A Synthetic Errand", id: expect.any(Number) },
    { kind: "wiki_npc", name: "Synthetic Warden", id: expect.any(Number) },
    { kind: "wiki_item", name: "Synthetic Horse", id: expect.any(Number) },
    { kind: "wiki_zone", name: "Synthetic Forest", id: expect.any(Number) },
  ]);
  expect(wikiSubjects(db, 0)).toEqual([]);
});

test("resolve: exact title first, then a search hit carrying the name, else none; topics are not scored", async () => {
  const db = await seed();
  const bank = buildQuestionBank([{ kind: "instance", name: "Synthetic Stockade", id: 34 }, { kind: "boss", name: "Nobody Here", id: "34:9" }]);
  expect(await resolve(db, bank.find((q) => q.id === "where-is:instance:synthetic-stockade")!)).toBe("exact");
  expect(await resolve(db, bank.find((q) => q.id === "drops:boss:nobody-here")!)).toBe("none");
  expect(await resolve(db, bank.find((q) => q.template === "topic")!)).toBe("n/a");
  // An alias resolves only when search on the alias text finds the instance: "VC level" does not say Stockade.
  expect(await resolve(db, { id: "x", text: "stockade under the keep", template: "alias", subject: { kind: "alias", name: "Synthetic Stockade" }, expects: { resolve: true, evidence: true } })).toBe("search");
});

test("evaluateBank: totals, per-template and per-kind rows, the unresolved names and the questions with no evidence; the report reads as markdown", async () => {
  const db = await seed();
  const bank = buildQuestionBank([{ kind: "instance", name: "Synthetic Stockade", id: 34 }, { kind: "boss", name: "Nobody Here", id: "34:9" }]).filter((q) => q.template !== "alias" && q.template !== "topic");
  const report = await evaluateBank(db, bank, null, { release: "test.sqlite", dataAsOf: null, ranAt: "2026-10-27T12:00:00.000Z", sampleNames: 3 });
  expect(report.corpusConnected).toBe(false);
  expect(report.totals.questions).toBe(bank.length);
  expect(report.totals.exact).toBe(bank.filter((q) => q.subject.name === "Synthetic Stockade").length);
  expect(report.unresolved).toEqual([{ kind: "boss", count: 1, names: ["Nobody Here"] }]);
  expect(report.byKind.map((r) => r.label).sort()).toEqual(["boss", "instance"]);
  expect(report.noEvidence.find((n) => n.template === "drops")?.texts).toEqual(["what does Nobody Here drop"]);
  const md = formatEvalReport(report);
  expect(md).toContain("# Question eval, 2026-10-27");
  expect(md).toContain("not connected: the observed layer is unrecorded, not empty");
  expect(md).toContain("- **boss** (1): Nobody Here");
  expect(md).toMatch(/\| all \| \d+ \| \d+% \| \d+% \| \d+% \|/);
  expect(md).toContain("| with files |");
});

test("carries: a fact as a whole word or number, any case", () => {
  expect(carries("needs riding skill 75.", "75")).toBe(true);
  expect(carries("needs riding skill 175.", "75")).toBe(false);
  expect(carries("Bosses: Rhahk'Zor, Mr. Smite", "mr. smite")).toBe(true);
  expect(carries("Rhahk'Zorn", "Rhahk'Zor")).toBe(false);
  // A model's curly apostrophe is the files' straight one; a plural carries its word, never a number's.
  expect(carries("Viscidus waits in Ahn’Qiraj Temple.", "Ahn'Qiraj Temple")).toBe(true);
  expect(carries("a talent for Balance Druids", "Druid")).toBe(true);
  expect(carries("riding skill 75s", "75")).toBe(false);
  expect(carries("Druidic lore", "Druid")).toBe(false);
});

test("evaluateBank: a question with an answer key is scored on whether its evidence carries every fact", async () => {
  const db = await seed();
  const key: AnswerKey = (template) =>
    template === "where-is" ? { facts: ["dungeon", "keep"], from: "synthetic", build: "1" }
      : template === "level" ? { facts: ["dungeon", "Nowhere"], from: "synthetic", build: "1" } : undefined;
  const bank = buildQuestionBank([{ kind: "instance", name: "Synthetic Stockade", id: 34 }], key).filter((q) => q.template === "where-is" || q.template === "level" || q.template === "bosses");
  const report = await evaluateBank(db, bank, null, { release: "test.sqlite", dataAsOf: null, ranAt: "2026-10-28T12:00:00.000Z" });
  const byId = new Map(report.results.map((r) => [r.id, r]));
  expect(byId.get("where-is:instance:synthetic-stockade")?.missingFacts).toEqual([]);
  expect(byId.get("level:instance:synthetic-stockade")?.missingFacts).toEqual(["Nowhere"]);
  expect(byId.get("bosses:instance:synthetic-stockade")).not.toHaveProperty("missingFacts");
  expect(report.totals).toMatchObject({ withKey: 2, keyFound: 1 });
  expect(report.keyMissing).toEqual([{ template: "level", count: 1, examples: [{ text: "what level is Synthetic Stockade", missing: ["Nowhere"] }] }]);
  const md = formatEvalReport(report);
  expect(md).toContain("| answer in evidence |");
  expect(md).toContain("| all | 3 | 100% | 0% | 0% | 100% | 0% | 0% | 0% | 50% |");
  expect(md).toContain(`- **level** (1): "what level is Synthetic Stockade" lacks Nowhere`);
});
