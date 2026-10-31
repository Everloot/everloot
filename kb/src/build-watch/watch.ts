/**
 * Build watch: notice a new game build, regenerate exactly the files the site reads (with the same
 * generators a maintainer runs by hand), and prepare what a pull request needs: a changelog entry and a
 * body. It never touches git or GitHub's write side; the workflow does that with the plan this produces.
 * See docs/BUILD_WATCH.md.
 *
 * Everything outside this file's decisions is injected (`WatchDeps`), so tests run on fixtures.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { parseVersions, type VersionRow } from "../builds.js";
import { readClientDigests, writeClientDigests, type ClientDigests } from "./client-digests.js";
import { buildChangeEntry } from "./diff.js";
import {
  addPublishedChange, differingFiles, GAME_DATA_DIR, generatedFiles, RAID_TS, raidFiles, readSiteData, RECORDS_TS, retargetRaidImport, siteBuild,
  writeChangeEntry, writeSpellValues, type SpellValueTable,
} from "./site-data.js";
import { branchFor, decide, olderOpen, titleFor, type Action, type PrRef } from "./plan.js";
import { prBody, terminalSummary } from "./render.js";
import { addRecheckScopes, RECHECK_FILE, scopesFromEntry } from "./recheck.js";

export const PRODUCT_ID = /^[a-z0-9_]+$/;

export const WatchConfig = z.object({
  region: z.string().regex(/^[a-z]{2}$/).default("us"),
  /** The site reads one set of files, so one product feeds it. When Blizzard ships the live product, it replaces the beta here. */
  products: z.array(z.object({
    product: z.string().regex(PRODUCT_ID),
    label: z.string(),
    /** True once players can play the product. Everything from a product that is not live is a spoiler. */
    live: z.boolean(),
  })).length(1),
});
export type WatchConfig = z.infer<typeof WatchConfig>;

export interface Extracted {
  /** The build the CDN served; it can be ahead of the version service. */
  build: { buildId: number; buildConfig: string; version: string };
  /** Numbers of the spells talents show; written to spell-values.json. */
  spellValues: SpellValueTable;
  /** Counts and hashes of every table the extraction read; written to client-digests.json. */
  clientDigests: ClientDigests;
  /** Tables asked for and not read, with the reason; used to explain an absent table in the entry. */
  missingTables: { table: string; reason: string }[];
  /** Writes the talent files, raid file, raid_data.lua and map.json for this build under `root`, with the site's own generators. */
  generate(root: string): Promise<void> | void;
  /** Frees the scratch files `generate` reads. */
  dispose?(): void;
  encryptedTables: { table: string; blocks: number }[];
  source: { definitions: string | null; library: string; extractedAt: string };
  warnings: string[];
}

export interface WatchDeps {
  /** The version service's table for a product (see builds.ts). */
  fetchVersions(product: string): Promise<string>;
  /** Every pull request whose branch starts with `game-build/`, any state. */
  listPrs(): Promise<PrRef[]>;
  /** `definitions`: read the table layouts at this WoWDBDefs commit instead of the newest, to reproduce a build exactly. */
  extract(product: string, opts: { definitions: string | null }): Promise<Extracted>;
  now(): Date;
}

export interface WatchOptions {
  config: WatchConfig;
  /** The repository whose committed files are compared with, and written to unless dry run. */
  repoRoot: string;
  /** Plan, pull request bodies and dry-run files go here. */
  outDir: string;
  dryRun: boolean;
  /** Only look: decide, extract nothing. */
  checkOnly: boolean;
  /** Reopen a build whose pull request was closed without merging, or refresh an open one. */
  redo: boolean;
  /** Dry run only: regenerate even when the build is already committed, to show the generators reproduce it. */
  force?: boolean;
  runUrl?: string;
}

export interface ProductResult {
  product: string;
  action: Action["kind"];
  pr?: number;
  version?: string;
  buildId?: number;
  branch?: string;
  title?: string;
  /** Files written or changed, relative to the repository root. */
  paths: string[];
  /** Files the pull request removes (the previous build's raid file). */
  remove: string[];
  bodyFile?: string;
  summary?: string;
  /** Dry run with `force`: generated files that differ from the committed ones, ignoring `extractedAt`. */
  differing?: string[];
  error?: string;
}

const VERSION = /^\d+(\.\d+){2,3}$/;

/** The first region row: Blizzard ships one build to every region at once. */
function latestRow(text: string): VersionRow {
  const { rows } = parseVersions(text);
  const row = rows.find((r) => r.region === "us") ?? rows[0];
  if (!row) throw new Error("the version service listed no build");
  if (!VERSION.test(row.version)) throw new Error(`the version service gave an odd version name: ${row.version.slice(0, 40)}`);
  return row;
}

export async function runWatch(opts: WatchOptions, deps: WatchDeps): Promise<ProductResult[]> {
  if (opts.force && !opts.dryRun) throw new Error("--force only works with --dry-run");
  const prs = await deps.listPrs();
  const results: ProductResult[] = [];
  for (const cfg of opts.config.products) {
    try {
      results.push(await watchProduct(cfg, prs, opts, deps));
    } catch (err) {
      results.push({ product: cfg.product, action: "up-to-date", paths: [], remove: [], error: err instanceof Error ? err.message : String(err) });
    }
  }
  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(join(opts.outDir, "plan.json"), `${JSON.stringify(results, null, 2)}\n`);
  return results;
}

