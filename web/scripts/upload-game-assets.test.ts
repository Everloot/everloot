import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { folderProblems, isPrivateFile, isPublicFile, isRenderFile, missingRemote, namesFileCheck, parseUploadArgs, rendersCheck, uploadOrder, withRetry } from "./game-assets-upload.mjs";

test("arguments: a folder or --snapshot <file>; a flag is never read as the path", () => {
  expect(parseUploadArgs(["../kb/data/assets/b", "--dry-run"])).toMatchObject({ folder: "../kb/data/assets/b", dry: true, snapshot: null, error: null });
  expect(parseUploadArgs(["--snapshot", "s.sqlite", "--dry-run"])).toMatchObject({ snapshot: "s.sqlite", dry: true, folder: null, error: null });
  expect(parseUploadArgs(["--dry-run", "--snapshot=s.sqlite", "--skip-items"])).toMatchObject({ snapshot: "s.sqlite", dry: true, skipItems: true, error: null });
  expect(parseUploadArgs(["--snapshot", "--dry-run", "s.sqlite"]).error).toMatch(/--snapshot needs/);
  expect(parseUploadArgs(["--snapshot"]).error).toMatch(/--snapshot needs/);
  expect(parseUploadArgs([]).error).toMatch(/nothing to upload/);
  expect(parseUploadArgs(["a", "b"]).error).toMatch(/one folder only/);
  expect(parseUploadArgs(["--snapshot", "s.sqlite", "folder"]).error).toMatch(/not both/);
  expect(parseUploadArgs(["--force"]).error).toMatch(/unknown option/);
});

test("the public bucket takes images and the manifest only; the private one the item index and shards only", () => {
  for (const f of ["manifest.json", "icons/1.webp", "maps/13-small.webp", "frames/talents-gate.webp"]) expect(isPublicFile(f), f).toBe(true);
  for (const f of ["items/0.json", "items.json", "checksums.json", "icons/1.png", "items/0.webp"]) expect(isPublicFile(f), f).toBe(false);
  for (const f of ["items.json", "items/0.json", "items/123.json"]) expect(isPrivateFile(f), f).toBe(true);
  for (const f of ["manifest.json", "icons/1.webp", "items/x.json", "items/0.json.bak"]) expect(isPrivateFile(f), f).toBe(false);
});

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

test("a folder is checked against its list: missing, unlisted, changed and wrong-kind files are all named", () => {
  const root = mkdtempSync(join(tmpdir(), "everloot-upload-"));
  mkdirSync(join(root, "icons"));
  mkdirSync(join(root, "items"));
  for (const [f, body] of [["manifest.json", "{}"], ["checksums.json", "{}"], ["icons/1.webp", "a"], ["icons/2.webp", "b"], ["items/0.json", "{}"]]) writeFileSync(join(root, f), body);
  const expected = new Map([["icons/1.webp", hash("a")], ["icons/2.webp", hash("changed")], ["icons/3.webp", hash("c")]]);
  const { present, problems } = folderProblems(root, expected, { index: "manifest.json", allowed: isPublicFile, skip: ["checksums.json"] });
  expect(present.sort()).toEqual(["icons/1.webp", "icons/2.webp", "items/0.json"]);
  expect(problems.sort()).toEqual(["hash differs: icons/2.webp", "may not go to this bucket: items/0.json", "missing: icons/3.webp", "not listed: items/0.json"]);
});

test("the manifest or index goes up last, after every file it lists", () => {
  expect(uploadOrder(["icons/1.webp", "manifest.json", "maps/13.webp"], "manifest.json")).toEqual(["icons/1.webp", "maps/13.webp", "manifest.json"]);
  expect(uploadOrder(["items/0.json"], "items.json").at(-1)).toBe("items.json");
});

