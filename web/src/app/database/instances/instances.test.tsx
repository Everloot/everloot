import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { edgeDegraded } from "@/lib/cf-edge-cache";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
// Storage is down unless a test hands in sightings: the pages are then built from the game files alone, which is
// where the level comes from.
const state = vi.hoisted(() => ({ seen: { unreachable: true } as Record<string, unknown>, loot: new Map<string, unknown>() }));
vi.mock("@/lib/rollup-compute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rollup-compute")>()),
  loadLootTables: async () => ({ tables: { sources: state.loot, leftOut: 0 }, unreachable: false, dataAsOf: "2026-11-05T00:00:00Z" }),
  loadItemFacts: async () => ({ rates: [], names: [], npcs: [], unreachable: false }),
}));
vi.mock("@/lib/instances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instances")>()),
  loadSightings: async () => state.seen,
}));

import InstancesPage from "./page";
import InstancePage, { generateMetadata as instanceMetadata } from "./[instance]/page";

const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
/** The cells of the list row that links to `href`, in column order. */
const cells = (html: string, href: string) => {
  const row = html.split("<tr").find((r) => r.includes(`href="${href}"`)) ?? "";
  return [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((m) => text(m[1]!).replace(/^\||\|$/g, ""));
};

test("the list has a Level column and starts with the lowest level; a range the files lack is a dash", async () => {
  const html = renderToStaticMarkup(await InstancesPage());
  // A sortable header carries the arrow of the order the list is in.
  const headers = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]!).replace(/[|▲▼]/g, ""));
  expect(headers).toEqual(expect.arrayContaining(["Name", "Type", "Level", "Entered from"]));
  const rows = [...html.matchAll(/href="\/database\/instances\/(\d+)-[a-z0-9-]*"/g)].map((m) => Number(m[1]));
  expect(rows[0]).toBe(389); // Ragefire Chasm, level 13 in the files
  expect(rows.indexOf(389)).toBeLessThan(rows.indexOf(409)); // Molten Core, level 60
  expect(rows.indexOf(409)).toBeLessThan(rows.indexOf(249)); // Onyxia's Lair: the files give no level, so it is last, with the others like it
  const col = headers.indexOf("Level");
  expect(cells(html, "/database/instances/389-ragefire-chasm")[col]).toBe("13");
  expect(cells(html, "/database/instances/409-molten-core")[col]).toBe("60");
  expect(cells(html, "/database/instances/249-onyxia-s-lair")[col]).toBe("–");
});

test("an instance's page title is the database pages' own: the name, then WoW Forever and its kind", async () => {
  const title = async (segment: string) => (await instanceMetadata({ params: Promise.resolve({ instance: segment }) })).title;
  expect(await title("389-ragefire-chasm")).toBe("Ragefire Chasm – WoW Forever dungeon");
  expect(await title("409-molten-core")).toBe("Molten Core – WoW Forever raid");
});

test("an instance's page lists its level in the facts, or a dash when the files give none", async () => {
  const facts = async (segment: string) => text(renderToStaticMarkup(await InstancePage({ params: Promise.resolve({ instance: segment }) })));
  expect(await facts("389-ragefire-chasm")).toMatch(/\|Level\|13\|/);
  expect(await facts("409-molten-core")).toMatch(/\|Level\|60\|/);
  expect(await facts("249-onyxia-s-lair")).toMatch(/\|Level\|–\|/);
});

test("with storage down, an instance's page lists the bosses the game files give it, each marked unconfirmed; the list shows their count", async () => {
  const html = renderToStaticMarkup(await InstancePage({ params: Promise.resolve({ instance: "409-molten-core" }) }));
  const bosses = html.split('id="bosses"')[1] ?? "";
  expect(bosses).toContain("Ragnaros");
  expect(bosses.indexOf("Lucifron")).toBeLessThan(bosses.indexOf("Ragnaros")); // the files' order
  const rows = bosses.split("<tr").slice(2); // the header row and the caption split
  expect(rows.length).toBeGreaterThan(5);
  for (const r of rows) expect(r).toContain('data-badge="files"');
  // No row has a report, so the report columns are left out rather than filled with [?].
  const headers = [...bosses.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]!).replace(/\|/g, ""));
  expect(headers).toEqual(["Boss"]);
  for (const r of rows) expect(r).not.toContain("[?]");
  // The entrance the files give is labelled as such, beside the line saying none is confirmed.
  expect(text(html.split('id="entrance"')[1] ?? "")).toContain("in the game files, not confirmed by players");
  expect(text(html)).toMatch(/\|Bosses reported\|\[\?\]\|unconfirmed\|in the files, 11\|/);
  const list = renderToStaticMarkup(await InstancesPage());
  const col = [...list.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]!).replace(/\|/g, "")).indexOf("Bosses");
  expect(cells(list, "/database/instances/409-molten-core")[col]).toMatch(/unconfirmed\|11$/);
  // Both renders are marked for the edge cache, which keeps them a minute rather than an hour.
  expect(edgeDegraded(html)).toBe(true);
  expect(edgeDegraded(list)).toBe(true);
});

