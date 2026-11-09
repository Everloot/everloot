import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { writeOpenData } from "../../../kb/src/open-data/write";
import { readOpenDataGameFiles } from "../../../kb/src/open-data/game-data";
import { loadOpenData } from "./open-data";

const BASE = "https://data.example.test";
const STAMP = "2026-10-22T04-57-00-000Z";
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A real manifest, made by the real writer from three installs that agree on one NPC. */
function manifest(): unknown {
  const dir = join(mkdtempSync(join(tmpdir(), "everloot-open-data-web-")), "out");
  dirs.push(join(dir, ".."));
  const at = "2026-10-10T12:00:00.000Z";
  const bounds = { left: 1, top: 1, right: -1, bottom: -1 };
  writeOpenData(dir, {
    records: ["a", "b", "c"].map((id) => ({ kind: "npc_sighting", installId: `inst-${id}-00`, eventId: `e-${id}`, capturedAt: at, npcId: 5, name: "Hogger", mapId: 1429, x: 1, y: 1, positionKind: "interaction", role: "vendor" })),
    dataAsOf: at, generatedAt: "2026-10-22T04:57:00.000Z",
    gameFiles: {
      build: { version: "1.60.1.70450", extractedAt: at }, edges: [], taxonomy: { classes: [], subclasses: [], items: [] },
      map: { schema: "everloot.world-map/1", source: { name: "x", status: "found in game files, unconfirmed", licence: "x", licenceUrl: "x", product: "x", buildId: 1, version: "1", buildConfig: "x", definitions: null, extractedAt: at, tables: [] }, continents: [{ id: 0, name: "K", bounds }], zones: [], heldBackZones: [], entrances: [], flightNodes: [], flightPaths: [], warnings: [] },
      catalogs: readOpenDataGameFiles(join(__dirname, "..", "data", "game-data")),
    },
  });
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
}

const served = (files: Record<string, unknown>) => async (url: string | URL | Request) => {
  const path = String(url).replace(`${BASE}/`, "");
  return path in files ? new Response(JSON.stringify(files[path]), { status: 200 }) : new Response("", { status: 404 });
};

test("no bucket address, or no pointer yet, is the none state", async () => {
  expect(await loadOpenData(null, served({}) as typeof fetch)).toEqual({ state: "none" });
  expect(await loadOpenData(BASE, served({}) as typeof fetch)).toEqual({ state: "none" });
});

test("the pointer names a folder and the page reads that folder's manifest", async () => {
  const m = manifest();
  const state = await loadOpenData(BASE, served({
    "open-data/latest.json": { stamp: STAMP, manifest: `open-data/${STAMP}/manifest.json` },
    [`open-data/${STAMP}/manifest.json`]: m,
  }) as typeof fetch);
  expect(state).toMatchObject({ state: "ok", stamp: STAMP, base: `${BASE}/open-data/${STAMP}` });
  if (state.state === "ok") expect(state.manifest.files.find((f) => f.path === "observed/npcs.ndjson")).toMatchObject({ rows: 1, candidates: 1 });
});

test("a pointer to anything but its own manifest, a manifest that does not parse and a failing fetch are unreachable, never empty", async () => {
  const m = manifest();
  const pointer = (manifest: string, stamp = STAMP) => ({ "open-data/latest.json": { stamp, manifest }, [`open-data/${STAMP}/manifest.json`]: m, "elsewhere/manifest.json": m });
  expect(await loadOpenData(BASE, served(pointer("elsewhere/manifest.json")) as typeof fetch)).toEqual({ state: "unreachable" });
  expect(await loadOpenData(BASE, served(pointer("../x/manifest.json", "../x")) as typeof fetch)).toEqual({ state: "unreachable" });
  expect(await loadOpenData(BASE, served({ "open-data/latest.json": { stamp: STAMP, manifest: `open-data/${STAMP}/manifest.json` }, [`open-data/${STAMP}/manifest.json`]: { schema: "nope" } }) as typeof fetch)).toEqual({ state: "unreachable" });
  expect(await loadOpenData(BASE, (async () => { throw new Error("down"); }) as typeof fetch)).toEqual({ state: "unreachable" });
  expect(await loadOpenData(BASE, (async () => new Response("", { status: 503 })) as typeof fetch)).toEqual({ state: "unreachable" });
});
