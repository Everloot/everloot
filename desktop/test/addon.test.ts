import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, expect, test, vi } from "vitest";
import { checksumFor, extractAddon, installAddon, installedAddonVersion, newestRelease, safeAddonEntries, slotAddons } from "../src/main/addon";

// renameSync passes through to the real one unless a test makes a rename fail, the way an antivirus lock or the running game would.
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});
const realRename = (await vi.importActual<typeof import("node:fs")>("node:fs")).renameSync;
const busy = (path: string) => Object.assign(new Error(`EBUSY: resource busy or locked, rename '${path}'`), { code: "EBUSY" });
/** Makes renames into `to` fail while the others go through. */
const lockRenamesInto = (to: string, times: number) => {
  let left = times;
  vi.mocked(renameSync).mockImplementation((from, dest) => {
    if (String(dest) === to && left-- > 0) throw busy(String(from));
    realRename(from, dest);
  });
};

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-addon-")); dirs.push(d); return d; };
afterEach(() => {
  vi.mocked(renameSync).mockImplementation(realRename);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A game folder with an installed 0.3.2 addon and a save file under WTF, which no install may touch. */
const game = () => {
  const root = dir(), addons = join(root, "Interface", "AddOns"), saved = join(root, "WTF", "Account", "TEST", "SavedVariables");
  mkdirSync(join(addons, "Everloot"), { recursive: true });
  writeFileSync(join(addons, "Everloot", "Everloot.toc"), "## Version: 0.3.2\n");
  writeFileSync(join(addons, "Everloot", "core.lua"), "-- old core");
  mkdirSync(saved, { recursive: true });
  writeFileSync(join(saved, "Everloot.lua"), "EverlootDB = {}\n");
  return { addons, save: join(saved, "Everloot.lua") };
};

const enc = (s: string) => new TextEncoder().encode(s);
const goodZip = (version: string) => zipSync({
  "Everloot/Everloot.toc": enc(`## Interface: 16001\n## Version: ${version}\n`),
  "Everloot/core.lua": enc("-- core"),
  "Everloot/modules/ask.lua": enc("-- ask"),
  "README.md": enc("stray"),
});

test("the installed version is read from the TOC, and the slot addons are reported", () => {
  const addons = dir();
  expect(installedAddonVersion(addons)).toBeNull();
  mkdirSync(join(addons, "Everloot"), { recursive: true });
  writeFileSync(join(addons, "Everloot", "Everloot.toc"), "## Interface: 16001\r\n## Version: 0.3.3\r\n");
  expect(installedAddonVersion(addons)).toBe("0.3.3");
  expect(slotAddons(addons)).toEqual({ prices: false, answers: false, builds: false });
  mkdirSync(join(addons, "EverlootPrices"));
  writeFileSync(join(addons, "EverlootPrices", "EverlootPrices.toc"), "x");
  expect(slotAddons(addons).prices).toBe(true);
  mkdirSync(join(addons, "EverlootBuilds"));
  writeFileSync(join(addons, "EverlootBuilds", "EverlootBuilds.toc"), "x");
  expect(slotAddons(addons)).toEqual({ prices: true, answers: false, builds: true });
});

test("only regular files under Everloot/ are written; traversal, absolute and backslash names are ignored", () => {
  const entries = safeAddonEntries({
    "Everloot/Everloot.toc": enc("a"), "Everloot/": new Uint8Array(), "Everloot/../x.lua": enc("b"), "/Everloot/abs.lua": enc("c"),
    "Everloot\\win.lua": enc("d"), "Other/file.lua": enc("e"), "Everloot/sub/./ok.lua": enc("f"), "Everloot/deep/file.lua": enc("g"),
  });
  expect(entries.map(([n]) => n)).toEqual(["Everloot/Everloot.toc", "Everloot/deep/file.lua"]);
});

test("extracting swaps the folder whole and keeps the old one when the zip is bad", () => {
  const addons = dir();
  mkdirSync(join(addons, "Everloot"), { recursive: true });
  writeFileSync(join(addons, "Everloot", "Everloot.toc"), "## Version: 0.3.2\n");
  writeFileSync(join(addons, "Everloot", "stale.lua"), "old");
  expect(extractAddon(goodZip("0.3.3"), addons)).toBe(3);
  expect(installedAddonVersion(addons)).toBe("0.3.3");
  expect(existsSync(join(addons, "Everloot", "stale.lua"))).toBe(false);
  expect(existsSync(join(addons, "Everloot", "modules", "ask.lua"))).toBe(true);
  expect(existsSync(join(addons, "Everloot.old"))).toBe(false);
  expect(existsSync(join(addons, "README.md"))).toBe(false);
  expect(() => extractAddon(zipSync({ "Everloot/core.lua": enc("x") }), addons)).toThrow(/Everloot\.toc/);
  expect(() => extractAddon(zipSync({ "Other/x.lua": enc("x") }), addons)).toThrow(/no Everloot\/ files/);
  expect(installedAddonVersion(addons)).toBe("0.3.3");
});

test("when the new folder cannot take the old one's place, the old addon is put back", () => {
  const { addons, save } = game();
  const target = join(addons, "Everloot");
  lockRenamesInto(target, 1);
  expect(() => extractAddon(goodZip("0.3.3"), addons)).toThrow(/EBUSY/);
  expect(installedAddonVersion(addons)).toBe("0.3.2");
  expect(readFileSync(join(target, "core.lua"), "utf8")).toBe("-- old core");
  expect(existsSync(`${target}.old`)).toBe(false);
  expect(readFileSync(save, "utf8")).toBe("EverlootDB = {}\n");
  vi.mocked(renameSync).mockImplementation(realRename);
  expect(extractAddon(goodZip("0.3.3"), addons)).toBe(3);
  expect(installedAddonVersion(addons)).toBe("0.3.3");
});

test("when the old addon cannot be put back either, both copies stay on disk and the error says where", () => {
  const { addons, save } = game();
  const target = join(addons, "Everloot");
  lockRenamesInto(target, 2);
  expect(() => extractAddon(goodZip("0.3.3"), addons)).toThrow(/EBUSY[\s\S]*Everloot\.old[\s\S]*Everloot\.new/);
  expect(existsSync(target)).toBe(false);
  expect(readFileSync(join(`${target}.old`, "Everloot.toc"), "utf8")).toBe("## Version: 0.3.2\n");
  expect(readFileSync(join(`${target}.old`, "core.lua"), "utf8")).toBe("-- old core");
  expect(readFileSync(join(`${target}.new`, "core.lua"), "utf8")).toBe("-- core");
  expect(readFileSync(save, "utf8")).toBe("EverlootDB = {}\n");
});

test("a first install that cannot move the new folder into place fails and leaves no addon folder behind", () => {
  const { addons, save } = game();
  const target = join(addons, "Everloot");
  rmSync(target, { recursive: true });
  lockRenamesInto(target, 1);
  expect(() => extractAddon(goodZip("0.3.3"), addons)).toThrow(/EBUSY/);
  expect(existsSync(target)).toBe(false);
  expect(existsSync(`${target}.old`)).toBe(false);
  expect(readFileSync(save, "utf8")).toBe("EverlootDB = {}\n");
});

test("the newest release with the prefix wins; the other prefix, drafts and pre-releases are skipped", () => {
  const releases = [
    { tag_name: "desktop-v0.4.0", html_url: "d" },
    { tag_name: "addon-v0.3.3", html_url: "a333" },
    { tag_name: "addon-v0.3.10", html_url: "a3310" },
    { tag_name: "addon-v1.0.0", html_url: "pre", prerelease: true },
    { tag_name: "addon-v2.0.0", html_url: "draft", draft: true },
  ];
  expect(newestRelease(releases, "addon-v")).toEqual({ version: "0.3.10", url: "a3310" });
  expect(newestRelease(releases, "desktop-v")).toEqual({ version: "0.4.0", url: "d" });
  expect(newestRelease(releases, "nothing-v")).toBeNull();
});

test("an install verifies the zip against the release's SHA256SUMS and refuses a mismatch", async () => {
  const addons = dir();
  const zip = goodZip("0.3.3");
  const sum = createHash("sha256").update(zip).digest("hex");
  const sums = `${sum}  Everloot-0.3.3.zip\nabc  other.zip\n`;
  expect(checksumFor(sums, "Everloot-0.3.3.zip")).toBe(sum);
  expect(checksumFor(sums, "missing.zip")).toBeNull();
  const send = vi.fn(async (url: string) => {
    if (url.endsWith("/SHA256SUMS")) return new Response(sums);
    if (url === "https://everloot.app/downloads/Everloot-0.3.3.zip") return new Response(zip);
    return new Response("", { status: 404 });
  });
  const r = await installAddon({ version: "0.3.3", endpoint: "https://everloot.app", addonsDir: addons, send: send as unknown as typeof fetch });
  expect(r).toEqual({ version: "0.3.3", files: 3 });
  expect(readFileSync(join(addons, "Everloot", "core.lua"), "utf8")).toBe("-- core");
  const tampered = vi.fn(async (url: string) => (url.endsWith("/SHA256SUMS") ? new Response(sums) : new Response(goodZip("9.9.9"))));
  await expect(installAddon({ version: "0.3.3", endpoint: "https://everloot.app", addonsDir: addons, send: tampered as unknown as typeof fetch })).rejects.toThrow(/does not match/);
  expect(installedAddonVersion(addons)).toBe("0.3.3");
  const unlisted = vi.fn(async () => new Response("deadbeef  nope.zip"));
  await expect(installAddon({ version: "0.3.3", endpoint: "https://everloot.app", addonsDir: addons, send: unlisted as unknown as typeof fetch })).rejects.toThrow(/not listed/);
});