test("on night one, each boss one install reported shows 1 of 3, and nothing it reported reads as confirmed", async () => {
  // SYNTHETIC: one install killed each of Ragefire Chasm's four encounters once.
  const encounters = [2732, 2733, 2734, 2735].map((encounterId) => ({ installId: "install-a", encounterId, name: "Reported name", instanceMapId: 389, success: true, npcIds: [1], capturedAt: "2026-11-04T20:00:00Z" }));
  state.seen = { unreachable: false, asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters } };
  try {
    const html = renderToStaticMarkup(await InstancePage({ params: Promise.resolve({ instance: "389-ragefire-chasm" }) }));
    const bosses = html.split('id="bosses"')[1] ?? "";
    // The files' names stay, marked unconfirmed; the one install's name, kills and dates are not shown.
    for (const r of bosses.split("<tr").slice(2)) expect(r).toContain('data-badge="files"');
    expect(bosses).not.toContain("Reported name");
    const headers = [...bosses.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]!).replace(/\|/g, ""));
    expect(headers).toEqual(["Boss", "Installs"]);
    const row = bosses.split("<tr").find((r) => r.includes("Oggleflint")) ?? "";
    expect(row).toContain('data-agreement="1"');
    expect(text(row)).toContain("|1 of 3|");
    expect(text(row)).toContain("1 of 3 installs reported");
    expect(text(bosses)).toContain("No boss here has 3 installs reporting it yet. Kills and last seen show once one does.");
    expect(text(html)).toMatch(/\|Bosses reported\|0\|/);
  } finally {
    state.seen = { unreachable: true };
  }
});

