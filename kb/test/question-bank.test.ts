import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evidenceAnswers, answerSources } from "../src/answer-sources.js";
import { openDb } from "../src/db.js";
import { createToolHandlers } from "../src/mcp-server.js";
import { emptyMarket, foldMarket } from "../src/market.js";
import { replaceSourceRows, type EntityInput } from "../src/entities.js";
import { buildQuestionBank, gameDataSubjects, INSTANCE_ALIASES, parseQuestionBank, serializeQuestionBank, TEMPLATES, TEMPLATES_ES, TOPICS, TOPICS_ES, wikiSubjects, type Subject } from "../src/question-bank.js";
import type { AnswerKey } from "../src/answer-key.js";
import { carries, evaluateBank, formatEvalReport, resolve } from "../src/question-eval.js";

test("answerability requires the requested predicate, not a name, id or unrelated number", () => {
  const evidence = (claim: string, kind: "files" | "lore" | "observed" = "files") => ({ claim, kind, source: { title: "Synthetic Forest", url: "https://example.test" }, licence: "test", asOf: null });
  expect(evidenceAnswers("what level is Synthetic Forest", evidence("Synthetic Forest: zone 1429."))).toBe(false);
  expect(evidenceAnswers("what level is Synthetic Forest", evidence("Synthetic Forest: levels 10 to 20."))).toBe(true);
  expect(evidenceAnswers("where is Synthetic Vale", evidence("Synthetic Vale: a zone of Nowhere."))).toBe(true);
  expect(evidenceAnswers("where does Synthetic Blade drop", evidence("Synthetic Blade is a legendary sword.", "lore"))).toBe(false);
  expect(evidenceAnswers("what is the price of Synthetic Blade", evidence("Synthetic Blade dropped in 10 of 20 windows.", "observed"))).toBe(false);
  expect(evidenceAnswers("where does Synthetic Blade drop", evidence("Synthetic Blade dropped from Synthetic Warden in 10 of 20 windows.", "observed"))).toBe(true);
});

test("a zone identity cannot stand in for its requested level", async () => {
  const db = openDb(":memory:");
  const result = await answerSources(db, { question: "what level is Synthetic Forest", limit: 3 }, null, null, { build: "test", extractedAt: null, facts: [{ name: "Synthetic Forest", kind: "zone", claim: "Synthetic Forest: a zone of Nowhere." }] });
  expect(result.evidence.at(-1)?.claim).toContain("The requested level is not available from permitted facts");
  expect(result.evidence.some(e => evidenceAnswers("what level is Synthetic Forest", e))).toBe(false);
  db.close();
});

test("answer-bearing file claims precede subject mentions at a one-piece limit", async () => {
  const db = openDb(":memory:");
  const result = await answerSources(db, { question: "what level is Synthetic Forest and Synthetic Dungeon", limit: 1 }, null, null, { build: "test", extractedAt: null, facts: [
    { name: "Synthetic Forest", kind: "zone", claim: "Synthetic Forest: a zone of Nowhere." },
    { name: "Synthetic Dungeon", kind: "instance", claim: "Synthetic Dungeon: a dungeon, level 20." },
  ] });
  expect(result.evidence[0]?.claim).toContain("level 20");
  db.close();
});

test("cross-tool item, realm and history cases preserve tool paths without assuming game values", async () => {
  const bank = buildQuestionBank([], undefined, { crossTool: true }).filter(q => q.template === "cross-tool");
  expect(bank.map(q => q.tools)).toEqual([
    ["search_knowledge", "item_page", "answer_sources"], ["search", "market_value"], ["market_value", "auction_history"],
  ]);
  expect(parseQuestionBank(serializeQuestionBank(bank))).toEqual(bank);
  const db = await seed();
  const report = await evaluateBank(db, bank, null, { release: "test", dataAsOf: null });
  expect(report.totals.withRealAnswer).toBe(0);
  db.close();
});

