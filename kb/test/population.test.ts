import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { MCP_TOOLS, PLAYER_DATA_TOOLS } from "@everloot/protocol";
import { CENSUS_LAUNCH, CENSUS_RACES, rollupCensus, type CensusRow } from "../src/census.js";
import { openDb } from "../src/db.js";
import { createKnowledgeServer } from "../src/mcp-server.js";
import { CENSUS_UNSET, populationAnswer, type CensusLoader, type PopulationArgs } from "../src/population.js";

const AS_OF = "2026-11-16T12:00:00.000Z";

let seq = 0;
/** `n` characters of one race and class, reported by three installs in turn. */
const crowd = (n: number, prefix: string, over: Partial<CensusRow> = {}): CensusRow[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: "census_seen", installId: `install-${"abc"[i % 3]}`, eventId: `census_seen:2026-11-15:${(++seq).toString(16)}`,
    capturedAt: "2026-11-15T10:00:00.000Z", characterKey: `${prefix}${i.toString(16).padStart(4, "0")}`, serverId: 4,
    reporter: `${"abc"[i % 3].charCodeAt(0).toString(16)}`.padStart(16, "0"),
    race: "Gnome", class: "PRIEST", level: 20 + (i % 40), faction: "Alliance", via: "target", ...over,
  }) as CensusRow);

/** Twenty characters of every playable combination but Undead Paladin, which has four; and sixty more Human Hunters. */
const ROWS = [
  ...CENSUS_RACES.flatMap((r, k) => r.classes
    .filter((c) => !(r.token === "Scourge" && c === "PALADIN"))
    .map((c) => crowd(20, `r${k}${c.toLowerCase()}`, { faction: r.faction, race: r.token, class: c, ...(k % 2 ? {} : { kind: "census_self", realm: "Forever", via: undefined }) })))
    .flat(),
  ...crowd(4, "up", { race: "Scourge", class: "PALADIN", faction: "Horde" }),
  ...crowd(60, "hh", { race: "Human", class: "HUNTER" }),
];
const VIEW = rollupCensus(ROWS, { asOf: AS_OF, launch: CENSUS_LAUNCH });
const QUIET = rollupCensus(crowd(5, "q"), { asOf: AS_OF, launch: CENSUS_LAUNCH });
const BEFORE = rollupCensus(crowd(30, "b", { capturedAt: "2026-10-18T10:00:00.000Z" }), { asOf: "2026-10-18T12:00:00.000Z", launch: CENSUS_LAUNCH });
const WEEK = "characters active in the last 7 days (2026-11-10 to 2026-11-16 UTC)";

const ask = (args: Partial<PopulationArgs>, view = VIEW) => populationAnswer({ window: "week", ...args }, view);

test("most played class: the classes ranked, the window and the rule stated", () => {
  const { text, page } = ask({});
  expect(text).toContain(WEEK);
  expect(text).toContain("Most played class: Hunter, about 220");
  expect(text).toContain("at least 10 characters reported by at least 3 installs");
  expect(text).toContain("https://everloot.app/methodology#population");
  expect(page).toMatchObject({ launched: true, collecting: false, characters: 1165 });
  expect(page.window).toEqual({ id: "week", from: "2026-11-10T00:00:00.000Z", to: AS_OF });
  const classes = page.cells.filter((c) => c.slice === "class");
  expect(classes[0]).toMatchObject({ class: "HUNTER", label: "Hunter", count: 220, share: 0.189 });
});

test("how rare are Gnome Priests: the race and class cell with its share", () => {
  const { text, page } = ask({ race: "gnomes", class: "Priests" });
  expect(text).toContain(WEEK);
  expect(text).toContain("Gnome Priest (Alliance): about 20 characters, 1.7% of about 1,165");
  expect(page.cells).toEqual([{ slice: "raceClass", faction: "Alliance", race: "Gnome", class: "PRIEST", label: "Gnome Priest (Alliance)", count: 20, share: 0.017 }]);
});

test("a hidden count reads not enough reports, with what that means, never a number", () => {
  const { text, page } = ask({ race: "Undead", class: "Paladin" });
  expect(text).toContain("Undead Paladin (Horde): not enough reports");
  expect(text).toContain('"not enough reports" means fewer than 10 characters, fewer than 3 installs or fewer than 3 addresses, or hidden so that a small count');
  expect(text).not.toMatch(/Undead Paladin \(Horde\): about/);
  expect(text).not.toContain("Undead Paladin (Horde): fewer than 10");
  expect(page.cells[0]).toMatchObject({ count: null, share: null });
});

test("Skyborne plays on both factions: each side is its own cell", () => {
  const { page } = ask({ race: "Skyborne", class: "Hunter" });
  expect(page.cells.map((c) => [c.faction, c.count])).toEqual([["Horde", 20], ["Alliance", 20]]);
  expect(ask({ race: "Skyborne", class: "Hunter", faction: "Horde" }).page.cells).toHaveLength(1);
});

test("a class on one faction lists that faction's races", () => {
  expect(ask({ class: "Hunter", faction: "Horde" }).page.cells.map((c) => c.race)).toEqual(["Orc", "Tauren", "Troll", "Skyborne"]);
});

