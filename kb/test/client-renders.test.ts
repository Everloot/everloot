import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AssetChecksums } from "../src/client-assets.js";
import type { FileStatus, TableSource } from "../src/client-extract.js";
import { buildRendersFromTables, RenderManifest, type RenderIo } from "../src/client-renders.js";
import type { Row, Rows } from "../src/talents/build-catalog.js";
import type { BuildStamp } from "../src/talents/catalog.js";
import { buildM2, buildSkin } from "./fixtures/m2-fixture.js";

// Made-up ids and files; nothing here is from a real build.
const build: BuildStamp = { product: "wowf", buildId: 71139, version: "1.60.1.71139", buildConfig: "7a16decd".padEnd(32, "0"), definitions: null, extractedAt: "2026-11-25T00:00:00.000Z" };
const t = (rows: Row[]): Rows => new Map(rows.map((r, i) => [typeof r.ID === "number" ? r.ID : i + 1, r]));
const tables: Record<string, Rows> = {
  // NPC 10 and 11 stand on displays 501 and 502 (502's skin is encrypted); NPC 99 is not on the site's list.
  Creature: t([{ ID: 10, DisplayID: [501, 0, 0, 0] }, { ID: 11, DisplayID: [502, 0, 0, 0] }, { ID: 99, DisplayID: [503, 0, 0, 0] }]),
  CreatureDisplayInfo: t([
    { ID: 501, ModelID: 1, ExtendedDisplayInfoID: 0, TextureVariationFileDataID: [6001, 0, 0, 0] },
    { ID: 502, ModelID: 1, ExtendedDisplayInfoID: 0, TextureVariationFileDataID: [6002, 0, 0, 0] },
    { ID: 503, ModelID: 2, ExtendedDisplayInfoID: 0, TextureVariationFileDataID: [6001, 0, 0, 0] },
  ]),
  CreatureModelData: t([{ ID: 1, FileDataID: 5001 }, { ID: 2, FileDataID: 5099 }]),
  ItemModifiedAppearance: t([{ ID: 1, ItemID: 20, ItemAppearanceModifierID: 0, ItemAppearanceID: 30, OrderIndex: 0 }]),
  ItemAppearance: t([{ ID: 30, ItemDisplayInfoID: 700 }]),
  ItemDisplayInfo: t([{ ID: 700, ModelResourcesID: [40, 0], ModelMaterialResourcesID: [80, 0] }]),
  ModelFileData: t([{ ID: 1, FileDataID: 5100, ModelResourcesID: 40 }]),
  ComponentModelFileData: t([]),
  TextureFileData: t([{ ID: 1, FileDataID: 6100, MaterialResourcesID: 80, UsageType: 0 }]),
};
const get = (name: string) => tables[name];

const quad = { vertices: [{ pos: [0, -1, 0] as [number, number, number] }, { pos: [0, 1, 0] as [number, number, number] }, { pos: [0, 1, 2] as [number, number, number] }, { pos: [0, -1, 2] as [number, number, number] }] };
const skin = buildSkin({ vertexMap: [0, 1, 2, 3], indices: [0, 1, 2, 0, 2, 3], sections: [{ id: 0, indexStart: 0, indexCount: 6 }], batches: [{ section: 0, material: 0, textureCombo: 0 }] });
const files: Record<number, Buffer> = {
  5001: buildM2({ ...quad, textures: [{ type: 11 }], materials: [{ blend: 0 }], textureCombos: [0], skins: [8001] }).file,
  5100: buildM2({ ...quad, textures: [{ type: 2 }], materials: [{ blend: 0 }], textureCombos: [0], skins: [8001] }).file,
  8001: skin,
  6001: Buffer.from("blp 6001"), 6002: Buffer.from("blp 6002"), 6100: Buffer.from("blp 6100"),
};
const status: Record<number, FileStatus> = { 6002: "encrypted" };

function source(reads: number[], keys: Record<number, string> = {}): TableSource {
  return {
    async read() { return null; },
    fileStatus: (id) => status[id] ?? (files[id] ? "present" : "absent"),
    async readFile(id) { reads.push(id); return files[id] ? { cKey: keys[id] ?? `key-${id}`, buffer: files[id], encryptedBlocks: 0 } : null; },
  };
}

/** Stands in for Pillow: every texture decodes to 2 x 2 red, every picture "encodes" by copying the raw file. */
function fakeIo(calls: { decode: number; encode: number }): RenderIo {
  return {
    async decode(jobs) {
      calls.decode += jobs.length;
      const { writeFileSync } = await import("node:fs");
      return jobs.map((j) => {
        const raw = Buffer.alloc(8 + 16); raw.writeUInt32LE(2, 0); raw.writeUInt32LE(2, 4);
        for (let i = 0; i < 4; i++) raw.set([255, 0, 0, 255], 8 + 4 * i);
        writeFileSync(j.dst, raw);
        return { dst: j.dst, ok: true, width: 2, height: 2, error: null };
      });
    },
    async encode(jobs) {
      calls.encode += jobs.length;
      return jobs.map((j) => { copyFileSync(j.src, j.dst); return { dst: j.dst, ok: true, width: j.size, height: j.size, error: null }; });
    },
  };
}