test("Thunderfury lore identity earns no acquisition credit", async () => {
  const db = openDb(":memory:");
  await replaceSourceRows(db, "warcraft-wiki-2023", ["lore_page"], [page("blade", "Thunderfury", ["Sword items"], "Thunderfury is a legendary sword.")]);
  const q = { id: "blade", text: "where does Thunderfury drop", template: "drops-from", subject: { kind: "wiki_item" as const, name: "Thunderfury" }, expects: { resolve: true, evidence: true } };
  const result = await answerSources(db, { question: q.text, limit: 3 }, null, null);
  expect(result.evidence.at(-1)?.claim).toContain("requested drop source is not available");
  const report = await evaluateBank(db, [q], null, { release: "test", dataAsOf: null });
  expect(report.totals).toMatchObject({ withLore: 1, withRealAnswer: 0 });
  db.close();
});

test("item-name discovery, realm aliases and history agree across tool handlers", async () => {
  const db = openDb(":memory:");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const capturedAt = `${day}T00:00:00Z`;
  const realm = "CAMWOW US1 Realm 4 PvP";
  const records = ["synthetic-a", "synthetic-b", "synthetic-c"].flatMap((installId) => [
    { kind: "item_seen", installId, eventId: `${installId}:name`, capturedAt, itemId: 2589, name: "Synthetic Cloth", quality: "common" },
    { kind: "auction_snapshot", installId, eventId: `${installId}:scan`, capturedAt, realm, house: "Alliance", scanId: installId, part: 1, parts: 1, items: [[2589, 4, 80, 25, 30]] },
  ]);
  const state = foldMarket(emptyMarket(), records, now);
  const tools = createToolHandlers(db, { corpus: async () => ({ records, dataAsOf: capturedAt }), market: async () => ({ state, dataAsOf: capturedAt }) });
  const object = (answer: Awaited<ReturnType<typeof tools.item_page>>) => {
    if (typeof answer === "string") throw new Error("Expected a structured tool answer");
    return answer;
  };
  const discovered = object(await tools.search_knowledge({ query: "Synthetic Cloth", kind: "item", limit: 3 }));
  expect(discovered.structured).toMatchObject({ hits: expect.arrayContaining([expect.objectContaining({ gameId: 2589, name: "Synthetic Cloth" })]) });
  const item = object(await tools.item_page({ itemId: 2589 }));
  expect(item.text).toContain("Synthetic Cloth");
  const args = { realm: "US1 Realm 4 PvP", itemId: 2589 };
  const market = object(await tools.market_value(args));
  const history = object(await tools.auction_history(args));
  expect(market.structured).toMatchObject({ connected: true, page: { realm, realmStatus: "alias", history: [{ day, market: 30 }] } });
  expect(history.structured).toMatchObject({ connected: true, page: { realm, realmStatus: "alias", scanDays: [{ day, market: 30 }] } });
  const answer = object(await tools.answer_sources({ question: "what is the price of Synthetic Cloth", limit: 3 }));
  expect(answer.text).toContain("requested price is not available from permitted facts");
  db.close();
});

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

