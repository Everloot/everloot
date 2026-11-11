import { expect, test, vi } from "vitest";
import { loadWikiEntityNames, shownNpcName } from "./wiki-entity-names";
import type { WorldFacts } from "../../../kb/src/world-pages";

const catalog = vi.hoisted(() => ({ raw: null as unknown }));
vi.mock("./talents/assets", () => ({ assetsBaseUrl: () => "https://assets.example.test/build" }));
vi.mock("./game-assets", () => ({
  privateStoreFromEnv: () => null,
  readNamesFile: async (_file: string, _build: string, _base: string, _store: unknown, parse: (raw: unknown) => unknown) => parse(catalog.raw),
  PRIVATE_MALFORMED: Symbol("malformed"), PRIVATE_UNREACHABLE: Symbol("unreachable"),
}));

const wiki = { version: "x", names: new Map([["hogger's friend", { name: "Hogger’s Friend", wikiPage: "https://warcraft.wiki.gg/wiki/Friend" }]]) };
const facts = (names: string[]): WorldFacts => ({ npcs: names.map((name, i) => ({ npcId: 448, name, installId: `secret-${i}`, mapId: 0, x: 0, y: 0 })), quests: [], vendors: [] });

test("loads normalized NPC keys and page links from version 2, rejecting version 1", async () => {
  catalog.raw = { schema: "everloot.wiki-npc-names/2", build: { version: "x" }, wiki: { licence: "CC-BY-SA-4.0" }, names: { hogger: { n: "Hogger", w: "Hogger" } } };
  expect((await loadWikiEntityNames("npc"))?.names.get("hogger")).toEqual({ name: "Hogger", wikiPage: "https://warcraft.wiki.gg/wiki/Hogger" });
  catalog.raw = { ...catalog.raw as object, schema: "everloot.wiki-npc-names/1" };
  expect(await loadWikiEntityNames("npc")).toBeNull();
});

test("normalizes case, spaces and apostrophes for both reports and wiki agreement", () => {
  const shown = shownNpcName(448, facts([" HOGGER'S  friend ", "Hogger’s Friend"]), wiki);
  expect(shown).toEqual({ name: "Hogger’s Friend", fromWiki: true, wikiPage: "https://warcraft.wiki.gg/wiki/Friend" });
  expect(JSON.stringify(shown)).not.toContain("secret-");
});

test("missing, conflicting and repeated reports never create three-install agreement", () => {
  for (const names of [[], ["Other"], ["Hogger’s Friend", "Other"]]) expect(shownNpcName(448, facts(names), wiki).name).toBeUndefined();
  const repeated = facts(["Hogger’s Friend"]);
  repeated.npcs.push(repeated.npcs[0], repeated.npcs[0]);
  expect(shownNpcName(448, repeated, wiki).fromWiki).toBe(true);
  expect(shownNpcName(448, repeated, null).name).toBeUndefined();
  expect(shownNpcName(448, { ...repeated, unreachable: true }, wiki).name).toBeUndefined();
});

test("three agreeing installs take precedence and a recheck needs fresh evidence", () => {
  const f = facts(["Other", "Other", "Other"]);
  expect(shownNpcName(448, f, wiki)).toMatchObject({ name: "Other", fromWiki: false });
  f.npcs = f.npcs.map((r) => ({ ...r, name: "Hogger’s Friend", capturedAt: "2026-11-01T00:00:00Z" }));
  f.recheck = [{ source: "test", ids: [448], since: "2026-11-09T00:00:00Z" }];
  expect(shownNpcName(448, f, wiki).name).toBeUndefined();
  f.npcs.push({ ...f.npcs[0], capturedAt: "2026-11-10T00:00:00Z" });
  expect(shownNpcName(448, f, wiki).fromWiki).toBe(true);
});