const gates = { npcs: new Set([10, 11]), items: new Set([20]) };

describe("buildRendersFromTables", () => {
  test("draws the gated displays, names each picture by a hash of its inputs and writes the manifest and checksums", async () => {
    const out = mkdtempSync(join(tmpdir(), "renders-"));
    const reads: number[] = [];
    const calls = { decode: 0, encode: 0 };
    const run = await buildRendersFromTables({ get, build, outDir: out, source: source(reads), gates, io: fakeIo(calls), drawSize: 16, size: 8 });
    const manifest = RenderManifest.parse(JSON.parse(readFileSync(join(run.dir, "renders.json"), "utf8")));
    expect(run.dir).toBe(join(out, "wowf-71139-7a16decd"));
    expect(Object.keys(manifest.creatureDisplays)).toEqual(["501"]);
    expect(Object.keys(manifest.itemDisplays)).toEqual(["700"]);
    expect(manifest.creatureDisplays["501"]).toMatch(/^renders\/[0-9a-f]{32}\.webp$/);
    expect(manifest.npcs).toEqual({ 10: 501 });
    expect(manifest.items).toEqual({ 20: 700 });
    expect(manifest.counts).toMatchObject({ planned: 3, made: 2, reused: 0, encrypted: 1, absent: 0, failed: 0 });
    expect(manifest.skipped).toEqual(["creature display 502: texture file 6002 is encrypted"]);
    // Nothing outside the gate is read, and an encrypted file is never fetched.
    expect(reads).not.toContain(5099);
    expect(reads).not.toContain(6002);
    const sums = AssetChecksums.parse(JSON.parse(readFileSync(join(run.dir, "checksums.json"), "utf8")));
    expect(Object.keys(sums.files).sort()).toEqual([manifest.creatureDisplays["501"], manifest.itemDisplays["700"]].sort());
    for (const f of Object.keys(sums.files)) expect(existsSync(join(out, f))).toBe(true);
    expect(calls).toEqual({ decode: 2, encode: 2 });
  });

  test("a second run with the same files reuses the pictures; a changed file gives a new name", async () => {
    const out = mkdtempSync(join(tmpdir(), "renders-"));
    const first = await buildRendersFromTables({ get, build, outDir: out, source: source([]), gates, io: fakeIo({ decode: 0, encode: 0 }), drawSize: 16, size: 8 });
    const calls = { decode: 0, encode: 0 };
    const again = await buildRendersFromTables({ get, build: { ...build, buildId: 71200, buildConfig: "8".repeat(32) }, outDir: out, source: source([]), gates, io: fakeIo(calls), drawSize: 16, size: 8 });
    expect(again.manifest.counts).toMatchObject({ made: 0, reused: 2 });
    expect(again.manifest.creatureDisplays).toEqual(first.manifest.creatureDisplays);
    expect(calls).toEqual({ decode: 0, encode: 0 });
    const changed = await buildRendersFromTables({ get, build, outDir: out, source: source([], { 6001: "new-skin" }), gates, io: fakeIo(calls), drawSize: 16, size: 8 });
    expect(changed.manifest.creatureDisplays["501"]).not.toBe(first.manifest.creatureDisplays["501"]);
    expect(changed.manifest.itemDisplays).toEqual(first.manifest.itemDisplays);
  });

  test("with no gate lists nothing is drawn or read", async () => {
    const reads: number[] = [];
    const run = await buildRendersFromTables({ get, build, outDir: mkdtempSync(join(tmpdir(), "renders-")), source: source(reads), gates: { npcs: new Set(), items: new Set() }, io: fakeIo({ decode: 0, encode: 0 }), drawSize: 16, size: 8 });
    expect(run.manifest.counts.planned).toBe(0);
    expect(reads).toEqual([]);
  });

  test("a model the reader cannot parse is counted as failed, not drawn", async () => {
    const broken: Record<number, Buffer> = { ...files, 5100: Buffer.from("MD21\x04\x00\x00\x00MD20") };
    const src: TableSource = { ...source([]), async readFile(id) { return broken[id] ? { cKey: `k${id}`, buffer: broken[id], encryptedBlocks: 0 } : null; } };
    const run = await buildRendersFromTables({ get, build, outDir: mkdtempSync(join(tmpdir(), "renders-")), source: src, gates: { npcs: new Set(), items: new Set([20]) }, io: fakeIo({ decode: 0, encode: 0 }), drawSize: 16, size: 8 });
    expect(run.manifest.counts).toMatchObject({ made: 0, failed: 1 });
    expect(run.manifest.skipped[0]).toMatch(/^item display 700: /);
  });
});
