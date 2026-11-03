import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GAME_DATA_CREDIT, MCP_TOOLS } from "@everloot/protocol";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { handleClassRaces } from "../src/class-races-tool.js";
import { RACE_TABLE } from "../src/client-races-file.js";
import { RACIAL_NOTES, withRacialNotes } from "../src/racial-notes.js";
import { openDb, type DB } from "../src/db.js";
import { createKnowledgeServer } from "../src/mcp-server.js";

const out = z.object(MCP_TOOLS.class_races.outputSchema);
const build = RACE_TABLE.build.version;

test("class_races names the races that can be the class on each faction, with their traits and no game text", () => {
  const { text, structured } = handleClassRaces({ class: "Warlock", faction: "horde" }, RACE_TABLE);
  const page = out.parse(structured);
  expect(page).toMatchObject({ class: "warlock", className: "Warlock", faction: "horde", build, url: "https://everloot.app/classes/warlock" });
  expect(page.factions.map((f) => f.faction)).toEqual(["Horde"]);
  expect(page.factions[0].races.map((r) => r.name)).toEqual(["Orc", "Undead", "Troll"]);
  expect(page.factions[0].races[0].traits[0]).toEqual({ name: "Blood Fury", kind: "active", order: 0 });
  expect(text).toContain(`found in game files, unconfirmed; build ${build}`);
  expect(text).toContain("Orc: Blood Fury (active), Shatter Curse (active), Savage (passive), Hardiness (passive)");
  expect(text.endsWith(`\nMore: https://everloot.app/classes/warlock\n${GAME_DATA_CREDIT}`)).toBe(true);
  // A trait's description is game text: pages only, never in the answer.
  for (const race of RACE_TABLE.races) for (const t of race.traits) {
    expect(text).not.toContain(t.description);
    expect(JSON.stringify(structured)).not.toContain(t.description);
  }
});

test("without a faction both are listed, Alliance first; a slug, a name and any case read the same", () => {
  const both = out.parse(handleClassRaces({ class: "mage" }, RACE_TABLE).structured);
  expect(both.factions.map((f) => [f.faction, f.races.map((r) => r.name)])).toEqual([
    ["Alliance", ["Human", "Gnome", "High Order Skyborne"]],
    ["Horde", ["Orc", "Undead", "Troll"]],
  ]);
  expect(handleClassRaces({ class: "MAGE" }, RACE_TABLE).text).toBe(handleClassRaces({ class: "mage" }, RACE_TABLE).text);
});

test("a class the table does not know is answered in words, with the classes it does, and no page link", () => {
  const { text, structured } = handleClassRaces({ class: "Monk" }, RACE_TABLE);
  const page = out.parse(structured);
  expect(page.error).toContain("Monk");
  expect(page.factions).toEqual([]);
  expect(page.url).toBeUndefined();
  expect(text).toContain("Warlock");
  expect(text).not.toContain("More:");
  expect(text.endsWith(GAME_DATA_CREDIT)).toBe(true);
});

const databases: DB[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

test("class_races answers over MCP with structured content of the declared shape", async () => {
  const db = openDb(":memory:");
  databases.push(db);
  const server = createKnowledgeServer(db);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  const listed = (await client.listTools()).tools.find((t) => t.name === "class_races");
  expect(listed?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  const res = await client.callTool({ name: "class_races", arguments: { class: "warlock", faction: "horde" } });
  expect(res.isError).not.toBe(true);
  expect(out.parse(res.structuredContent).factions[0].races.map((r) => r.name)).toEqual(["Orc", "Undead", "Troll"]);
  // The server answers with Blizzard's October 26 racial pass: Orc's Savage is gone and Command is back.
  const orc = out.parse(res.structuredContent).factions[0].races[0];
  expect(orc.traits.map((t) => t.name)).toEqual(["Blood Fury", "Shatter Curse", "Command", "Hardiness"]);
  const text = (res.content as { type: string; text: string }[])[0].text;
  expect(text).toContain(RACIAL_NOTES.sourceUrl);
});

test("with the notes applied, removed racials give way to Blizzard's replacements and the notes are named once", () => {
  const { text, structured } = handleClassRaces({ class: "warrior", faction: "alliance" }, withRacialNotes(RACE_TABLE));
  const page = out.parse(structured);
  const dwarf = page.factions[0].races.find((r) => r.name === "Dwarf");
  expect(dwarf?.traits.map((t) => t.name)).toEqual(["Stoneform", "Find Treasure", "Artisan's Precision", "Big Game Hunter"]);
  expect(text).not.toContain("Earth Fury");
  expect(text.split(RACIAL_NOTES.sourceUrl)).toHaveLength(2);
  // The raw files' answer names no notes.
  expect(handleClassRaces({ class: "warrior" }, RACE_TABLE).text).not.toContain(RACIAL_NOTES.sourceUrl);
});