test("a failed upload is tried again with growing waits, and gives up after four tries", async () => {
  const sleep = vi.fn(async (_ms: number) => {});
  let calls = 0;
  expect(await withRetry(async () => { if (++calls < 3) throw new Error("503"); return "ok"; }, { sleep })).toBe("ok");
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  await expect(withRetry(async () => { throw new Error("403"); }, { sleep })).rejects.toThrow("403");
});

test("a shown-names file goes under its build folder, and only when it is one", () => {
  const file = { schema: "everloot.item-names/1", build: { version: "1.60.1.70450" }, wiki: { licence: "CC-BY-SA-4.0" }, count: 1, names: { 2589: { n: "Linen Cloth", q: 1, w: "Linen_Cloth" } } };
  expect(namesFileCheck(file, "wow_classic_beta-70450-84bea423-names")).toEqual({ prefix: "wow_classic_beta-70450-84bea423", problems: [] });
  expect(namesFileCheck(file, "wow_classic_beta-70450-84bea423-private").problems[0]).toMatch(/-names folder/);
  expect(namesFileCheck({ ...file, count: 2 }, "b-names").problems).toEqual(["count is 2 but the file holds 1 names"]);
  expect(namesFileCheck({ ...file, schema: "everloot.game-items/1" }, "b-names").problems[0]).toMatch(/schema/);
  expect(namesFileCheck({ ...file, wiki: { licence: "CC-BY-NC" } }, "b-names").problems).toEqual(["the wiki source is not CC-BY-SA-4.0"]);
});

test("the quest, set and spell names files are checked by their own schema; only the quest file needs the wiki licence", () => {
  const build = { version: "1.60.1.70450" };
  const quests = { schema: "everloot.quest-names/1", build, wiki: { licence: "CC-BY-SA-4.0" }, count: 1, names: { 176: { n: "Wanted: Hogger", w: "Wanted:_Hogger" } } };
  expect(namesFileCheck(quests, "b-names", "quest-names.json").problems).toEqual([]);
  expect(namesFileCheck({ ...quests, wiki: undefined }, "b-names", "quest-names.json").problems).toEqual(["the wiki source is not CC-BY-SA-4.0"]);
  const sets = { schema: "everloot.item-set-names/1", build, count: 1, names: { 1: "The Gladiator" } };
  expect(namesFileCheck(sets, "b-names", "item-set-names.json").problems).toEqual([]);
  expect(namesFileCheck(sets, "b-names", "spell-names.json").problems).toEqual(["schema is everloot.item-set-names/1, expected everloot.spell-names/1"]);
  expect(namesFileCheck({ ...sets, schema: "everloot.spell-names/1" }, "b-names", "spell-names.json").problems).toEqual([]);
  expect(namesFileCheck(sets, "b-names", "items.json").problems[0]).toMatch(/not a names file/);
});

test("--folder sends a names file to the live folder of the same build, never another build's", () => {
  const file = { schema: "everloot.item-set-names/1", build: { version: "1.60.1.70450" }, count: 1, names: { 1: "The Gladiator" } };
  const check = (live: string) => namesFileCheck(file, "wow_classic_beta-70450-84bea423-names", "item-set-names.json", live);
  expect(check("wow_classic_beta-70450-84bea423-2")).toEqual({ prefix: "wow_classic_beta-70450-84bea423-2", problems: [] });
  expect(check("wow_classic_beta-70450-84bea423").prefix).toBe("wow_classic_beta-70450-84bea423");
  expect(check("wow_classic_beta-70451-0000aaaa")).toMatchObject({ prefix: null, problems: [expect.stringMatching(/not a folder of build/)] });
  expect(check("wow_classic_beta-70450-84bea4239").problems[0]).toMatch(/not a folder of build/);
  expect(check("../x").prefix).toBeNull();
});

