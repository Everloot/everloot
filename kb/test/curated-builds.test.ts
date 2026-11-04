import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TALENT_CLASSES, type TalentClass } from "@everloot/protocol";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { decodeBuild, resolveBuild } from "../../web/src/lib/talents/share";
import { openDb } from "../src/db.js";
import { importCurated } from "../src/importers/curated.js";
import { talentBuildUrl } from "../src/page-urls.js";
import { siteCatalog } from "../src/talents/site-catalogs.js";

const BUILDS_FILE = join(import.meta.dirname, "..", "curated", "builds.yaml");
const builds = parse(readFileSync(BUILDS_FILE, "utf8")) as { id: string; source_url: string; body: string; data: Record<string, unknown> }[];
const warrior = builds.find((e) => e.data.class === "warrior")!;
const mage = builds.find((e) => e.data.class === "mage")!;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-curated-builds-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

/** One build entry as YAML, from the real warrior entry with `data` overrides; null drops a field. */
function entry(id: string, data: Record<string, unknown>): string {
  const merged: Record<string, unknown> = { ...warrior.data, ...data };
  const lines = Object.entries(merged).filter(([, v]) => v !== null).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`);
  return [
    "- kind: build",
    `  id: ${id}`,
    `  name: "Test build ${id}"`,
    "  game_version: forever",
    "  body: A test build.",
    `  source_url: ${warrior.source_url}`,
    '  retrieved_at: "2026-11-03"',
    "  data:",
    ...lines,
  ].join("\n");
}

test("a published build row lands with its data; a draft is skipped", async () => {
  const db = openDb(":memory:");
  const yaml = [entry("warrior-published", { status: "published" }), entry("warrior-draft", { status: "draft" })].join("\n");
  expect(await importCurated(db, dirWith({ "builds.yaml": yaml }))).toBe(1);
  const rows = db.prepare("SELECT ext_id, data FROM entities WHERE kind = 'build'").all() as { ext_id: string; data: string }[];
  expect(rows).toHaveLength(1);
  expect(rows[0].ext_id).toBe("warrior-published");
  expect(JSON.parse(rows[0].data)).toEqual({
    class: "warrior", tree: warrior.data.tree, purpose: "leveling", shareCode: warrior.data.share_code,
    points: warrior.data.points, build: warrior.data.build, status: "published",
  });
});

test("a share code of another class fails the import with the file, entry and both classes", async () => {
  const db = openDb(":memory:");
  const yaml = entry("warrior-wrong", { status: "published", share_code: mage.data.share_code });
  await expect(importCurated(db, dirWith({ "builds.yaml": yaml }))).rejects.toThrow("builds.yaml: entry 1 share code is for mage not warrior");
});

test("a declared tree the points do not lean on fails the import, as does a tree the class lacks", async () => {
  const db = openDb(":memory:");
  const fury = entry("warrior-mislabelled", { status: "published", tree: "Fury" });
  await expect(importCurated(db, dirWith({ "builds.yaml": fury }))).rejects.toThrow(`builds.yaml: entry 1 tree is Fury but the points lean on ${warrior.data.tree}`);
  const none = entry("warrior-no-tree", { status: "published", tree: "Arcane" });
  await expect(importCurated(db, dirWith({ "builds.yaml": none }))).rejects.toThrow("builds.yaml: entry 1 tree Arcane is not a warrior tree");
});

test("a published entry without purpose fails the import naming the field", async () => {
  const db = openDb(":memory:");
  const yaml = entry("warrior-no-purpose", { status: "published", purpose: null });
  await expect(importCurated(db, dirWith({ "builds.yaml": yaml }))).rejects.toThrow(/builds\.yaml: entry 1 .*purpose/);
});

test("a share code that does not decode fails the import", async () => {
  const db = openDb(":memory:");
  const yaml = entry("warrior-bad-code", { status: "published", share_code: "EL1-warrior" });
  await expect(importCurated(db, dirWith({ "builds.yaml": yaml }))).rejects.toThrow(/builds\.yaml: entry 1 share code does not decode/);
});

test("kb/curated/builds.yaml holds one draft leveling build per class", () => {
  expect(builds.map((e) => e.data.class).sort()).toEqual([...TALENT_CLASSES].sort());
  for (const e of builds) {
    expect(e.data).toMatchObject({ purpose: "leveling", status: "draft" });
    expect(e.body).toMatch(/draft starter build/);
    expect(e.body).not.toMatch(/lorem|TODO/i);
    expect(e.source_url).toBe(talentBuildUrl(e.data.class as string, e.data.share_code as string));
  }
});

test("every entry in kb/curated/builds.yaml decodes and resolves whole for its class on the current build", () => {
  for (const e of builds) {
    const catalog = siteCatalog(e.data.class as TalentClass);
    const decoded = decodeBuild(e.data.share_code as string);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) continue;
    expect(decoded.build.build).toBe(catalog.build);
    expect(decoded.build.build).toBe(e.data.build);
    const resolved = resolveBuild(catalog, decoded.build);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) continue;
    expect(resolved.build).toMatchObject({ unknown: [], clamped: [], rejected: [], buildDiffers: false });
    const spent = Object.values(resolved.build.ranks).reduce((sum, r) => sum + r.rank, 0);
    expect(spent).toBe(e.data.points);
    // `tree` names the tree the build leans on: the one holding the most points.
    const byTree = catalog.trees.map((t) => ({
      name: t.name,
      points: catalog.nodes.filter((n) => n.treeId === t.id).reduce((sum, n) => sum + (resolved.build.ranks[n.id]?.rank ?? 0), 0),
    }));
    expect(byTree.sort((a, b) => b.points - a.points)[0].name).toBe(e.data.tree);
  }
});

test("drafts in kb/curated never enter the database", async () => {
  const db = openDb(":memory:");
  await importCurated(db, join(import.meta.dirname, "..", "curated"));
  expect(db.prepare("SELECT count(*) AS n FROM entities WHERE kind = 'build'").get()).toEqual({ n: 0 });
});