test("an instance's page links its prep page only when a published wiki page binds it; a draft gets no link", async () => {
  vi.stubEnv("WIKI_DIR", fileURLToPath(new URL("../../../test/wiki", import.meta.url)));
  try {
    const page = async (segment: string) => renderToStaticMarkup(await InstancePage({ params: Promise.resolve({ instance: segment }) }));
    // The published fixture binds the Deadmines; the draft fixture binds Ragefire Chasm.
    expect(await page("36-deadmines")).toContain('<a href="/wiki/test-dungeon">Prepare for this dungeon</a>');
    const draft = await page("389-ragefire-chasm");
    expect(draft).not.toContain("Prepare for this");
    expect(draft).not.toContain("/wiki/");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("with the wiki unreadable, an instance's page still renders, with no prep link", async () => {
  vi.stubEnv("WIKI_DIR", fileURLToPath(new URL("./no-such-wiki", import.meta.url)));
  try {
    const html = renderToStaticMarkup(await InstancePage({ params: Promise.resolve({ instance: "36-deadmines" }) }));
    expect(html).toContain("Bosses");
    expect(html).not.toContain("Prepare for this");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("the list's Guide column links a published prep page and, for a raid, the raid builder; a draft gets no link", async () => {
  vi.stubEnv("WIKI_DIR", fileURLToPath(new URL("../../../test/wiki", import.meta.url)));
  try {
    const html = renderToStaticMarkup(await InstancesPage());
    const headers = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]!).replace(/\|/g, ""));
    const col = headers.indexOf("Guide");
    expect(col).toBeGreaterThan(-1);
    expect(cells(html, "/database/instances/409-molten-core")[col]).toContain("Raid builder");
    const row = (href: string) => html.split("<tr").find((r) => r.includes(`href="${href}"`)) ?? "";
    expect(row("/database/instances/409-molten-core")).toContain('href="/tools/raid"');
    expect(row("/database/instances/389-ragefire-chasm")).not.toContain('href="/tools/raid"');
    // The published fixture binds the Deadmines; the draft fixture binds Ragefire Chasm.
    expect(row("/database/instances/36-deadmines")).toContain('href="/wiki/test-dungeon"');
    expect(row("/database/instances/389-ragefire-chasm")).not.toContain("/wiki/");
  } finally {
    vi.unstubAllEnvs();
  }
});

// SYNTHETIC: three installs killed one Ragefire Chasm encounter and tie the same creature to it.
const INSTALLS = ["install-a", "install-b", "install-c"];
const killed = (instanceMapId: number, encounterId: number, npcId: number) =>
  INSTALLS.map((installId) => ({ installId, encounterId, name: "Oggleflint", instanceMapId, success: true, npcIds: [npcId], capturedAt: "2026-11-04T20:00:00Z" }));
/** Loot windows on one creature: `windows` from each install, every one holding item 14149. */
const looted = (npcId: number, installs: string[], windows: number) => new Map([[`npc:${npcId}`, {
  windows: windows * installs.length, installs: new Set(installs), first: "2026-11-03T20:00:00Z", last: "2026-11-04T20:00:00Z",
  items: new Map([[14149, { windows: windows * installs.length, installs: new Set(installs) }]]),
}]]);
const lootOf = async (segment: string) => (renderToStaticMarkup(await InstancePage({ params: Promise.resolve({ instance: segment }) })).split('id="loot"')[1] ?? "");

test("an instance's page lists each boss's loot: the creature's own loot table, linked to the items", async () => {
  state.seen = { unreachable: false, asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters: killed(389, 2732, 11517) } };
  state.loot = looted(11517, INSTALLS, 2);
  try {
    const loot = await lootOf("389-ragefire-chasm");
    expect(text(loot)).toContain("|Oggleflint|");
    expect(loot).toContain('href="/database/npcs/11517"');
    const row = loot.split("<tr").find((r) => r.includes('href="/database/items/14149"')) ?? "";
    // Six windows, all six holding the item, from 3 installs.
    expect(text(row)).toMatch(/\|6\|6\|100(\.0)?%\|3\|/);
    expect(text(loot)).toContain("Data as of 2026-11-05.");
  } finally {
    state.seen = { unreachable: true };
    state.loot = new Map();
  }
});

test("a boss whose creature fewer than 3 installs looted shows how many did and no item; one nobody looted says so", async () => {
  state.seen = { unreachable: false, asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters: killed(389, 2732, 11517) } };
  state.loot = looted(11517, ["install-a"], 2);
  try {
    const short = await lootOf("389-ragefire-chasm");
    expect(short).toContain('data-agreement="1"');
    expect(text(short)).toContain("A rate needs windows from 3 installs: 2 more.");
    expect(short).not.toContain("/database/items/");
    state.loot = new Map();
    expect(text(await lootOf("389-ragefire-chasm"))).toContain("Nobody has looted this NPC in Forever yet.");
  } finally {
    state.seen = { unreachable: true };
    state.loot = new Map();
  }
});

test("the loot section says what is missing when no boss has 3 installs, and that storage is down when it is", async () => {
  state.seen = { unreachable: false, asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters: killed(389, 2732, 11517).slice(0, 1) } };
  state.loot = looted(11517, INSTALLS, 2);
  try {
    const none = await lootOf("389-ragefire-chasm");
    expect(text(none)).toContain("No loot to show yet: no boss here has a creature 3 installs agree on.");
    expect(none).not.toContain("/database/items/");
  } finally {
    state.seen = { unreachable: true };
    state.loot = new Map();
  }
  const down = await lootOf("389-ragefire-chasm");
  expect(text(down)).toContain("Storage unreachable.");
  expect(down).not.toContain("<table");
});

test("the list labels an instance the game files place no entrance for, with the reason in the name cell's title", async () => {
  // SYNTHETIC: three installs killed a boss in instance 2999, for which the files place no entrance.
  state.seen = { unreachable: false, asOf: new Date("2026-11-05T00:00:00Z"), instances: { entrances: [], encounters: killed(2999, 3353, 1) } };
  try {
    const html = renderToStaticMarkup(await InstancesPage());
    const row = html.split("<tr").find((r) => r.includes('href="/database/instances/2999"')) ?? "";
    expect(text(row)).toContain("|Instance 2999|no entrance in the game files|");
    expect(row).toMatch(/title="The game files place no entrance for this instance[^"]*"/);
    // A named instance carries no such label.
    expect(html.split("<tr").find((r) => r.includes('href="/database/instances/389-ragefire-chasm"'))).not.toContain("no entrance in the game files");
  } finally {
    state.seen = { unreachable: true };
  }
});
