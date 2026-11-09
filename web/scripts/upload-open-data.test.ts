import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { writeOpenData } from "../../kb/src/open-data/write";
import { readOpenDataGameFiles } from "../../kb/src/open-data/game-data";
import { plan, uploadOpenData } from "./upload-open-data.mjs";

const ENV = { R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", BULK_BUCKET: "everloot-bulk", R2_BUCKET: "everloot-uploads" };
const STAMP = "2026-10-22T04-57-00-000Z";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let dir: string;
const npcs = '{"npcId":5}\n';
function manifest(over: Record<string, unknown> = {}, file: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: "everloot.open-data/1", generatedAt: "2026-10-22T04:57:00.000Z",
    files: [{ path: "observed/npcs.ndjson", schema: "schema/observed-npcs.schema.json", rows: 1, bytes: Buffer.byteLength(npcs), sha256: sha(npcs), ...file }],
    ...over,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "everloot-open-upload-"));
  for (const d of ["observed", "schema"]) mkdirSync(join(dir, d));
  writeFileSync(join(dir, "observed/npcs.ndjson"), npcs);
  writeFileSync(join(dir, "schema/observed-npcs.schema.json"), "{}\n");
  writeFileSync(join(dir, "README.md"), "# Everloot open data\n");
  writeFileSync(join(dir, "LICENCE.md"), "# Licence\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("the plan lists the data, the schemas, the README and the licence, and the manifest last, under the stamp", () => {
  const p = plan(dir, manifest());
  expect(p.stamp).toBe(STAMP);
  expect(p.files.map((f: { name: string }) => f.name)).toEqual(["observed/npcs.ndjson", "schema/observed-npcs.schema.json", "README.md", "LICENCE.md", "manifest.json"]);
  expect(p.files.map((f: { type: string }) => f.type)).toEqual(["application/x-ndjson", "application/json", "text/markdown; charset=utf-8", "text/markdown; charset=utf-8", "application/json"]);
});

test("a file that does not match its hash or size, or a path outside the export, stops the upload before anything is sent", () => {
  expect(() => plan(dir, manifest({}, { sha256: "0".repeat(64) }))).toThrow(/does not match its sha256/);
  expect(() => plan(dir, manifest({}, { bytes: 1 }))).toThrow(/bytes/);
  for (const path of ["../outside.ndjson", "/abs/file.ndjson", "observed/../x.ndjson", "other/file.ndjson", "observed/a.sh"]) {
    expect(() => plan(dir, manifest({}, { path })), path).toThrow(/not a path inside an export/);
  }
  expect(() => plan(dir, JSON.stringify({ schema: "everloot.bulk/1" }))).toThrow(/not an open data manifest/);
});

test("a file, the README or the manifest that carries what looks like a local path stops the upload", () => {
  for (const leak of ['{"path":"D:\\\\Temp\\\\out.txt"}\n', '{"path":"/home/someone/notes.txt"}\n', '{"path":"C:\\\\Users\\\\someone\\\\AppData\\\\Local"}\n']) {
    writeFileSync(join(dir, "observed/npcs.ndjson"), leak);
    expect(() => plan(dir, manifest({}, { bytes: Buffer.byteLength(leak), sha256: sha(leak) }))).toThrow(/local filesystem path/);
  }
  writeFileSync(join(dir, "observed/npcs.ndjson"), npcs);
  writeFileSync(join(dir, "README.md"), "built in /home/someone/out\n");
  expect(() => plan(dir, manifest())).toThrow(/README\.md carries/);
  writeFileSync(join(dir, "README.md"), "# ok\n");
  expect(() => plan(dir, manifest({ note: "built in C:\\\\proj\\\\out" }))).toThrow(/manifest\.json carries/);
});

test("every object is written create-only under open-data/, then the pointer, and never at the bulk export's latest.json", async () => {
  writeFileSync(join(dir, "manifest.json"), manifest());
  const seen: { url: string; ifNoneMatch: string | null; cache: string | null }[] = [];
  const fetch = async (req: Request) => {
    seen.push({ url: req.url, ifNoneMatch: req.headers.get("if-none-match"), cache: req.headers.get("cache-control") });
    return new Response("", { status: 200 });
  };
  expect(await uploadOpenData({ folder: dir, env: ENV, fetch })).toBe(STAMP);
  const root = "https://acct.r2.cloudflarestorage.com/everloot-bulk/open-data";
  expect(seen.map((s) => s.url)).toEqual([
    `${root}/${STAMP}/observed/npcs.ndjson`, `${root}/${STAMP}/schema/observed-npcs.schema.json`, `${root}/${STAMP}/README.md`, `${root}/${STAMP}/LICENCE.md`,
    `${root}/${STAMP}/manifest.json`, `${root}/latest.json`,
  ]);
  expect(seen.slice(0, 5).every((s) => s.ifNoneMatch === "*" && s.cache?.includes("immutable"))).toBe(true);
  expect(seen[5]!.ifNoneMatch).toBeNull();
  expect(seen.some((s) => s.url.endsWith("everloot-bulk/latest.json"))).toBe(false);
});

test("a folder the real exporter wrote passes the plan, every file of it uploaded", () => {
  const out = join(dir, "real");
  const at = "2026-10-10T12:00:00.000Z";
  const bounds = { left: 1, top: 1, right: -1, bottom: -1 };
  writeOpenData(out, {
    records: ["a", "b", "c"].map((id) => ({ kind: "npc_sighting", installId: `inst-${id}-00`, eventId: `e-${id}`, capturedAt: at, npcId: 5, name: "Hogger", mapId: 1429, x: 1, y: 1, positionKind: "interaction", role: "vendor" })),
    dataAsOf: at, generatedAt: "2026-10-22T04:57:00.000Z",
    gameFiles: {
      build: { version: "1.60.1.70450", extractedAt: at }, edges: [], taxonomy: { classes: [], subclasses: [], items: [] },
      map: { schema: "everloot.world-map/1", source: { name: "x", status: "found in game files, unconfirmed", licence: "x", licenceUrl: "x", product: "x", buildId: 1, version: "1", buildConfig: "x", definitions: null, extractedAt: at, tables: [] }, continents: [{ id: 0, name: "K", bounds }], zones: [], heldBackZones: [], entrances: [], flightNodes: [], flightPaths: [], warnings: [] },
      catalogs: readOpenDataGameFiles(join(__dirname, "..", "src", "data", "game-data")),
    },
  });
  const p = plan(out, readFileSync(join(out, "manifest.json"), "utf8"));
  const names = p.files.map((f: { name: string }) => f.name);
  expect(names.at(-1)).toBe("manifest.json");
  expect(names).toEqual(expect.arrayContaining(["observed/npcs.ndjson", "game-files/zones.ndjson", "schema/observed-npcs.schema.json", "README.md", "LICENCE.md"]));
  // 18 data files and their 18 schemas, README, LICENCE and the manifest.
  expect(names).toHaveLength(67);
});

test("an existing folder is never overwritten, and the uploads bucket is refused as the target", async () => {
  writeFileSync(join(dir, "manifest.json"), manifest());
  const fetch = async () => new Response("", { status: 412 });
  await expect(uploadOpenData({ folder: dir, env: ENV, fetch })).rejects.toThrow(/already exists/);
  await expect(uploadOpenData({ folder: dir, env: { ...ENV, BULK_BUCKET: "everloot-uploads" }, fetch })).rejects.toThrow(/uploads bucket/);
});
