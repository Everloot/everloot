import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChangeEntry } from "../src/build-watch/changes.js";
import { branchFor, type PrRef } from "../src/build-watch/plan.js";
import { GAME_DATA_DIR, RAID_LUA, RAID_TS, readSiteData, siteBuild } from "../src/build-watch/site-data.js";
import { ITEM_DIGEST_SCHEMA, readItemDigests, type ItemDigests } from "../src/build-watch/item-digests.js";
import { LABEL } from "../src/talents/catalog.js";
import { runWatch, type Extracted, type WatchConfig, type WatchDeps, type WatchOptions } from "../src/build-watch/watch.js";
import { CONFIG_A, CONFIG_B, commitBuild, extracted, node, raid, stamp, trimmed, versionsText, worldMap, type Build } from "./build-watch-fixtures.js";

const config: WatchConfig = { region: "us", products: [{ product: "wow_classic_beta", label: "beta", live: false }] };
let root: string;
let out: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "everloot-watch-root-")); out = mkdtempSync(join(tmpdir(), "everloot-watch-out-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });

const options = (over: Partial<WatchOptions> = {}): WatchOptions => ({ config, repoRoot: root, outDir: out, dryRun: false, checkOnly: false, redo: false, ...over });

function fakes(build: { id: number; config?: string }, got: () => Extracted, prs: PrRef[] = []) {
  const calls = { extract: 0, versions: 0, definitions: [] as (string | null)[], disposed: 0 };
  const deps: WatchDeps = {
    fetchVersions: async () => { calls.versions++; return versionsText(build.id, build.config ?? CONFIG_A); },
    listPrs: async () => prs,
    extract: async (_p, o) => { calls.extract++; calls.definitions.push(o.definitions); const g = got(); return { ...g, dispose: () => { calls.disposed++; } }; },
    now: () => new Date("2026-10-17T12:00:00Z"),
  };
  return { deps, calls };
}

const v1: Build = { nodes: [node(1, "Mutilate"), node(2, "Evasion")], raid: raid("1.60.1.70450", "party"), map: worldMap(70450), spells: { 101: {}, 102: {} } };
const v2: Build = {
  nodes: [node(1, "Mutilate"), node(3, "Vigor")], raid: raid("1.60.1.70460", "raid"), map: worldMap(70460), spells: { 101: { basePoints: 9 } }, config: CONFIG_B,
  digests: [
    { table: "ItemSparse", rows: new Map([[1, { Name_lang: "A", ItemLevel: 1 }], [3, { Name_lang: "C", ItemLevel: 3 }]]) },
    { table: "SpellName", rows: new Map([[1, { Name_lang: "Spell" }]]) },
  ],
};
const site = (rel: string) => join(root, GAME_DATA_DIR, rel);
const changeFile = (id: number) => site(`changes/wow_classic_beta-${id}.json`);

describe("runWatch", () => {
  it("writes the site files and a baseline entry the first time, plus a plan for the workflow", async () => {
    const [r] = await runWatch(options(), fakes({ id: 70450 }, () => extracted(70450, v1)).deps);
    expect(r).toMatchObject({ action: "create", branch: "game-build/wow_classic_beta-70450-aaaaaaaa", title: "data(game-data): build 1.60.1.70450", remove: [] });
    expect(readSiteData(root)!.talents).toHaveLength(1);
    expect(existsSync(site("raid-1.60.1.70450.json"))).toBe(true);
    expect(existsSync(join(root, RAID_LUA))).toBe(true);
    expect(existsSync(site("spell-values.json"))).toBe(true);
    expect(existsSync(site("client-digests.json"))).toBe(true);
    expect(existsSync(site("map.json"))).toBe(true);
    expect(r.paths).toEqual(expect.arrayContaining([`${GAME_DATA_DIR}/talents/rogue.json`, `${GAME_DATA_DIR}/changes/wow_classic_beta-70450.json`, `${GAME_DATA_DIR}/client-digests.json`, RAID_LUA]));
    expect(ChangeEntry.parse(JSON.parse(readFileSync(changeFile(70450), "utf8")))).toMatchObject({ initial: true, spoiler: true, readSet: null });
    expect(JSON.parse(readFileSync(join(out, "plan.json"), "utf8"))[0].branch).toBe(r.branch);
    expect(readFileSync(r.bodyFile!, "utf8")).toContain("First data for this product");
  });

  it("writes the item digests as the next build's baseline and lists the items new since the committed ones", async () => {
    const items = (buildId: number, ids: number[]): ItemDigests => ({
      schema: ITEM_DIGEST_SCHEMA, label: LABEL, build: stamp(buildId),
      encryptedBlocks: { Item: 0, ItemSparse: 0 }, items: Object.fromEntries(ids.map((id) => [String(id), "abcd"])),
    });
    await runWatch(options(), fakes({ id: 70450 }, () => extracted(70450, v1, { itemDigests: items(70450, [1, 2]) })).deps);
    expect(Object.keys(readItemDigests(root)!.items)).toEqual(["1", "2"]);
    const [r] = await runWatch(options(), fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2, { itemDigests: items(70460, [1, 2, 5]) })).deps);
    expect(r.paths).toContain(`${GAME_DATA_DIR}/item-digests.json`);
    expect(ChangeEntry.parse(JSON.parse(readFileSync(changeFile(70460), "utf8"))).items).toEqual({ spoiler: true, comparedTo: 70450, added: [5], removed: [], changed: [] });
  });

  it("commits no folder of its own: nothing is written outside the files the site reads", async () => {
    await runWatch(options(), fakes({ id: 70450 }, () => extracted(70450, v1)).deps);
    expect(readdirSync(site("."), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()).toEqual(["changes", "talents"]);
  });

  it("does nothing and reads no game files when the build is already committed", async () => {
    commitBuild(root, 70450, v1);
    const { deps, calls } = fakes({ id: 70450 }, () => extracted(70450, v1));
    expect((await runWatch(options(), deps))[0].action).toBe("up-to-date");
    expect(calls.extract).toBe(0);
  });

  it("describes what a new build changed against the committed files", async () => {
    commitBuild(root, 70450, v1, { raidTs: true });
    const { deps, calls } = fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2));
    const [r] = await runWatch(options(), deps);
    expect(r.action).toBe("create");
    const entry = ChangeEntry.parse(JSON.parse(readFileSync(changeFile(70460), "utf8")));
    expect(entry.previous).toMatchObject({ buildId: 70450 });
    expect(entry.talents!.added.map((a) => a.name)).toEqual(["Vigor"]);
    expect(entry.talents!.removed.map((a) => a.name)).toEqual(["Evasion"]);
    expect(entry.talents!.spellValues).toMatchObject([{ spellId: 101, changes: [{ field: "effect 1 basePoints", before: 5, after: 9 }] }]);
    expect(entry.raidBuffs).toMatchObject({ comparedTo: "1.60.1.70450", scopeChanges: [{ id: "battle-shout", before: "party", after: "raid" }] });
    expect(entry.readSet).toMatchObject({
      tables: { before: 2, after: 2 },
      changedTables: [{ table: "ItemSparse", rowsBefore: 2, rowsAfter: 2, changed: true }],
      addedTables: [], removedTables: [], layoutChanged: false,
    });
    expect(readFileSync(r.bodyFile!, "utf8")).toContain("Client data");
    expect(siteBuild(readSiteData(root)!).buildId).toBe(70460);
    expect(calls.disposed).toBe(1);
    expect(calls.definitions).toEqual([null]);
  });

  it("replaces the previous build's raid file and retargets the import in raid.ts", async () => {
    commitBuild(root, 70450, v1, { raidTs: true });
    const [r] = await runWatch(options(), fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2)).deps);
    expect(existsSync(site("raid-1.60.1.70450.json"))).toBe(false);
    expect(existsSync(site("raid-1.60.1.70460.json"))).toBe(true);
    expect(readFileSync(join(root, RAID_TS), "utf8")).toContain('from "./raid-1.60.1.70460.json"');
    expect(r.remove).toEqual([`${GAME_DATA_DIR}/raid-1.60.1.70450.json`]);
    expect(r.paths).toContain(RAID_TS);
  });

  it("removes a talent file for a class that left the build", async () => {
    commitBuild(root, 70450, { ...v1, classes: [trimmed(70450, v1.nodes), trimmed(70450, [node(9, "Bash")], { classId: 11, className: "Druid" })] });
    expect(readdirSync(site("talents")).sort()).toEqual(["druid.json", "rogue.json"]);
    await runWatch(options(), fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2)).deps);
    expect(readdirSync(site("talents"))).toEqual(["rogue.json"]);
  });

  it("opens no second pull request while one is open, and extracts nothing", async () => {
    const open: PrRef = { number: 40, state: "OPEN", headRefName: branchFor("wow_classic_beta", { buildId: 70450, buildConfig: CONFIG_A }) };
    const { deps, calls } = fakes({ id: 70450 }, () => extracted(70450, v1), [open]);
    expect(await runWatch(options(), deps)).toMatchObject([{ action: "open", pr: 40 }]);
    expect(calls.extract).toBe(0);
    expect(existsSync(site("."))).toBe(false);
  });

  it("refreshes the open pull request when asked", async () => {
    const open: PrRef = { number: 40, state: "OPEN", headRefName: branchFor("wow_classic_beta", { buildId: 70450, buildConfig: CONFIG_A }) };
    const [r] = await runWatch(options({ redo: true }), fakes({ id: 70450 }, () => extracted(70450, v1), [open]).deps);
    expect(r).toMatchObject({ action: "update", pr: 40, branch: open.headRefName });
  });

  it("leaves a declined build alone", async () => {
    const closed: PrRef = { number: 41, state: "CLOSED", headRefName: branchFor("wow_classic_beta", { buildId: 70450, buildConfig: CONFIG_A }) };
    const { deps, calls } = fakes({ id: 70450 }, () => extracted(70450, v1), [closed]);
    expect((await runWatch(options(), deps))[0]).toMatchObject({ action: "declined", pr: 41 });
    expect(calls.extract).toBe(0);
  });

  it("lists older open pull requests in the body of the newer one", async () => {
    const old: PrRef = { number: 40, state: "OPEN", headRefName: branchFor("wow_classic_beta", { buildId: 70450, buildConfig: CONFIG_A }) };
    const [r] = await runWatch(options(), fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2), [old]).deps);
    expect(readFileSync(r.bodyFile!, "utf8")).toContain("#40");
  });

  it("in check mode only decides", async () => {
    const { deps, calls } = fakes({ id: 70450 }, () => extracted(70450, v1));
    expect((await runWatch(options({ checkOnly: true }), deps))[0].action).toBe("create");
    expect(calls.extract).toBe(0);
    expect(existsSync(site("."))).toBe(false);
  });

  it("in a dry run writes only under the out directory and leaves the repository alone", async () => {
    commitBuild(root, 70450, v1, { raidTs: true });
    const before = readFileSync(join(root, RAID_TS), "utf8");
    const [r] = await runWatch(options({ dryRun: true }), fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2)).deps);
    expect(r.summary).toContain("compared with 1.60.1.70450");
    expect(r.remove).toEqual([`${GAME_DATA_DIR}/raid-1.60.1.70450.json`]);
    expect(existsSync(site("raid-1.60.1.70450.json"))).toBe(true);
    expect(existsSync(site("raid-1.60.1.70460.json"))).toBe(false);
    expect(readFileSync(join(root, RAID_TS), "utf8")).toBe(before);
    expect(existsSync(join(out, "dry-run", "tree", GAME_DATA_DIR, "raid-1.60.1.70460.json"))).toBe(true);
    expect(readFileSync(join(out, "dry-run", "tree", RAID_TS), "utf8")).toContain("raid-1.60.1.70460.json");
  });

  it("refuses --force outside a dry run", async () => {
    await expect(runWatch(options({ force: true }), fakes({ id: 70450 }, () => extracted(70450, v1)).deps)).rejects.toThrow("--force");
  });

  it("with --force regenerates the committed build and finds no difference, pinning its table layouts", async () => {
    commitBuild(root, 70450, v1, { raidTs: true });
    // A different extraction time must not count as a difference.
    const { deps, calls } = fakes({ id: 70450 }, () => extracted(70450, v1));
    const [r] = await runWatch(options({ dryRun: true, force: true }), deps);
    expect(r.action).toBe("create");
    expect(r.differing).toEqual([]);
    expect(r.summary).toContain("committed ones (extractedAt ignored): none");
    expect(calls.definitions).toEqual(["abc123abc123"]);
  });

  it("with --force reports a generated file that differs", async () => {
    commitBuild(root, 70450, v1, { raidTs: true });
    const changed = { ...v1, raid: raid("1.60.1.70450", "raid") };
    const [r] = await runWatch(options({ dryRun: true, force: true }), fakes({ id: 70450 }, () => extracted(70450, changed)).deps);
    expect(r.differing).toEqual([`${GAME_DATA_DIR}/raid-1.60.1.70450.json`]);
  });

  it("trusts the files when the CDN is a build ahead of the version service", async () => {
    const [r] = await runWatch(options(), fakes({ id: 70450 }, () => extracted(70460, v2)).deps);
    expect(r).toMatchObject({ buildId: 70460, branch: "game-build/wow_classic_beta-70460-bbbbbbbb" });
  });

  it("reports a failing product", async () => {
    const { deps } = fakes({ id: 70450 }, () => extracted(70450, v1));
    deps.fetchVersions = async () => { throw new Error("HTTP 503"); };
    expect(await runWatch(options(), deps)).toMatchObject([{ product: "wow_classic_beta", error: "HTTP 503" }]);
  });

  it("fails on an extraction error and writes nothing", async () => {
    const { deps } = fakes({ id: 70450 }, () => { throw new Error("could not read TraitNode (no layout)"); });
    const [r] = await runWatch(options(), deps);
    expect(r.error).toContain("TraitNode");
    expect(existsSync(site("."))).toBe(false);
  });

  it("frees the scratch files even when generating fails", async () => {
    const { deps, calls } = fakes({ id: 70450 }, () => extracted(70450, v1, { generate: () => { throw new Error("script failed"); } }));
    expect((await runWatch(options(), deps))[0].error).toContain("script failed");
    expect(calls.disposed).toBe(1);
  });

  it("refuses an odd version name from the service", async () => {
    const { deps } = fakes({ id: 70450 }, () => extracted(70450, v1));
    deps.fetchVersions = async () => versionsText(70450, CONFIG_A, "1.0; $(evil)");
    expect((await runWatch(options(), deps))[0].error).toContain("odd version");
  });

  it("gives the same entry when a build whose pull request was not merged is run again", async () => {
    commitBuild(root, 70450, v1, { raidTs: true });
    await runWatch(options(), fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2)).deps);
    const first = readFileSync(changeFile(70460), "utf8");
    // Main still has build 70450's files: put them back, then run the new build again.
    rmSync(site("."), { recursive: true });
    commitBuild(root, 70450, v1, { raidTs: true });
    await runWatch(options(), fakes({ id: 70460, config: CONFIG_B }, () => extracted(70460, v2)).deps);
    expect(readFileSync(changeFile(70460), "utf8")).toBe(first);
  });
});
