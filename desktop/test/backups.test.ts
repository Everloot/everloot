import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { backupSavedVariables, gameRunning, listBackups, restoreBackup, type RunCommand } from "../src/main/backups";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-backups-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("a backup is a dated copy per account, and only the newest ten per account stay", () => {
  const d = dir();
  const sv = join(d, "WTF", "Account", "MYACC", "SavedVariables", "Everloot.lua");
  mkdirSync(join(sv, ".."), { recursive: true });
  writeFileSync(sv, "EverlootDB = {}");
  const data = join(d, "data");
  const first = backupSavedVariables(sv, data, 10, new Date("2026-10-18T03:04:05.678Z"));
  expect(first.replace(/\\/g, "/")).toMatch(/\/backups\/MYACC-20261018T030405Z\.lua$/);
  expect(readFileSync(first, "utf8")).toBe("EverlootDB = {}");
  for (let i = 1; i <= 12; i++) { writeFileSync(sv, `EverlootDB = { v = ${i} }`); backupSavedVariables(sv, data, 10, new Date(Date.UTC(2026, 9, 18, 4, i))); }
  const kept = readdirSync(join(data, "backups"));
  expect(kept).toHaveLength(10);
  expect(existsSync(first)).toBe(false);
  expect(kept.every((n) => n.startsWith("MYACC-"))).toBe(true);
  const other = join(d, "WTF", "Account", "OTHER", "SavedVariables", "Everloot.lua");
  mkdirSync(join(other, ".."), { recursive: true });
  writeFileSync(other, "x");
  backupSavedVariables(other, data, 10, new Date("2026-10-18T05:00:00Z"));
  expect(readdirSync(join(data, "backups"))).toHaveLength(11);
});

test("an unchanged file gets no second copy, and an account's pruning leaves a longer account name alone", () => {
  const d = dir();
  const data = join(d, "data");
  const file = (account: string) => { const p = join(d, "WTF", "Account", account, "SavedVariables", "Everloot.lua"); mkdirSync(join(p, ".."), { recursive: true }); return p; };
  const a = file("A"), ab = file("A-B");
  writeFileSync(ab, "theirs");
  backupSavedVariables(ab, data, 1, new Date("2026-10-18T01:00:00Z"));
  writeFileSync(a, "same");
  const first = backupSavedVariables(a, data, 1, new Date("2026-10-18T02:00:00Z"));
  // Ten app starts with nothing new: still the one copy, the same file.
  for (let i = 0; i < 10; i++) expect(backupSavedVariables(a, data, 1, new Date(Date.UTC(2026, 9, 18, 3, i)))).toBe(first);
  writeFileSync(a, "changed");
  backupSavedVariables(a, data, 1, new Date("2026-10-18T04:00:00Z"));
  expect(readdirSync(join(data, "backups")).sort()).toEqual(["A-20261018T040000Z.lua", "A-B-20261018T010000Z.lua"]);
});

test("the list is newest first with the account and time parsed from the name", () => {
  const d = dir();
  mkdirSync(join(d, "backups"));
  writeFileSync(join(d, "backups", "ACC-20261018T030405Z.lua"), "a");
  writeFileSync(join(d, "backups", "ACC-20261018T040000Z.lua"), "bb");
  writeFileSync(join(d, "backups", "note.txt"), "no");
  const list = listBackups(d);
  expect(list.map((b) => [b.account, b.at, b.bytes])).toEqual([["ACC", "2026-10-18T04:00:00Z", 2], ["ACC", "2026-10-18T03:04:05Z", 1]]);
  expect(listBackups(join(d, "none"))).toEqual([]);
});

test("restore puts a backup back over the matching account file and keeps a copy of what it replaced", () => {
  const d = dir();
  const sv = join(d, "WTF", "Account", "MYACC", "SavedVariables", "Everloot.lua");
  mkdirSync(join(sv, ".."), { recursive: true });
  writeFileSync(sv, "EverlootDB = { old = 1 }");
  const data = join(d, "data");
  const backup = backupSavedVariables(sv, data, 10, new Date("2026-10-18T03:00:00Z"));
  writeFileSync(sv, "EverlootDB = { broken = 1 }");
  const restored = restoreBackup(backup, data, [sv], new Date("2026-10-18T09:00:00Z"));
  expect(restored).toBe(sv);
  expect(readFileSync(sv, "utf8")).toBe("EverlootDB = { old = 1 }");
  // The file as it was before the restore is now the newest backup, so a restore is itself undoable.
  const list = listBackups(data);
  expect(list[0].at).toBe("2026-10-18T09:00:00Z");
  expect(readFileSync(list[0].file, "utf8")).toBe("EverlootDB = { broken = 1 }");
});

test("restore refuses files outside the backups folder and accounts that are not watched", () => {
  const d = dir();
  const data = join(d, "data");
  mkdirSync(join(data, "backups"), { recursive: true });
  const stray = join(d, "MYACC-20261018T030000Z.lua");
  writeFileSync(stray, "x");
  const sv = join(d, "WTF", "Account", "MYACC", "SavedVariables", "Everloot.lua");
  expect(() => restoreBackup(stray, data, [sv])).toThrow(/backups folder/);
  const other = join(data, "backups", "OTHER-20261018T030000Z.lua");
  writeFileSync(other, "x");
  expect(() => restoreBackup(other, data, [sv])).toThrow(/OTHER/);
  expect(existsSync(sv)).toBe(false);
});

/** A fake process list: answers each command with the given exit code and output, and records what was asked. */
const fake = (code: number, stdout = "") => { const calls: string[][] = []; const run: RunCommand = async (cmd, args) => { calls.push([cmd, ...args]); return { code, stdout }; }; return { run, calls }; };

test("a running World of Warcraft client is seen on Windows, and a list without one is not", async () => {
  const running = fake(0, '"WowClassic.exe","18244","Console","1","1,402,112 K"\r\n');
  expect(await gameRunning("win32", running.run)).toBe(true);
  expect(running.calls[0][0]).toBe("tasklist");
  expect(await gameRunning("win32", fake(0, '"Wow.exe","1","Console","1","900,000 K"').run)).toBe(true);
  // tasklist says so in the system's language and still exits 0.
  expect(await gameRunning("win32", fake(0, "INFO: No tasks are running which match the specified criteria.\r\n").run)).toBe(false);
});

test("macOS and Linux ask pgrep, whose exit code says whether the game runs", async () => {
  expect(await gameRunning("darwin", fake(0, "4242\n").run)).toBe(true);
  expect(await gameRunning("darwin", fake(1).run)).toBe(false);
  expect(await gameRunning("linux", fake(1).run)).toBe(false);
  const mac = fake(1);
  await gameRunning("darwin", mac.run);
  expect(mac.calls[0][0]).toBe("pgrep");
});

test("when the check cannot answer, it says it does not know instead of failing", async () => {
  const broken: RunCommand = async () => { throw new Error("spawn tasklist ENOENT"); };
  expect(await gameRunning("win32", broken)).toBeNull();
  expect(await gameRunning("darwin", fake(2).run)).toBeNull();
  expect(await gameRunning("win32", fake(1).run)).toBeNull();
  expect(await gameRunning("freebsd", fake(0).run)).toBeNull();
});
