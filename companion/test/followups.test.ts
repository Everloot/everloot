import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { lookupText, readsAsFollowUp, sourcedFor, type AskContext, type Sourced } from "../src/bridge/engine";
import { llmEngine } from "../src/bridge/llm-engine";
import { answerPending, createAnswerStore } from "../src/bridge/run";

test("readsAsFollowUp: an opening 'and' or 'what about', or a pronoun with no capitalised name", () => {
  for (const q of ["what does he drop", "where is it", "and the entrance?", "What about Ragnaros", "how about there", "is it worth it"]) expect(readsAsFollowUp(q), q).toBe(true);
  for (const q of ["what does Ragnaros drop", "where is Edwin VanCleef", "Thrall", "who sells Linen Cloth", "price 2589"]) expect(readsAsFollowUp(q), q).toBe(false);
  // "there" is a place far more often than a follow-up.
  expect(readsAsFollowUp("is there a mailbox in orgrimmar")).toBe(false);
  // "I" is not a name.
  expect(readsAsFollowUp("can I solo it")).toBe(true);
});

test("lookupText: a follow-up is looked up with the question it follows, whose names it needs", () => {
  expect(lookupText("what does he drop")).toBe("what does he drop");
  expect(lookupText("what does he drop", { earlier: { question: "where is Edwin VanCleef", answer: "In the Deadmines." } }))
    .toBe("what does he drop (where is Edwin VanCleef)");
});

const piece = (kind: string, claim: string) => ({ claim, kind, licence: "CC BY-SA 4.0", source: { url: "https://everloot.app/x" } });
const earlier = { earlier: { question: "where is Ragnaros", answer: "In Molten Core." } };

test("sourcedFor: the question alone first; the earlier question only when its own evidence names nothing", async () => {
  const asked: string[] = [];
  const by = (map: Record<string, Sourced>) => async (q: string) => { asked.push(q); return map[q] ?? { text: "", evidence: [] }; };
  // Lowercase names still find their own fact: no leaning on the earlier question.
  const own = await sourcedFor("it has a mailbox in orgrimmar?", earlier, by({ "it has a mailbox in orgrimmar?": { text: "", evidence: [piece("files", "Orgrimmar: a zone of Kalimdor.")] } }));
  expect(own.leaned).toBe(false);
  expect(asked).toEqual(["it has a mailbox in orgrimmar?"]);
  // Only wiki pages, or a loose match, name nothing: then the earlier question's names are added.
  asked.length = 0;
  const leaned = await sourcedFor("what does he drop", earlier, by({
    "what does he drop": { text: "", evidence: [piece("lore", "Drops are items.")], someWords: true },
    "what does he drop (where is Ragnaros)": { text: "", evidence: [piece("observed", "Ragnaros drops Eye of Sulfuras.")] },
  }));
  expect(leaned).toMatchObject({ leaned: true, sourced: { evidence: [{ claim: "Ragnaros drops Eye of Sulfuras." }] } });
  expect(asked).toEqual(["what does he drop", "what does he drop (where is Ragnaros)"]);
  // No earlier question: one lookup, whatever it finds.
  asked.length = 0;
  expect((await sourcedFor("what does he drop", undefined, by({}))).leaned).toBe(false);
  expect(asked).toEqual(["what does he drop"]);
});

const ask = (id: string, question: string, askedAt: string) => `{["id"] = "${id}", ["question"] = "${question}", ["askedAt"] = "${askedAt}"},`;

test("answerPending: a follow-up within 30 minutes gets the question before it; follow-ups chain; the game file never gets the questions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-followups-"));
  const sv = join(dir, "Everloot.lua");
  writeFileSync(sv, `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}, ["asks"] = {`
    + ask("ask:1", "where is Edwin VanCleef", "2026-10-29T10:00:00Z")
    + ask("ask:2", "what does he drop", "2026-10-29T10:05:00Z")
    + ask("ask:3", "and is it rare", "2026-10-29T10:06:00Z")
    + ask("ask:4", "and where is it", "2026-10-29T10:50:00Z")
    + ask("ask:5", "what does Ragnaros drop", "2026-10-29T10:51:00Z")
    + "}}\n");
  const seen: { question: string; context?: AskContext }[] = [];
  const replies = ["In the Deadmines.", "Cruel Barb.", "Yes.", "Unknown.", "Molten things."];
  const engine = { answer: vi.fn(async (question: string, context?: AskContext) => { seen.push({ question, context }); return { answer: replies[seen.length - 1]!, source: "test" }; }) };
  const addons = join(dir, "AddOns");
  const store = createAnswerStore(join(dir, "answers.json"));
  expect(await answerPending({ svFile: sv, addonsDir: addons, engine, store })).toEqual({ answered: 5, failed: 0 });
  expect(seen.map((s) => s.context)).toEqual([
    undefined,
    { earlier: { question: "where is Edwin VanCleef", answer: "In the Deadmines." } },
    // The third leans on the second, which carries the first one's names.
    { earlier: { question: "what does he drop (where is Edwin VanCleef)", answer: "Cruel Barb." } },
    // Forty-four minutes after the question before it: too late to lean on it.
    undefined,
    // Names its own subject: not a follow-up.
    undefined,
  ]);
  const lua = readFileSync(join(addons, "EverlootAnswers", "EverlootAnswers.lua"), "utf8");
  expect(lua).toContain("Cruel Barb.");
  expect(lua).not.toContain("where is Edwin VanCleef");
  expect(lua).not.toContain("askedAt\"] = \"2026-10-29T10:00:00Z");
});

test("the model hears the question a follow-up leans on only when the lookup leaned on it", async () => {
  const sources = vi.fn(async (q: string): Promise<Sourced> => q.includes("(")
    ? { text: "- [observed in play] Cruel Barb drops from Edwin VanCleef.", evidence: [piece("observed", "Cruel Barb drops from Edwin VanCleef.")] }
    : { text: "- [lore] Drops are items.", evidence: [piece("lore", "Drops are items.")], someWords: true });
  const complete = vi.fn(async () => ({ text: "He drops Cruel Barb.", model: "m" }));
  const engine = llmEngine({ sources, providers: [{ name: "x", complete }] });
  const reply = await engine.answer("what does he drop", { earlier: { question: "where is Edwin VanCleef", answer: "In the Deadmines." } });
  expect(reply.answer).toBe("He drops Cruel Barb. (answered by m)");
  expect(sources.mock.calls.map((c) => c[0])).toEqual(["what does he drop", "what does he drop (where is Edwin VanCleef)"]);
  const [, user] = complete.mock.calls[0] as unknown as [string, string];
  expect(user.startsWith("Earlier the player asked: where is Edwin VanCleef\nand was told: In the Deadmines.\n\nQuestion: what does he drop\n\nSources:\n")).toBe(true);
  // A question that finds its own subject is answered alone, and the model is not told the earlier one.
  complete.mockClear();
  const alone = llmEngine({ sources: async () => ({ text: "- [game files] Orgrimmar: a zone.", evidence: [piece("files", "Orgrimmar: a zone.")] }), providers: [{ name: "x", complete }] });
  await alone.answer("is it orgrimmar", { earlier: { question: "where is Edwin VanCleef", answer: "In the Deadmines." } });
  expect((complete.mock.calls[0] as unknown as [string, string])[1].startsWith("Question: is it orgrimmar")).toBe(true);
});