test("buildQuestionBank with spanish: each template and topic again in Spanish, the names in English, the answer key the same", () => {
  const subjects: Subject[] = [{ kind: "instance", name: "Synthetic Stockade", id: 34 }];
  const key: AnswerKey = (template) => (template === "level" ? { facts: ["20"], from: "synthetic", build: "1" } : undefined);
  expect(buildQuestionBank(subjects, key).some((q) => q.lang)).toBe(false);
  const bank = buildQuestionBank(subjects, key, { spanish: true });
  const es = bank.filter((q) => q.lang === "es");
  expect(es.filter((q) => q.template !== "topic").map((q) => q.template)).toEqual(TEMPLATES.filter((t) => t.kinds.includes("instance")).map((t) => t.id));
  expect(es.find((q) => q.template === "where-is")).toMatchObject({ id: "es:where-is:instance:synthetic-stockade", text: "dónde queda Synthetic Stockade" });
  expect(es.find((q) => q.template === "level")?.answer).toEqual(bank.find((q) => q.id === "level:instance:synthetic-stockade")?.answer);
  expect(es.filter((q) => q.template === "topic")).toHaveLength(TOPICS_ES.length);
  expect(es.find((q) => q.text === "qué es Everloot")?.id).toBe("es:topic:topic:que-es-everloot");
  // Every template a subject can have is phrased in Spanish too; the aliases stay English only.
  for (const t of TEMPLATES) if (t.id !== "alias" && t.id !== "topic") expect(TEMPLATES_ES[t.id], t.id).toBeDefined();
  expect(es.some((q) => q.template === "alias")).toBe(false);
  expect(parseQuestionBank(serializeQuestionBank(bank))).toEqual(bank);
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
  expect(byId.get("where-is:instance:synthetic-stockade")?.missingFacts).toEqual(["dungeon", "keep"]);
  expect(byId.get("level:instance:synthetic-stockade")?.missingFacts).toEqual(["dungeon", "Nowhere"]);
  expect(byId.get("bosses:instance:synthetic-stockade")).not.toHaveProperty("missingFacts");
  expect(report.totals).toMatchObject({ withKey: 2, keyFound: 0, withLore: 3, withRealAnswer: 0 });
  expect(report.keyMissing).toHaveLength(2);
  const md = formatEvalReport(report);
  expect(md).toContain("| answer in evidence |");
  expect(md).toContain("| all | 3 | 100% | 0% | 0% | 100% | 0% | 0% | 100% | 0% | 0% | 0% |");
  expect(md).toContain(`- **level** (1): "what level is Synthetic Stockade" lacks dungeon, Nowhere`);
  expect(md).not.toContain("## By language");
});

test("evaluateBank: Spanish questions get their own template rows and a by-language section", async () => {
  const db = await seed();
  const bank = buildQuestionBank([{ kind: "instance", name: "Synthetic Stockade", id: 34 }], undefined, { spanish: true }).filter((q) => q.template === "where-is");
  const report = await evaluateBank(db, bank, null, { release: "test.sqlite", dataAsOf: null, ranAt: "2026-10-29T12:00:00.000Z" });
  expect(report.byTemplate.map((r) => r.label)).toEqual(["where-is", "where-is (es)"]);
  expect(report.byLanguage.map((r) => [r.label, r.questions])).toEqual([["en", 1], ["es", 1]]);
  expect(report.results.find((r) => r.id.startsWith("es:"))?.resolution).toBe("exact");
  expect(formatEvalReport(report)).toContain("## By language");
});

test("evaluateBank: a limit asks answer_sources for that many pieces, and the report says so", async () => {
  const db = await seed();
  const bank = buildQuestionBank([{ kind: "instance", name: "Synthetic Stockade", id: 34 }]);
  const at = (limit?: number) => evaluateBank(db, bank, null, { release: "test.sqlite", dataAsOf: null, ranAt: "2026-10-30T12:00:00.000Z", limit });
  const [wide, narrow] = [await at(), await at(1)];
  expect(wide.limit).toBeUndefined();
  expect(narrow.limit).toBe(1);
  expect(Math.max(...narrow.results.map((r) => r.evidence))).toBeLessThanOrEqual(Math.max(...wide.results.map((r) => r.evidence)));
  expect(formatEvalReport(narrow)).toContain("Release `test.sqlite`, answer_sources limit 1.");
  expect(formatEvalReport(wide)).toContain("Release `test.sqlite`. Player observations");
});

test("gameDataSubjects: a statistic the game keeps and a name marked [DNT] are not subjects", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-bank-stat-"));
  writeFileSync(join(dir, "client-achievements.json"), JSON.stringify({ achievements: {
    "49": { title: "Synthetic Feat", points: 10, criteria: [] },
    "50": { title: "Synthetic victories", points: 0, criteria: [], statistic: true },
  } }));
  writeFileSync(join(dir, "client-layer.json"), JSON.stringify({ categories: { skills: [{ id: 164, name: "Synthetic Smithing" }, { id: 999, name: "Test Profession [DNT]" }], classes: [] } }));
  expect(gameDataSubjects(dir)).toEqual([
    { kind: "achievement", name: "Synthetic Feat", id: "49" },
    { kind: "profession", name: "Synthetic Smithing", id: 164 },
  ]);
});
