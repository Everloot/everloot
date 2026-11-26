/**
 * Still pictures of creature and item models for the site's pages, drawn by our own renderer from the model,
 * skin and texture files of the public client (docs/ASSETS.md, "Model pictures"; docs/DATA_POLICY.md, "Fourth
 * extension"). Only NPCs and items the site's gates list are drawn. Like the icons, the pictures are uploaded
 * to asset storage by a maintainer and never committed.
 *
 * Only unencrypted files are read. A display with a file that is encrypted or not in the build is counted and
 * gets no picture. No key is loaded and no listfile: every file id comes from the client tables or from the
 * model's own chunks.
 *
 * Each picture is named by a hash of everything that went into it (the files' content keys, the texture and
 * geoset choice, the renderer version and size) and kept in one `renders/` folder shared by all builds, so a
 * new build reuses, and the upload skips, every picture whose inputs did not change. Each build gets its own
 * `renders.json` naming the pictures it uses.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AssetChecksums, CHECKSUM_SCHEMA } from "./client-assets.js";
import type { TableSource } from "./client-extract.js";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { drawList, poseMesh, readM2, readSkin, standSequence, type DrawList, type M2Model, type Stand } from "./renders/m2.js";
import { planRenders, type RenderTarget } from "./renders/plan.js";
import { rasterize, type Texture } from "./renders/raster.js";
import type { Rows, TableReader } from "./talents/build-catalog.js";
import { LABEL, type BuildStamp } from "./talents/catalog.js";

export const RENDER_SCHEMA = "everloot.game-renders/1";
/** Bump when the same files would give a different picture (camera, light, what is drawn), so every name changes. */
export const RENDERER_VERSION = 1;
/** Drawn at twice the size and scaled down by Pillow, which smooths the edges. */
const DRAW_SIZE = 1024;
const PICTURE_SIZE = 512;
const QUALITY = 90;
/** Displays prepared, drawn and encoded together; keeps the decoded textures of one batch in memory at a time. */
const BATCH = 24;
/** Bytes of read files kept for reuse by later displays. */
const KEEP_BYTES = 512 * 1024 * 1024;
/** How many skip reasons the manifest lists (the counts cover all of them). */
const SKIP_LIST = 200;

const Picture = z.string().regex(/^renders\/[0-9a-f]{32}\.webp$/);
export const RenderManifest = z.object({
  schema: z.literal(RENDER_SCHEMA),
  label: z.literal(LABEL),
  build: z.object({ product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(), extractedAt: z.string() }),
  renderer: z.number().int(),
  /** Every picture is this many pixels square, WebP with a transparent background. */
  size: z.number().int(),
  /** Display id -> picture, a path from the bucket's root (the shared `renders/` folder), not from the build folder. */
  creatureDisplays: z.record(z.string(), Picture),
  itemDisplays: z.record(z.string(), Picture),
  /** NPC id -> creature display id, and item id -> item display id, for the gated ids whose display has a picture. */
  npcs: z.record(z.string(), z.number().int()),
  items: z.record(z.string(), z.number().int()),
  counts: z.object({
    /** Displays the gated NPCs and items lead to. */
    planned: z.number().int(),
    made: z.number().int(), reused: z.number().int(),
    /** Displays skipped because one of their files is encrypted, or not in the build. */
    encrypted: z.number().int(), absent: z.number().int(),
    /** Displays whose files could not be read, parsed or drawn. */
    failed: z.number().int(),
    npcsWithoutDisplay: z.number().int(), npcsHumanoid: z.number().int(), npcsWithoutModel: z.number().int(),
    itemsWithoutAppearance: z.number().int(), itemsTextureOnly: z.number().int(), itemsWithoutModelFile: z.number().int(),
  }),
  /** Why displays got no picture, the first SKIP_LIST of them. */
  skipped: z.array(z.string()),
});
export type RenderManifest = z.infer<typeof RenderManifest>;

export interface IoResult { dst: string; ok: boolean; width: number; height: number; error: string | null }
/** Texture decoding (BLP to raw RGBA) and picture encoding (raw RGBA to WebP); Pillow by default (scripts/render_io.py). */
export interface RenderIo {
  decode(jobs: { src: string; dst: string }[]): Promise<IoResult[]>;
  encode(jobs: { src: string; dst: string; size: number; quality: number }[]): Promise<IoResult[]>;
}

