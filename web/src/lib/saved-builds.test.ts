import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_TOOL_NAMES } from "@everloot/protocol";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { openDb } from "../../../kb/src/db";
import { replaceSourceRows } from "../../../kb/src/entities";
import { snapshot } from "../../../kb/src/snapshot";
import { safeReturnTo, signInPath } from "./auth/return-to";
import { codeClass, editPath, LIMITS, MY_BUILDS, parseBuildInput, parseCharacterInput, savedBuildsOn, toBuild, toCharacters, type BuildRow } from "./saved-builds";

// The public MCP endpoint, for the catalogue test at the end: its per-IP quota lets every request through.
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { mcp: async () => ({ allowed: true, retryAfter: 0 }) } }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: async () => ({ uploads: 0, records: [], dataAsOf: null }) } }));

const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
const WARRIOR = "EL1-warrior-0-1.60.1.70450-MTE6NQ";
const ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";

test("the switch is on only for exactly 1", () => {
  expect(savedBuildsOn({ EVERLOOT_SAVED_BUILDS: "1" })).toBe(true);
  for (const value of [undefined, "", "0", "true", " 1", "yes"]) expect(savedBuildsOn({ EVERLOOT_SAVED_BUILDS: value })).toBe(false);
});

test("a share code must be shaped right, decode and name a calculator class", () => {
  expect(codeClass(MAGE)).toBe("mage");
  expect(codeClass(WARRIOR)).toBe("warrior");
  expect(codeClass("EL1-monk-0-1.60-MTE6NQ")).toBeNull();
  expect(codeClass("EL2-mage-0-1.60-MTE6NQ")).toBeNull();
  expect(codeClass("EL1-mage-0-1.60-")).toBeNull();
  expect(codeClass("EL1-mage-0-1..60-MTE6NQ")).toBeNull();
  expect(codeClass("EL1-mage-0-1.60-!!")).toBeNull();
  expect(codeClass(`EL1-mage-0-1.60-${"A".repeat(400)}`)).toBeNull();
});

test("a build needs a name of 1 to 60 characters, counted as whole characters", () => {
  expect(parseBuildInput({ name: "  ", code: MAGE })).toMatchObject({ ok: false });
  expect(parseBuildInput({ name: "x".repeat(61), code: MAGE })).toMatchObject({ ok: false });
  expect(parseBuildInput({ name: "🐉".repeat(60), code: MAGE })).toMatchObject({ ok: true });
  expect(parseBuildInput({ name: 42, code: MAGE })).toMatchObject({ ok: false });
  const parsed = parseBuildInput({ name: "  Fire\u0007 raid  ", code: ` ${MAGE} `, notes: "line one\r\nline two\u0000" });
  expect(parsed).toEqual({ ok: true, value: {
    id: null, name: "Fire raid", notes: "line one\nline two", characterId: null, code: MAGE, code2: null, shared: null, active: null, showName: null,
  } });
});

test("notes are optional, plain and up to 1,000 characters", () => {
  expect(parseBuildInput({ name: "a", code: MAGE, notes: "" })).toMatchObject({ ok: true, value: { notes: null } });
  expect(parseBuildInput({ name: "a", code: MAGE, notes: "x".repeat(LIMITS.notes) })).toMatchObject({ ok: true });
  expect(parseBuildInput({ name: "a", code: MAGE, notes: "x".repeat(LIMITS.notes + 1) })).toMatchObject({ ok: false });
  expect(parseBuildInput({ name: "a", code: MAGE, notes: ["no"] })).toMatchObject({ ok: false });
});

test("both talent sets must be valid codes of the same class", () => {
  expect(parseBuildInput({ name: "a", code: MAGE, code2: MAGE2 })).toMatchObject({ ok: true, value: { code2: MAGE2 } });
  expect(parseBuildInput({ name: "a", code: MAGE, code2: "" })).toMatchObject({ ok: true, value: { code2: null } });
  expect(parseBuildInput({ name: "a", code: MAGE, code2: WARRIOR })).toEqual({ ok: false, error: "Both talent sets must be for the same class." });
  expect(parseBuildInput({ name: "a", code: "nope" })).toMatchObject({ ok: false });
  expect(parseBuildInput({ name: "a" })).toMatchObject({ ok: false });
});

test("ids are uuids and the switches are booleans", () => {
  expect(parseBuildInput({ id: ID, characterId: ID, name: "a", code: MAGE, shared: false, active: true, showName: true }))
    .toMatchObject({ ok: true, value: { id: ID, characterId: ID, shared: false, active: true, showName: true } });
  expect(parseBuildInput({ id: "1", name: "a", code: MAGE })).toMatchObject({ ok: false });
  expect(parseBuildInput({ characterId: "x'; drop table", name: "a", code: MAGE })).toMatchObject({ ok: false });
  expect(parseBuildInput({ name: "a", code: MAGE, shared: "yes" })).toMatchObject({ ok: false });
  expect(parseBuildInput(null)).toMatchObject({ ok: false });
});

test("a character label: a name of 1 to 24, a class, optional realm and note", () => {
  expect(parseCharacterInput({ name: " Jaina ", classSlug: "mage", realm: " ", note: "" }))
    .toEqual({ ok: true, value: { id: null, name: "Jaina", classSlug: "mage", realm: null, note: null } });
  expect(parseCharacterInput({ name: "x".repeat(25), classSlug: "mage" })).toMatchObject({ ok: false });
  expect(parseCharacterInput({ name: "Jaina", classSlug: "monk" })).toMatchObject({ ok: false });
  expect(parseCharacterInput({ name: "Jaina", classSlug: "mage", realm: "x".repeat(33) })).toMatchObject({ ok: false });
  expect(parseCharacterInput({ name: "Jaina", classSlug: "mage", note: "x".repeat(141) })).toMatchObject({ ok: false });
  expect(parseCharacterInput({ id: "nope", name: "Jaina", classSlug: "mage" })).toMatchObject({ ok: false });
});