async function watchProduct(cfg: WatchConfig["products"][number], prs: PrRef[], opts: WatchOptions, deps: WatchDeps): Promise<ProductResult> {
  const row = latestRow(await deps.fetchVersions(cfg.product));
  const before = readSiteData(opts.repoRoot);
  const beforeDigests = readClientDigests(opts.repoRoot);
  const ident = (b: { buildConfig: string; buildId: number }) => ({ buildConfig: b.buildConfig, buildId: b.buildId });
  const committed = before && ident(siteBuild(before));
  const decideOpts = { redo: opts.redo, force: opts.force };
  const first = decide(cfg.product, committed, ident(row), prs, decideOpts);
  const base = { product: cfg.product, version: row.version, buildId: row.buildId, paths: [] as string[], remove: [] as string[] };
  const idle = (a: Action): ProductResult => ({ ...base, action: a.kind, ...("number" in a ? { pr: a.number } : {}) });
  if ((first.kind !== "create" && first.kind !== "update") || opts.checkOnly) return idle(first);

  // A dry run reproduces the build with the table layouts the committed files were read with.
  const got = await deps.extract(cfg.product, { definitions: opts.force && before ? siteBuild(before).definitions : null });
  try {
    // The CDN can be a build ahead of the version service. Trust the files we actually read.
    const action = got.build.buildConfig === row.buildConfig ? first : decide(cfg.product, committed, ident(got.build), prs, decideOpts);
    if (action.kind !== "create" && action.kind !== "update") return { ...idle(action), version: got.build.version, buildId: got.build.buildId };

    // A dry run writes into a scratch tree, with raid.ts and the records list copied in so they can be edited too.
    const root = resolve(opts.dryRun ? join(opts.outDir, "dry-run", "tree") : opts.repoRoot);
    if (opts.dryRun) {
      rmSync(root, { recursive: true, force: true });
      for (const file of [RAID_TS, RECORDS_TS]) {
        if (!existsSync(join(opts.repoRoot, file))) continue;
        mkdirSync(dirname(join(root, file)), { recursive: true });
        copyFileSync(join(opts.repoRoot, file), join(root, file));
      }
    }
    // The previous build's raid file and any class that left the build must not survive next to the new files.
    const stale = raidFiles(opts.repoRoot);
    if (!opts.dryRun) for (const f of stale) rmSync(join(root, GAME_DATA_DIR, f), { force: true });
    rmSync(join(root, GAME_DATA_DIR, "talents"), { recursive: true, force: true });
    await got.generate(root);
    writeSpellValues(root, got.spellValues);
    writeClientDigests(root, got.clientDigests);

    const written = raidFiles(root);
    if (written.length > 1) throw new Error(`more than one raid file was written: ${written.join(", ")}`);
    const after = readSiteData(root);
    if (!after) throw new Error("the generators wrote no talent files");
    const remove = stale.filter((f) => f !== written[0]).map((f) => `${GAME_DATA_DIR}/${f}`);
    const importChanged = after.raid && existsSync(join(root, RAID_TS)) ? retargetRaidImport(root, after.raid.build) : false;

    const entry = buildChangeEntry({
      product: cfg.product, live: cfg.live, detectedAt: deps.now().toISOString(), before, after,
      beforeDigests, afterDigests: got.clientDigests, missingTables: got.missingTables,
      encryptedTables: got.encryptedTables, source: got.source, warnings: got.warnings,
    });
    const branch = branchFor(cfg.product, got.build);
    const body = prBody(entry, { supersedes: olderOpen(cfg.product, got.build, prs), runUrl: opts.runUrl });
    mkdirSync(join(opts.outDir, cfg.product), { recursive: true });
    const bodyFile = join(opts.outDir, cfg.product, "pr-body.md");
    writeFileSync(bodyFile, `${body}\n`);
    const entryPath = writeChangeEntry(root, entry);
    // The site bundles the record only once it is listed; the web tests fail until it is.
    const listed = existsSync(join(root, RECORDS_TS)) ? addPublishedChange(root, cfg.product, got.build.buildId) : false;
    // Moved zones and entrances put their pins and entrances to recheck (kb/curated/recheck.json).
    const recheck = addRecheckScopes(resolve(opts.repoRoot), root, scopesFromEntry(entry));

    const files = generatedFiles(root);
    const differing = opts.force ? differingFiles(root, resolve(opts.repoRoot), files) : undefined;
    const rel = (p: string) => p.slice(root.length + 1).replace(/\\/g, "/");
    return {
      product: cfg.product, action: action.kind, ...("number" in action ? { pr: action.number } : {}),
      version: got.build.version, buildId: got.build.buildId, branch, title: titleFor(got.build.version),
      paths: [...files, rel(entryPath), ...(importChanged ? [RAID_TS] : []), ...(listed ? [RECORDS_TS] : []), ...(recheck ? [RECHECK_FILE] : [])], remove, bodyFile,
      summary: `${terminalSummary(entry)}${differing ? `\nregenerated files differing from the committed ones (extractedAt ignored): ${differing.length ? differing.join(", ") : "none"}` : ""}`,
      ...(differing ? { differing } : {}),
    };
  } finally {
    got.dispose?.();
  }
}