test("a race, a class or a faction on its own", () => {
  expect(ask({ race: "Undead" }).page.cells).toEqual([{ slice: "race", faction: "Horde", race: "Scourge", label: "Undead (Horde)", count: 105, share: 0.09 }]);
  expect(ask({ class: "WARRIOR" }).page.cells[0]).toMatchObject({ slice: "class", count: 200 });
  expect(ask({ faction: "Horde" }).page.cells[0]).toMatchObject({ slice: "faction", faction: "Horde", count: 545 });
});

test("a combination the game does not have, or a name it does not know, says so", () => {
  const orc = ask({ race: "Orc", class: "Paladin" });
  expect(orc.text).toContain("Orc Paladin is not a playable combination in WoW: Forever");
  expect(orc.page.cells).toEqual([]);
  expect(ask({ race: "Orc", faction: "Alliance" }).text).toContain("Orc is not an Alliance race");
  expect(ask({ race: "Dwarf", faction: "Horde" }).text).toContain("Dwarf is not a Horde race");
  const unknown = ask({ race: "Pandaren" });
  expect(unknown.text).toContain('No race called "Pandaren"');
  expect(unknown.text).toContain("Night Elf");
  expect(ask({ class: "Monk" }).text).toContain('No class called "Monk"');
});

test("while collecting, the answer says so and names the window and how many installs have reported", () => {
  const { text, page } = ask({ race: "Gnome", class: "Priest" }, QUIET);
  expect(text).toContain(WEEK);
  expect(text).toContain("Still collecting");
  expect(text).toContain("3 installs have reported");
  expect(text).not.toMatch(/about \d/);
  expect(page).toMatchObject({ collecting: true, characters: null });
  expect(page.cells.every((c) => c.count === null)).toBe(true);
});

test("before launch, the answer says the game has not launched and gives no date range", () => {
  for (const window of ["week", "launch"] as const) {
    const { text, page } = ask({ window }, BEFORE);
    expect(text).toContain("WoW: Forever has not launched yet: counting starts at launch (2026-11-04 23:00 UTC)");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    expect(text).not.toContain("Still collecting");
    expect(page).toMatchObject({ launched: false, launch: CENSUS_LAUNCH, collecting: true, characters: null });
    expect(Date.parse(page.window.from)).toBeLessThanOrEqual(Date.parse(page.window.to));
  }
});

test("since launch is its own window, stated in the answer", () => {
  const { text, page } = ask({ window: "launch" });
  expect(text).toContain("characters seen since launch (2026-11-04 to 2026-11-16 UTC)");
  expect(page.window.id).toBe("launch");
});

test("the answer names its source and carries no character key or install id", () => {
  const { text, page } = ask({});
  expect(page.source).toEqual({ title: "Everloot census", url: "https://everloot.app/census" });
  const json = JSON.stringify(page);
  for (const r of ROWS) {
    expect(text).not.toContain(r.characterKey);
    expect(json).not.toContain(r.installId);
  }
});

const connect = async (census?: CensusLoader) => {
  const server = createKnowledgeServer(openDb(":memory:"), census ? { census } : {});
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
};

test("over MCP: the protocol's tool, answering text with the data age and credit, and structured content of its schema", async () => {
  expect(PLAYER_DATA_TOOLS).toContain("population");
  const client = await connect(async () => ({ view: VIEW, dataAsOf: AS_OF }));
  const tool = (await client.listTools()).tools.find((t) => t.name === "population")!;
  expect(tool.title).toBe(MCP_TOOLS.population.title);
  expect(tool.annotations?.readOnlyHint).toBe(true);
  expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(["class", "faction", "race", "window"]);
  expect(tool.outputSchema).toBeDefined();
  const answer = await client.callTool({ name: "population", arguments: { race: "Gnome", class: "Priest" } });
  const text = (answer.content as { text: string }[])[0].text;
  expect(text).toContain(WEEK);
  expect(text.endsWith("Data as of 2026-11-16 12:00 UTC.")).toBe(true);
  const structured = z.object(MCP_TOOLS.population.outputSchema).parse(answer.structuredContent);
  expect(structured).toMatchObject({ connected: true, dataAsOf: AS_OF, url: "https://everloot.app/census", page: { characters: 1165, cells: [{ count: 20 }] } });
  expect(text).toContain("More: https://everloot.app/census\nData as of");
  const launch = await client.callTool({ name: "population", arguments: { window: "launch" } });
  expect(launch.structuredContent).toMatchObject({ url: "https://everloot.app/census?window=launch" });
  await client.close();
});

test("over MCP: not connected and unavailable are said, never shown as zero", async () => {
  const off = await connect();
  const unset = await off.callTool({ name: "population", arguments: {} });
  expect((unset.content as { text: string }[])[0].text).toBe(CENSUS_UNSET);
  expect(unset.structuredContent).toEqual({ connected: false, dataAsOf: null, reason: CENSUS_UNSET });
  await off.close();
  const broken = await connect(async () => null);
  const down = await broken.callTool({ name: "population", arguments: {} });
  expect((down.content as { text: string }[])[0].text).toContain("unrecorded, not zero");
  expect(down.structuredContent).toMatchObject({ connected: false, dataAsOf: null });
  await broken.close();
});