test("a stored row becomes the API's shape, with the short link only while shared", () => {
  const row: BuildRow = {
    id: ID, slug: "AbCd1234", name: "Fire", notes: null, class_slug: "mage", character_id: null, code: MAGE, code2: null,
    game_build: "1.60.1.70450", shared: true, show_name: false, active: false, updated_at: "2026-10-20T12:00:00.123456+00:00",
  };
  expect(toBuild(row, "https://everloot.app")).toEqual({
    id: ID, slug: "AbCd1234", name: "Fire", notes: null, classSlug: "mage", characterId: null, code: MAGE, code2: null,
    gameBuild: "1.60.1.70450", shared: true, active: false, link: "https://everloot.app/b/AbCd1234", updatedAt: "2026-10-20T12:00:00.123Z", showName: false,
  });
  expect(toBuild({ ...row, shared: false }, "https://everloot.app").link).toBeNull();
});

test("characters come back in one order on every path: lower-case name, then id", () => {
  const row = (id: string, name: string) => ({ id, name, class_slug: "mage", realm: null, note: null });
  expect(toCharacters([row("b", "jaina"), row("c", "Arthas"), row("a", "Jaina"), row("d", "zed")]).map((c) => `${c.name}/${c.id}`))
    .toEqual(["Arthas/c", "Jaina/a", "jaina/b", "zed/d"]);
});

test("opening a saved build marks the calculator as editing it, with both sets in the address", () => {
  expect(editPath({ id: ID, classSlug: "mage", code: MAGE, code2: MAGE2 })).toBe(`/tools/talents/mage?saved=${ID}#plan=${MAGE}&plan2=${MAGE2}`);
  expect(editPath({ id: ID, classSlug: "mage", code: MAGE, code2: null })).toBe(`/tools/talents/mage?saved=${ID}#plan=${MAGE}`);
});

test("after sign-in the visitor returns only to a path on this site", () => {
  expect(safeReturnTo("/tools/talents/mage?save=1")).toBe("/tools/talents/mage?save=1");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "me", "/a\nb", 7, null, `/${"a".repeat(600)}`]) expect(safeReturnTo(bad)).toBeNull();
  expect(signInPath("/tools/talents/mage?save=1")).toBe("/sign-in?returnTo=%2Ftools%2Ftalents%2Fmage%3Fsave%3D1");
  expect(signInPath("//evil.example")).toBe("/sign-in");
});

test("sign-in can bring the visitor back to the saved build they were editing, with Save open again", () => {
  const back = `/tools/talents/warlock?saved=${ID}&save=1`;
  expect(safeReturnTo(back)).toBe(back);
  expect(signInPath(back)).toBe(`/sign-in?returnTo=%2Ftools%2Ftalents%2Fwarlock%3Fsaved%3D${ID}%26save%3D1`);
});

// What the MCP directories copied when they listed Everloot is the keyless tools/list of /mcp/public: with the guild
// ladder on, as in production, the protocol's 31 tools. Saved builds must not move it; my_builds is listed only for a
// key that reads its owner's builds, after those 31.
let release = "";
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-saved-builds-mcp-"));
  const source = openDb(join(dir, "source.sqlite"));
  await replaceSourceRows(source, "curated", ["lore_page"], [{ kind: "lore_page", extId: "1", name: "Thrall",
    body: "Warchief of the Horde", gameVersion: "lore", sourceUrl: "https://example.test/thrall", retrievedAt: "2023-11-13" }]);
  release = join(dir, "release", "release.sqlite");
  snapshot(source, release, new Date("2026-10-10T00:00:00Z"));
  source.close();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

/** /mcp/public's tools/list as a directory syncs it, with EVERLOOT_SAVED_BUILDS as given and, if any, a key. */
async function publicTools(savedBuilds: string, key?: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  const env = { KB_SNAPSHOT_PATH: release, EVERLOOT_MCP_PUBLIC: "1", EVERLOOT_GUILDS: "1", EVERLOOT_DATA_GUARD: "1",
    EVERLOOT_SAVED_BUILDS: savedBuilds, SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service" };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  // Supabase, for the key: live, within its allowance, and made with "Read my saved builds".
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.includes("/rpc/consume_api_key")) return Response.json([{ allowed: true, retry_after: 0, key_ref: crypto.randomUUID() }]);
    if (path.includes("/api_keys?")) return Response.json([{ scopes: ["read:public", "read:own"], expires_at: null }]);
    throw new Error(`unexpected ${path}`);
  });
  const { POST } = await import("@/app/mcp/public/route");
  const response = await POST(new Request("https://everloot.app/mcp/public", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  expect(response.status).toBe(200);
  return (await response.json()).result.tools as Array<{ name: string }>;
}

test("saved builds leave the public MCP catalogue as the directories copied it: the same 31 tools, my_builds only for a key", async () => {
  const before = await publicTools("");
  const after = await publicTools("1");
  expect(after.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
  expect(after).toHaveLength(31);
  // Names, titles, descriptions, schemas and annotations: everything a directory keeps a copy of.
  expect(after).toEqual(before);
  expect(MCP_TOOL_NAMES).not.toContain(MY_BUILDS);
  const keyed = await publicTools("1", `evl_${"a".repeat(64)}`);
  expect(keyed.slice(0, 31)).toEqual(after);
  expect(keyed.slice(31).map((tool) => tool.name)).toEqual([MY_BUILDS]);
});
