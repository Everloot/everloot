import { expect, test } from "vitest";
import { candidateRoots, detectGameFolders, foreverSuggestion, resolvePickedFolder, type FsLike } from "../src/main/game-folder";

/** A fake tree: directories map to their entries, files are listed with a leading "file:". */
function fakeFs(tree: Record<string, string[]>): FsLike {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const files = new Set<string>();
  for (const [dir, entries] of Object.entries(tree)) for (const e of entries) if (e.startsWith("file:")) files.add(`${norm(dir)}/${e.slice(5)}`);
  return {
    isDir: (p) => norm(p) in tree,
    isFile: (p) => files.has(norm(p)),
    readdir: (p) => (tree[norm(p)] ?? []).map((e) => e.replace(/^file:/, "")),
  };
}

const sv = (product: string, account: string) => [`${product}/WTF`, `${product}/WTF/Account`, `${product}/WTF/Account/${account}`, `${product}/WTF/Account/${account}/SavedVariables`];
const tree = (root: string) => {
  const t: Record<string, string[]> = { [root]: ["_retail_", "_classic_era_", "_anniversary_", "_classic_beta_", "Data", "Launcher.db"] };
  const add = (product: string, accounts: Record<string, boolean>) => {
    const p = `${root}/${product}`;
    t[p] = ["WTF"]; t[`${p}/WTF`] = ["Account"]; t[`${p}/WTF/Account`] = Object.keys(accounts);
    for (const [a, has] of Object.entries(accounts)) {
      for (const d of sv(p, a).slice(2)) t[d] = t[d] ?? [];
      t[`${p}/WTF/Account/${a}`] = ["SavedVariables"];
      t[`${p}/WTF/Account/${a}/SavedVariables`] = has ? ["file:Everloot.lua"] : ["file:Other.lua"];
    }
  };
  add("_retail_", { ACC1: false });
  add("_classic_era_", { ACC1: true, ACC2: true });
  add("_anniversary_", { ACC1: true });
  t[`${root}/_classic_beta_`] = [];
  return t;
};

test("product folders with Everloot data come first, then the rest with accounts, then never-played ones", () => {
  const root = "C:/Program Files (x86)/World of Warcraft";
  const found = detectGameFolders([root, "C:/Games/World of Warcraft"], fakeFs(tree(root)));
  expect(found.map((c) => [c.product, c.files, c.hasAccounts])).toEqual([["_classic_era_", 2, true], ["_anniversary_", 1, true], ["_retail_", 0, true], ["_classic_beta_", 0, false]]);
  expect(found[0].folder.replace(/\\/g, "/")).toBe(`${root}/_classic_era_`);
});

test("a root that is itself a product folder is offered", () => {
  const t = tree("D:/WoW");
  const found = detectGameFolders(["D:/WoW/_anniversary_"], fakeFs(t));
  expect(found.map((c) => c.product)).toEqual(["_anniversary_"]);
});

test("a Browse pick of World of Warcraft, WTF or Interface lands on the product folder", () => {
  const root = "C:/Program Files (x86)/World of Warcraft";
  const fs = fakeFs({ ...tree(root), [`${root}/_classic_era_/Interface`]: [] });
  const era = `${root}/_classic_era_`;
  const norm = (p: string) => p.replace(/\\/g, "/");
  expect(norm(resolvePickedFolder(root, fs))).toBe(era);
  expect(norm(resolvePickedFolder(era, fs))).toBe(era);
  expect(norm(resolvePickedFolder(`${era}/WTF`, fs))).toBe(era);
  expect(norm(resolvePickedFolder(`${era}/Interface`, fs))).toBe(era);
  expect(resolvePickedFolder("D:/Elsewhere", fs)).toBe("D:/Elsewhere");
});

test("each OS looks where Battle.net and Wine put the game", () => {
  const win = candidateRoots({ platform: "win32", env: { "ProgramFiles(x86)": "C:\\Program Files (x86)", ProgramFiles: "C:\\Program Files" }, home: "C:\\Users\\p" });
  expect(win[0]).toBe("C:\\Program Files (x86)\\World of Warcraft");
  expect(win).toContain("D:\\Games\\World of Warcraft");
  expect(new Set(win).size).toBe(win.length);
  expect(candidateRoots({ platform: "darwin", env: {}, home: "/Users/p" })[0]).toBe("/Applications/World of Warcraft");
  const linux = candidateRoots({ platform: "linux", env: {}, home: "/home/p" });
  expect(linux.some((r) => r.includes(".wine"))).toBe(true);
  expect(linux.some((r) => r.includes("Games/battlenet"))).toBe(true);
});

test("WoW: Forever comes first, even before a folder that already has Everloot data", () => {
  // The addon is built for Forever only, so a beta or another classic folder with old data is the wrong default.
  const root = "C:/Program Files (x86)/World of Warcraft";
  const t = tree(root);
  t[root] = [...t[root], "_forever_"];
  t[`${root}/_forever_`] = ["WTF"]; t[`${root}/_forever_/WTF`] = [];
  const found = detectGameFolders([root], fakeFs(t));
  expect(found.map((c) => c.product)).toEqual(["_forever_", "_classic_era_", "_anniversary_", "_retail_", "_classic_beta_"]);
});

test("a game folder beside an installed WoW: Forever gets Forever suggested, until the player keeps their own", () => {
  const root = "C:/Program Files (x86)/World of Warcraft";
  const fs = fakeFs({ [root]: ["_classic_beta_", "_forever_"], [`${root}/_classic_beta_`]: ["WTF"], [`${root}/_forever_`]: ["Interface"] });
  const beta = `${root}/_classic_beta_`;
  expect(foreverSuggestion(beta, null, fs)?.replace(/\\/g, "/")).toBe(`${root}/_forever_`);
  expect(foreverSuggestion(`${beta}/`, null, fs)?.replace(/\\/g, "/")).toBe(`${root}/_forever_`);
  // Already on Forever, kept on purpose, no Forever beside it, or no folder yet: nothing to suggest.
  expect(foreverSuggestion(`${root}/_forever_`, null, fs)).toBeNull();
  expect(foreverSuggestion(beta, beta, fs)).toBeNull();
  expect(foreverSuggestion("D:/Other/_classic_era_", null, fs)).toBeNull();
  expect(foreverSuggestion(null, null, fs)).toBeNull();
});
