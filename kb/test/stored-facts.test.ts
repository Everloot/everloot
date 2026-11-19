import { afterEach, expect, test, vi } from "vitest";
import type { DB } from "../src/db.js";
import { createToolHandlers, fromTooledUploads, readTooledFacts, type StoredFactsLoader } from "../src/mcp-server.js";
import { npcFactsFromRecords } from "../src/world-pages.js";

const capturedAt = "2026-09-01T00:00:00.000Z";
const storedAsOf = "2026-09-02T00:00:00.000Z";

const sighting = (name: string) => ["a", "b", "c"].map((installId) => ({
  kind: "npc_sighting", positionKind: "npc", installId, npcId: 42, name, mapId: 12, x: 40, y: 20, capturedAt,
}));
/** The corpus names the NPC one way and the stored facts another, so an answer says which source it read. */
const corpusRows = sighting("Hogger");
const storedFacts = npcFactsFromRecords(sighting("Hogger of the Store"));

const text = (answer: string | { text: string }) => (typeof answer === "string" ? answer : answer.text);

afterEach(() => vi.restoreAllMocks());

test("a page tool reads the host's stored facts first, with their own data time, and never opens the corpus", async () => {
  const corpus = vi.fn(async () => ({ records: corpusRows, dataAsOf: capturedAt }));
  const stored = vi.fn<StoredFactsLoader>(async (tool) => (tool === "npc_page" ? { facts: storedFacts, dataAsOf: storedAsOf } : null));
  const answer = await createToolHandlers({} as DB, { corpus, storedFacts: stored }).npc_page({ npcId: 42 });
  expect(text(answer)).toContain("Hogger of the Store");
  expect(text(answer)).not.toContain("Hogger\n");
  expect(answer).toMatchObject({ structured: { connected: true, dataAsOf: storedAsOf } });
  expect(stored).toHaveBeenCalledWith("npc_page");
  expect(corpus).not.toHaveBeenCalled();
});

test("a tool the host holds nothing for reads the corpus exactly as before", async () => {
  const corpus = vi.fn(async () => ({ records: corpusRows, dataAsOf: capturedAt }));
  const answer = await createToolHandlers({} as DB, { corpus, storedFacts: async () => null }).npc_page({ npcId: 42 });
  expect(text(answer)).toContain("Hogger");
  expect(answer).toMatchObject({ structured: { connected: true, dataAsOf: capturedAt } });
  expect(corpus).toHaveBeenCalledOnce();
});

test("a stored read that fails is logged and the corpus answers; the failure is not the caller's", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const corpus = vi.fn(async () => ({ records: corpusRows, dataAsOf: capturedAt }));
  const answer = await createToolHandlers({} as DB, { corpus, storedFacts: async () => { throw new Error("bucket down"); } }).npc_page({ npcId: 42 });
  expect(text(answer)).toContain("Hogger");
  expect(corpus).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("bucket down"));
});

test("the fact readers hand back the stored value itself, so a kept table is shared, not copied", async () => {
  const stored: StoredFactsLoader = async () => ({ facts: storedFacts, dataAsOf: storedAsOf });
  const corpus = vi.fn(async () => ({ records: corpusRows, dataAsOf: capturedAt }));
  const read = await readTooledFacts<typeof storedFacts>("npc_page", corpus, [], stored);
  expect(read?.facts).toBe(storedFacts);
  expect(read?.dataAsOf).toBe(storedAsOf);
  const rendered = await fromTooledUploads<typeof storedFacts>("npc_page", (facts) => facts.npcs[0]!.name, corpus, [], stored);
  expect(rendered).toContain("Hogger of the Store");
  expect(rendered).toContain("2026-09-02");
  expect(corpus).not.toHaveBeenCalled();
});
