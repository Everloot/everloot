import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

/**
 * Stored keyed census rows, read by the real store, rolled up by loadCensus, and published by the page and the
 * MCP tool. The address rule is the point: a cell needs 3 addresses (`reporter`) as well as 3 installs and 10
 * characters, and no key, install id or address reaches either output.
 */
const holder = vi.hoisted(() => ({ store: null as unknown as { loadCensus: () => Promise<unknown> } }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCensus: () => holder.store.loadCensus() },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

import CensusPage from "../app/census/page";
import { populationAnswer } from "@kb/population";
import { CENSUS_RACES } from "@kb/census";
import { toolLoaders } from "./mcp-mount";
import { loadCensus } from "./rollup-compute";
import { createUploadStore } from "./upload-store";

const NOW = () => new Date("2026-11-16T12:00:00Z");
const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");

/** A stored row as intake writes it: the GUID is gone, replaced by a character key, and the sender's address is a keyed hash. */
function stored(i: number, over: Record<string, unknown>, address: string | undefined) {
  const characterKey = hex(i + 1, 4).padEnd(64, "e");
  return {
    kind: "census_seen", installId: `install-${"abc"[i % 3]}`, eventId: `census_seen:2026-11-15:${characterKey.slice(0, 24)}`,
    capturedAt: "2026-11-15T10:00:00.000Z", characterKey, serverId: 4395, race: "Human", class: "HUNTER", level: 30,
    faction: "Alliance", via: "target", ...(address ? { reporter: address } : {}), ...over,
  };
}

function writeUploads(rows: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "everloot-census-"));
  mkdirSync(join(dir, "uploads"));
  writeFileSync(join(dir, "uploads", "u.json"), JSON.stringify({ addonVersion: "0.4.0", records: rows }));
  return dir;
}

const A = ["aaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaa2", "aaaaaaaaaaaaaaa3"];
const COMBOS = CENSUS_RACES.flatMap((r) => r.classes.map((c) => ({ faction: r.faction, race: r.token, class: c })));
const special = (c: { faction: string; race: string; class: string }) =>
  (c.race === "Orc" && c.class === "HUNTER") || (c.race === "Dwarf" && c.class === "PRIEST");
const ROWS = [
  // 15 characters in every playable combination, from three installs and three addresses: shows.
  ...COMBOS.filter((c) => !special(c)).flatMap((c, k) => Array.from({ length: 15 }, (_, i) => stored(k * 20 + i, c, A[i % 3]))),
  // 20 Orc Hunters from three installs but one address: hidden.
  ...Array.from({ length: 20 }, (_, i) => stored(1000 + i, { race: "Orc", class: "HUNTER", faction: "Horde" }, "bbbbbbbbbbbbbbb1")),
  // 12 Dwarf Priests from three installs with no address recorded: counts toward installs, not addresses, so hidden.
  ...Array.from({ length: 12 }, (_, i) => stored(2000 + i, { race: "Dwarf", class: "PRIEST" }, undefined)),
];

test("stored keyed rows reach the page and the tool through the real store, with the address rule applied", async () => {
  holder.store = createUploadStore({ cloud: null, localDir: writeUploads(ROWS), now: NOW, cacheMs: 0 });

  const { view, unreachable } = await loadCensus();
  expect(unreachable).toBe(false);
  const week = view!.windows.week;
  expect(week.installs).toBe(3);
  const cellOf = (race: string, cls: string, faction: string) => week.raceClass.find((c) => c.race === race && c.class === cls && c.faction === faction)!.count;
  expect(cellOf("Human", "HUNTER", "Alliance")).toBe(15);
  expect(cellOf("Orc", "HUNTER", "Horde")).toBeNull();
  expect(cellOf("Dwarf", "PRIEST", "Alliance")).toBeNull();
  // The factions are large and from three addresses, so they show.
  expect(week.factions.every((f) => f.count !== null)).toBe(true);

  const answer = populationAnswer({ window: "week", race: "Orc", class: "Hunter" }, view!);
  expect(answer.text).toContain("Orc Hunter (Horde): not enough reports");
  expect(answer.text).toContain("from at least 3 addresses");
  const human = populationAnswer({ window: "week", race: "Human", class: "Hunter" }, view!);
  expect(human.text).toContain("Human Hunter (Alliance): about 15 characters");

  // The tool's own loader reads the same census, and the page prints it.
  const loaded = await toolLoaders().census!();
  expect(loaded?.view.windows.week.raceClass).toEqual(week.raceClass);
  const html = renderToStaticMarkup(await CensusPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("not enough reports");
  expect(html).toContain("from at least 3 addresses");

  for (const out of [JSON.stringify(view), JSON.stringify(answer), JSON.stringify(human), html]) {
    expect(out).not.toMatch(/[0-9a-f]{16}/);
    expect(out).not.toMatch(/install-[abc]|characterKey|reporter/);
  }
});

test("the same crowd from one address is still collecting, however many installs it has", async () => {
  const oneAddress = Array.from({ length: 30 }, (_, i) => stored(i, {}, "ccccccccccccccc1"));
  holder.store = createUploadStore({ cloud: null, localDir: writeUploads(oneAddress), now: NOW, cacheMs: 0 });
  const { view } = await loadCensus();
  expect(view!.windows.week).toMatchObject({ collecting: true, characters: null, installs: 3 });
  const html = renderToStaticMarkup(await CensusPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Still collecting");
});

test("an unreadable store is unavailable, not zero", async () => {
  holder.store = { loadCensus: async () => ({ rows: [], dataAsOf: null, unreachable: true }) };
  expect(await loadCensus()).toEqual({ view: null, unreachable: true, dataAsOf: null });
  expect(await toolLoaders().census!()).toBeNull();
});
