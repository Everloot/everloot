/**
 * The production side of the build watch: read the product's current build from Blizzard's public CDN
 * and make the pieces the site's own generators need. It reuses the extractor behind `client-extract`;
 * no decryption keys are loaded and encrypted blocks are counted, not read.
 *
 * `generate(root)` then runs the same generators a maintainer runs by hand, writing into `root`:
 * `client-catalog` and `web/scripts/trim-talent-catalog.mjs` (talents), `web/scripts/build-raid-game-data.ts`
 * (raid file and addon/modules/raid_data.lua), `client-map` (map.json) and `client-layer` (client-layer.json).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeClientAchievements } from "../client-achievements.js";
import { writeCatalogs } from "../client-catalog.js";
import { writeClientLayer } from "../client-layer.js";
import { CASC_LIBRARY, extractTables, iconIds, NOT_IN_BUILD, openCdn, pinDefinitions, probeFiles } from "../client-extract.js";
import { CLIENT_TABLES, clientSnapshotName, readClientMeta, writeClientSnapshot } from "../client-snapshot.js";
import { readTerrainAreas } from "../terrain-area.js";
import { ClassCatalog } from "../talents/catalog.js";
import { writeWorldMapData } from "../world-map-data.js";
import { clientDigestsOf } from "./client-digests.js";
import { GAME_DATA_DIR, spellValuesOf } from "./site-data.js";
import type { Extracted } from "./watch.js";

export async function extractFromCdn(product: string, region: string, curatedPath: string, webDir: string, definitions: string | null): Promise<Extracted> {
  const tsx = join(webDir, "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(tsx)) throw new Error(`${tsx} is missing: run npm ci in web/ first`);
  const { build, source } = await openCdn(product, region);
  // Every table layout this run reads comes from one WoWDBDefs commit: the newest, or the one asked for.
  const pinned = await pinDefinitions(globalThis.fetch, definitions ?? "master");
  const { tables, missing } = await extractTables(source);
  // A table that failed to read (not one the build simply lacks) would give files with holes: fail instead.
  const failed = missing.filter((m) => m.reason !== NOT_IN_BUILD);
  if (failed.length) throw new Error(`could not read ${failed.map((m) => `${m.table} (${m.reason})`).join(", ")}`);
  const status = probeFiles(source, iconIds(tables));
  if (status) tables.push(status);
  // The ground under each entrance and flight master, for the zone it is in (map.json).
  const terrain = source.readFile && await readTerrainAreas(source.readFile, tables);
  if (terrain) tables.push(terrain);

  const work = mkdtempSync(join(tmpdir(), "everloot-build-watch-"));
  try {
    const snapshot = join(work, clientSnapshotName(build));
    const extractedAt = new Date().toISOString();
    const manifest = writeClientSnapshot(snapshot, { ...build, extractedAt, library: CASC_LIBRARY, definitions: pinned }, tables, missing);
    const run = writeCatalogs(snapshot, join(work, "catalog"), curatedPath);
    const classes = readdirSync(join(run.dir, "talents"))
      .filter((f) => f !== "index.json")
      .map((f) => ClassCatalog.parse(JSON.parse(readFileSync(join(run.dir, "talents", f), "utf8"))));
    const meta = readClientMeta(snapshot);
    const web = (script: string, ...args: string[]) =>
      execFileSync(process.execPath, [...(script.endsWith(".ts") ? [tsx] : []), join(webDir, "scripts", script), ...args], { cwd: webDir, stdio: ["ignore", "ignore", "inherit"], timeout: 300_000 });
    return {
      build: { buildId: build.buildId, buildConfig: build.buildConfig, version: build.version },
      spellValues: spellValuesOf({ product, buildId: build.buildId, version: build.version, buildConfig: build.buildConfig, definitions: pinned, extractedAt }, classes),
      // The read set, not the probe: FileStatus records which icon files the CDN serves and changes with
      // the spells, so it would show up as a table change on every build.
      clientDigests: clientDigestsOf(
        { product, buildId: build.buildId, version: build.version, buildConfig: build.buildConfig, definitions: pinned, extractedAt },
        tables.filter((t) => t.table in CLIENT_TABLES),
      ),
      missingTables: missing,
      generate(root: string) {
        web("trim-talent-catalog.mjs", join(run.dir, "talents"), join(root, GAME_DATA_DIR, "talents"));
        mkdirSync(join(root, "addon", "modules"), { recursive: true });
        web("build-raid-game-data.ts", run.dir, snapshot, root);
        writeFileSync(join(root, GAME_DATA_DIR, "map.json"), `${JSON.stringify(writeWorldMapData(snapshot), null, 2)}\n`);
        writeClientLayer(snapshot, join(root, GAME_DATA_DIR, "client-layer.json"));
        writeClientAchievements(snapshot, join(root, GAME_DATA_DIR, "client-achievements.json"));
      },
      dispose: () => rmSync(work, { recursive: true, force: true }),
      encryptedTables: manifest.tables.map((t) => ({ table: t.table, blocks: t.encryptedBlocks })),
      source: { definitions: meta.definitions, library: CASC_LIBRARY, extractedAt },
      warnings: [],
    };
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw err;
  }
}