test("--renders <folder> uploads model pictures; --folder names the live build folder", () => {
  expect(parseUploadArgs(["--renders", "r/wowf-71139-7a16decd", "--dry-run"])).toMatchObject({ renders: "r/wowf-71139-7a16decd", dry: true, folder: null, live: null, error: null });
  expect(parseUploadArgs(["--renders=r/b", "--folder=wowf-71139-7a16decd-2"])).toMatchObject({ renders: "r/b", live: "wowf-71139-7a16decd-2", error: null });
  expect(parseUploadArgs(["--renders", "--dry-run"]).error).toMatch(/--renders needs/);
  expect(parseUploadArgs(["--renders", "r/b", "--snapshot", "s.sqlite"]).error).toMatch(/one of/);
  expect(parseUploadArgs(["--folder=x", "a"]).error).toMatch(/--folder goes with --renders/);
});

test("model pictures are hash-named WebP files in the shared renders folder, nothing else", () => {
  expect(isRenderFile(`renders/${"a".repeat(32)}.webp`)).toBe(true);
  for (const f of [`renders/${"a".repeat(31)}.webp`, `renders/${"A".repeat(32)}.webp`, `x/renders/${"a".repeat(32)}.webp`, "renders/1.webp", `renders/${"a".repeat(32)}.png`]) expect(isRenderFile(f), f).toBe(false);
});

const pic = (c: string) => `renders/${c.repeat(32)}.webp`;
function rendersFolder(files: Record<string, string>, listed: Record<string, string>, extra: Record<string, unknown> = {}) {
  const out = mkdtempSync(join(tmpdir(), "everloot-renders-"));
  const root = join(out, "wowf-71139-7a16decd");
  mkdirSync(join(out, "renders"));
  mkdirSync(root);
  for (const [f, body] of Object.entries(files)) writeFileSync(join(out, f), body);
  const manifest = { schema: "everloot.game-renders/1", build: { version: "1.60.1.71139" }, creatureDisplays: { 501: pic("a") }, itemDisplays: { 700: pic("b") }, ...extra };
  const checksums = { files: Object.fromEntries(Object.entries(listed).map(([f, body]) => [f, { bytes: body.length, sha256: hash(body) }])) };
  return { root, manifest, checksums };
}

test("a renders folder is checked: its pictures are where the manifest says, listed, unchanged and of the right kind", () => {
  const ok = rendersFolder({ [pic("a")]: "A", [pic("b")]: "B" }, { [pic("a")]: "A", [pic("b")]: "B" });
  expect(rendersCheck(ok.root, ok.manifest, ok.checksums)).toEqual({ prefix: "wowf-71139-7a16decd", files: [pic("a"), pic("b")], problems: [] });
  const bad = rendersFolder({ [pic("a")]: "changed" }, { [pic("a")]: "A", "renders/x.webp": "X" });
  expect(rendersCheck(bad.root, bad.manifest, bad.checksums).problems.sort()).toEqual([
    `hash differs: ${pic("a")}`, "may not go to this bucket: renders/x.webp", "missing: renders/x.webp", `named in renders.json but not listed: ${pic("b")}`,
  ]);
  expect(rendersCheck(ok.root, { ...ok.manifest, schema: "everloot.game-assets/1" }, ok.checksums).problems).toEqual(["renders.json has schema everloot.game-assets/1, expected everloot.game-renders/1"]);
});

test("renders.json goes to the live folder of the same build only", () => {
  const ok = rendersFolder({ [pic("a")]: "A", [pic("b")]: "B" }, { [pic("a")]: "A", [pic("b")]: "B" });
  expect(rendersCheck(ok.root, ok.manifest, ok.checksums, "wowf-71139-7a16decd-2").prefix).toBe("wowf-71139-7a16decd-2");
  expect(rendersCheck(ok.root, ok.manifest, ok.checksums, "wowf-71200-00000000").problems).toEqual(["--folder wowf-71200-00000000 is not a folder of build wowf-71139-7a16decd"]);
});

test("only pictures the bucket does not hold yet are sent: a picture's name is the hash of what made it", async () => {
  const held = new Set([pic("a")]);
  expect(await missingRemote([pic("a"), pic("b")], async (f: string) => held.has(f))).toEqual([pic("b")]);
});