async function runPython(jobs: unknown[], workDir: string): Promise<IoResult[]> {
  if (!jobs.length) return [];
  const jobFile = resolve(workDir, "jobs.json");
  writeFileSync(jobFile, JSON.stringify(jobs));
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "render_io.py");
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  // As for blp_convert.py: -E, run from the script's own folder, every path absolute.
  const out = await new Promise<string>((ok, fail) => {
    const child = spawn(python, ["-E", script, jobFile], { cwd: dirname(script), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => fail(new Error(`could not start ${python}: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? ok(stdout) : fail(new Error(`render_io.py exited ${code}: ${stderr.trim()}`))));
  });
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as IoResult);
}

export const pillowRenderIo: RenderIo = {
  decode: (jobs) => runPython(jobs.map((j) => ({ decode: resolve(j.src), dst: resolve(j.dst) })), dirname(jobs[0]?.src ?? ".")),
  encode: (jobs) => runPython(jobs.map((j) => ({ encode: resolve(j.src), dst: resolve(j.dst), size: j.size, quality: j.quality })), dirname(jobs[0]?.src ?? ".")),
};

export interface RenderRun {
  /** The build's folder: renders.json and checksums.json (not uploaded). The pictures are in `<outDir>/renders/`. */
  dir: string;
  manifest: RenderManifest;
  checksums: AssetChecksums;
  notes: string[];
}

interface Fetched { status: "ok" | "encrypted" | "absent" | "failed"; cKey?: string; buffer?: Buffer }

export interface RenderGates { npcs: ReadonlySet<number>; items: ReadonlySet<number> }

/** Reads the tables from a snapshot file, then draws. */
export async function buildClientRenders(opts: { snapshotPath: string; outDir: string; source: TableSource; gates: RenderGates; io?: RenderIo }): Promise<RenderRun> {
  const meta = readClientMeta(opts.snapshotPath);
  const present = new Set(readClientTables(opts.snapshotPath));
  const cache = new Map<string, Rows>();
  const get: TableReader = (table) => {
    if (!present.has(table)) return undefined;
    if (!cache.has(table)) cache.set(table, readClientRows(opts.snapshotPath, table));
    return cache.get(table);
  };
  const build: BuildStamp = { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt };
  return buildRendersFromTables({ get, build, outDir: opts.outDir, source: opts.source, gates: opts.gates, io: opts.io });
}

interface Prepared { target: RenderTarget; label: string; m2: M2Model; stand: Stand | null; list: DrawList; anim: Buffer | null; picture: string; textures: Map<number, Fetched> }

export async function buildRendersFromTables(opts: {
  get: TableReader; build: BuildStamp; outDir: string; source: TableSource; gates: RenderGates; io?: RenderIo;
  /** Test sizes; the defaults are DRAW_SIZE and PICTURE_SIZE. */
  drawSize?: number; size?: number;
}): Promise<RenderRun> {
  const { get, build, source } = opts;
  const io = opts.io ?? pillowRenderIo;
  const drawSize = opts.drawSize ?? DRAW_SIZE, size = opts.size ?? PICTURE_SIZE;
  if (!source.readFile) throw new Error("this source cannot read files");
  for (const t of ["CreatureDisplayInfo", "CreatureModelData", "ItemDisplayInfo", "ItemAppearance", "ItemModifiedAppearance", "ModelFileData"]) {
    if (!get(t)) throw new Error(`the snapshot has no ${t} table; run \`client-extract --refresh\` first`);
  }
  const plan = planRenders(get, opts.gates);

  const dir = join(opts.outDir, `${build.product}-${build.buildId}-${build.buildConfig.slice(0, 8)}`);
  const shared = join(opts.outDir, "renders");
  const work = join(dir, "_work");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(shared, { recursive: true });
  mkdirSync(work, { recursive: true });

  // Files read are kept up to KEEP_BYTES, newest use last: many displays share a model or a skin texture.
  const failedFiles = new Map<number, Fetched["status"]>();
  const kept = new Map<number, { cKey: string; buffer: Buffer }>();
  let keptBytes = 0;
  async function fetchFile(id: number): Promise<Fetched> {
    const bad = failedFiles.get(id);
    if (bad) return { status: bad };
    const hit = kept.get(id);
    if (hit) { kept.delete(id); kept.set(id, hit); return { status: "ok", ...hit }; }
    let result: Fetched;
    try {
      const status = source.fileStatus?.(id);
      if (status === "absent") result = { status: "absent" };
      else if (status === "encrypted") result = { status: "encrypted" };
      else {
        const read = await source.readFile!(id);
        result = !read ? { status: "absent" } : read.encryptedBlocks > 0 ? { status: "encrypted" } : { status: "ok", cKey: read.cKey, buffer: read.buffer };
      }
    } catch {
      result = { status: "failed" };
    }
    if (result.status !== "ok") { failedFiles.set(id, result.status); return result; }
    kept.set(id, { cKey: result.cKey!, buffer: result.buffer! });
    keptBytes += result.buffer!.length;
    for (const [old, f] of kept) { if (keptBytes <= KEEP_BYTES || old === id) break; kept.delete(old); keptBytes -= f.buffer.length; }
    return result;
  }

  const counts = { planned: plan.targets.length, made: 0, reused: 0, encrypted: 0, absent: 0, failed: 0, ...plan.skipped };
  const skipped: string[] = [];
  const skip = (label: string, why: string, kind: "encrypted" | "absent" | "failed") => { counts[kind] += 1; if (skipped.length < SKIP_LIST) skipped.push(`${label}: ${why}`); };
  const pictures = { creature: new Map<number, string>(), item: new Map<number, string>() };
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

  async function prepare(target: RenderTarget): Promise<Prepared | null> {
    const label = `${target.kind} display ${target.displayId}`;
    const need = async (id: number, what: string): Promise<Fetched | null> => {
      const f = await fetchFile(id);
      if (f.status === "ok") return f;
      skip(label, `${what} file ${id} is ${f.status === "absent" ? "not in this build" : f.status}`, f.status === "absent" ? "absent" : f.status);
      return null;
    };
    const model = await need(target.modelFileId, "model");
    if (!model) return null;
    try {
      const m2 = readM2(model.buffer!);
      if (!m2.skinFileIds[0]) { skip(label, "the model lists no skin", "failed"); return null; }
      const skinFile = await need(m2.skinFileIds[0], "skin");
      if (!skinFile) return null;
      const stand = standSequence(m2);
      const animFile = stand?.animFileId ? await need(stand.animFileId, "animation") : null;
      if (stand?.animFileId && !animFile) return null;
      const anim = animFile?.buffer ?? null;
      const list = drawList(m2, readSkin(skinFile.buffer!), { replaceable: target.replaceable, geosets: target.geosets, stand, anim });
      if (!list.batches.length) { skip(label, "nothing to draw (no batch with a shown geoset, a drawn blend mode and a texture file)", "failed"); return null; }
      const textures = new Map<number, Fetched>();
      for (const id of [...new Set(list.batches.map((b) => b.textureFileId))].sort((a, b) => a - b)) {
        const f = await need(id, "texture");
        if (!f) return null;
        textures.set(id, f);
      }
      const inputs = {
        renderer: RENDERER_VERSION, size, drawSize, kind: target.kind, geosets: target.geosets, replaceable: target.replaceable,
        model: model.cKey, skin: skinFile.cKey, anim: animFile?.cKey ?? null, textures: [...textures].map(([id, f]) => [id, f.cKey]),
      };
      const picture = `renders/${sha(JSON.stringify(inputs)).slice(0, 32)}.webp`;
      return { target, label, m2, stand, list, anim, picture, textures };
    } catch (e) {
      skip(label, `could not read the model (${(e as Error).message})`, "failed");
      return null;
    }
  }

  for (let start = 0; start < plan.targets.length; start += BATCH) {
    const ready: Prepared[] = [];
    for (const target of plan.targets.slice(start, start + BATCH)) {
      const p = await prepare(target);
      if (!p) continue;
      if (existsSync(join(opts.outDir, p.picture))) { counts.reused += 1; pictures[p.target.kind].set(p.target.displayId, p.picture); continue; }
      ready.push(p);
    }
    if (!ready.length) continue;
    // Decode this batch's textures once each.
    const bytesOf = new Map(ready.flatMap((p) => [...p.textures].map(([id, f]) => [id, f.buffer!] as const)));
    const wanted = [...bytesOf.keys()];
    const decodeJobs = wanted.map((id) => {
      const src = join(work, `tex-${id}.blp`);
      writeFileSync(src, bytesOf.get(id)!);
      return { src, dst: join(work, `tex-${id}.rgba`) };
    });
    const decoded = new Map<number, Texture | string>();
    (await io.decode(decodeJobs)).forEach((r, i) => {
      if (!r?.ok) { decoded.set(wanted[i], r?.error ?? "no answer"); return; }
      const raw = readFileSync(decodeJobs[i].dst);
      decoded.set(wanted[i], { width: raw.readUInt32LE(0), height: raw.readUInt32LE(4), data: new Uint8Array(raw.buffer, raw.byteOffset + 8, raw.length - 8) });
    });
    const encodeJobs: { p: Prepared; src: string; dst: string; tmp: string }[] = [];
    for (const p of ready) {
      const bad = [...p.textures.keys()].find((id) => typeof decoded.get(id) !== "object");
      if (bad !== undefined) { skip(p.label, `texture file ${bad} could not be decoded (${decoded.get(bad) ?? "no answer"})`, "failed"); continue; }
      try {
        const pose = poseMesh(p.m2, p.stand, p.anim);
        const pixels = rasterize({ positions: pose.positions, normals: pose.normals, uvs: p.m2.uvs },
          p.list.batches.map((b) => ({ triangles: b.triangles, blend: b.blend, alpha: b.alpha, texture: decoded.get(b.textureFileId) as Texture })), { size: drawSize });
        const head = Buffer.alloc(8);
        head.writeUInt32LE(drawSize, 0); head.writeUInt32LE(drawSize, 4);
        const src = join(work, `${p.target.kind}-${p.target.displayId}.rgba`);
        writeFileSync(src, Buffer.concat([head, pixels]));
        // Written beside the shared folder first and moved in when whole, so a stopped run leaves no half picture.
        const dst = join(opts.outDir, p.picture);
        encodeJobs.push({ p, src, dst, tmp: `${dst}.part` });
      } catch (e) {
        skip(p.label, `could not draw (${(e as Error).message})`, "failed");
      }
    }
    const results = await io.encode(encodeJobs.map((j) => ({ src: j.src, dst: j.tmp, size, quality: QUALITY })));
    encodeJobs.forEach((j, i) => {
      const r = results[i];
      if (!r?.ok) { skip(j.p.label, `could not encode (${r?.error ?? "no answer"})`, "failed"); return; }
      renameSync(j.tmp, j.dst);
      counts.made += 1;
      pictures[j.p.target.kind].set(j.p.target.displayId, j.p.picture);
    });
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
  }
  rmSync(work, { recursive: true, force: true });

  const record = (m: Map<number, string>) => Object.fromEntries([...m].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]));
  const linked = (ids: Map<number, number>, has: Map<number, string>) => Object.fromEntries([...ids].filter(([, d]) => has.has(d)).map(([k, d]) => [String(k), d]));
  const manifest = RenderManifest.parse({
    schema: RENDER_SCHEMA, label: LABEL,
    build: { product: build.product, buildId: build.buildId, version: build.version, buildConfig: build.buildConfig, extractedAt: new Date().toISOString() },
    renderer: RENDERER_VERSION, size,
    creatureDisplays: record(pictures.creature), itemDisplays: record(pictures.item),
    npcs: linked(plan.npcs, pictures.creature), items: linked(plan.items, pictures.item),
    counts, skipped,
  });
  writeFileSync(join(dir, "renders.json"), `${JSON.stringify(manifest)}\n`);
  const files: AssetChecksums["files"] = {};
  for (const f of new Set([...pictures.creature.values(), ...pictures.item.values()])) {
    const bytes = readFileSync(join(opts.outDir, f));
    files[f] = { bytes: bytes.length, sha256: sha(bytes) };
  }
  const checksums = AssetChecksums.parse({ schema: CHECKSUM_SCHEMA, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) });
  writeFileSync(join(dir, "checksums.json"), `${JSON.stringify(checksums, null, 1)}\n`);
  const c = manifest.counts;
  const bytes = Object.values(checksums.files).reduce((s, f) => s + f.bytes, 0);
  const notes = [
    `creatures: ${Object.keys(manifest.npcs).length} NPCs on ${Object.keys(manifest.creatureDisplays).length} displays with a picture; ${c.npcsWithoutDisplay} without a display in the files, ${c.npcsHumanoid} dressed humanoids (later), ${c.npcsWithoutModel} without a model`,
    `items: ${Object.keys(manifest.items).length} items on ${Object.keys(manifest.itemDisplays).length} displays with a picture; ${c.itemsWithoutAppearance} without an appearance, ${c.itemsTextureOnly} armour without a model (later), ${c.itemsWithoutModelFile} without a model file`,
    `pictures: ${c.planned} displays planned, ${c.made} drawn, ${c.reused} reused, ${c.encrypted} skipped encrypted, ${c.absent} skipped not in build, ${c.failed} failed`,
    `size: ${Object.keys(checksums.files).length} files, ${(bytes / 1024).toFixed(1)} KB`,
  ];
  return { dir, manifest, checksums, notes };
}
