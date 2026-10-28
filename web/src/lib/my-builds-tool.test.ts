import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { accountMcpTools, answerMyBuilds, myBuildsRoute } from "./my-builds-tool";
import { MY_BUILDS_REFUSAL, type AccountBuilds, type SavedBuild } from "./saved-builds";
import { loadCatalog } from "./talents/catalogs";
import { encodeBuild } from "./talents/share";
import type { TalentCatalog } from "./talents/types";

const SITE = "https://everloot.app";
const KEY = `evl_${"a".repeat(64)}`;
const CHARACTER_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";

let mage: TalentCatalog;
let current = "";
let older = "";
/** A node the first point can go into: no prerequisites and no gate. */
let first: TalentCatalog["nodes"][number];

beforeAll(async () => {
  mage = await loadCatalog("mage");
  first = mage.nodes.find((n) => n.prereqs.length === 0 && !n.anyOf && !n.unlock && n.kind !== "choice")!;
  current = encodeBuild({ classSlug: "mage", specId: 0, build: mage.build, ranks: { [first.id]: { rank: 1 } } });
  // An older build, with one node today's tree no longer has.
  older = encodeBuild({ classSlug: "mage", specId: 0, build: "1.0.0.1", ranks: { [first.id]: { rank: 1 }, 999999: { rank: 2 } } });
});

const build = (over: Partial<SavedBuild> = {}): SavedBuild => ({
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", slug: "AbCd1234", name: "Fire", notes: null, classSlug: "mage", characterId: CHARACTER_ID,
  code: current, code2: null, gameBuild: mage.build, shared: true, active: true, link: `${SITE}/b/AbCd1234`, updatedAt: "2026-10-20T12:00:00.000Z", showName: false,
  ...over,
});
const account = (): AccountBuilds => ({
  characters: [{ id: CHARACTER_ID, name: "Jaina", classSlug: "mage", realm: null, note: null }],
  builds: [
    build(),
    build({ id: "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33", slug: "Zz9Zz9Zz", name: "Old frost", characterId: null, active: false, shared: false, link: null, code: older, gameBuild: "1.0.0.1", notes: "From the beta" }),
  ],
});

describe("the answer", () => {
  test("the list: name, slug, how it reads, character, active, game build with the older flag, and the link", async () => {
    const { text, structured } = await answerMyBuilds(account(), {}, SITE);
    const codeLink = `${SITE}/tools/talents/mage/b/${older}`;
    expect(structured).toMatchObject({
      builds: [
        { slug: "AbCd1234", name: "Fire", class: "mage", character: "Jaina", active: true, gameBuild: mage.build, olderBuild: false, newerBuild: false, link: `${SITE}/b/AbCd1234`, url: `${SITE}/b/AbCd1234` },
        { slug: "Zz9Zz9Zz", name: "Old frost", character: null, active: false, gameBuild: "1.0.0.1", olderBuild: true, newerBuild: false, link: null, url: codeLink },
      ],
    });
    expect(text).toContain("2 saved builds, newest first.");
    expect(text).toContain(`- Fire (slug AbCd1234): `);
    expect(text).toContain(`, character Jaina, active. Game build ${mage.build}. ${SITE}/b/AbCd1234`);
    expect(text).toContain(`Game build 1.0.0.1 (older build). ${codeLink}`);
  });

  test("no builds yet points at the calculator", async () => {
    const { text, structured } = await answerMyBuilds({ characters: [], builds: [] }, {}, SITE);
    expect(text).toBe(`No saved builds yet. Make one in the talent calculator and press Save: ${SITE}/tools/talents`);
    expect(structured).toEqual({ builds: [] });
  });

  test("one build by slug: points per tree, the talents taken, the notes on what did not load, and its link", async () => {
    const tree = mage.trees.find((t) => t.id === first.treeId)!.name;
    const fire = await answerMyBuilds(account(), { slug: "AbCd1234" }, SITE);
    expect(fire.text).toContain(`Fire, character Jaina, active. Game build ${mage.build}.`);
    expect(fire.text).toContain(`  ${tree} 1: ${first.entries[0].name} 1/${first.maxRanks}`);
    expect(fire.text).toContain(`Open: ${SITE}/b/AbCd1234`);
    expect(fire.text.endsWith(GAME_DATA_CREDIT)).toBe(true);
    expect(fire.structured).toMatchObject({ build: { slug: "AbCd1234", olderBuild: false, newerBuild: false, treeBuild: mage.build, sets: [{ spent: 1, unknown: [], buildDiffers: false }] } });

    const old = await answerMyBuilds(account(), { slug: "Zz9Zz9Zz" }, SITE);
    expect(old.text).toContain(`Made on game build 1.0.0.1; the calculator's tree is build ${mage.build}, so check each talent.`);
    expect(old.text).toContain("Notes: From the beta");
    expect(old.text).toContain("1 talent is not in today's tree: node 999999.");
    expect(old.text).toContain(`Open: ${SITE}/tools/talents/mage/b/${older}`);
    expect(old.structured).toMatchObject({ build: { olderBuild: true, newerBuild: false, link: null, sets: [{ unknown: [{ id: 999999, rank: 2 }], buildDiffers: true }] } });
  });

  test("one build's game build is older only when it is older, newer when it is newer, and neither for the tree's or an unreadable one", async () => {
    const parts = mage.build.split(".");
    const newer = [...parts.slice(0, -1), String(Number(parts.at(-1)) + 1)].join(".");
    const detail = async (gameBuild: string) => {
      const { text, structured } = await answerMyBuilds({ characters: [], builds: [build({ gameBuild, characterId: null })] }, { slug: "AbCd1234" }, SITE);
      const { olderBuild, newerBuild } = (structured as { build: { olderBuild: boolean; newerBuild: boolean } }).build;
      return { text, olderBuild, newerBuild };
    };

    expect(await detail("1.0.0.1")).toMatchObject({ olderBuild: true, newerBuild: false, text: expect.stringContaining("Made on game build 1.0.0.1; the calculator's tree") });
    const ahead = await detail(newer);
    expect(ahead).toMatchObject({ olderBuild: false, newerBuild: true });
    expect(ahead.text).toContain(`Made on game build ${newer}, newer than the calculator's tree (build ${mage.build}), which has not caught up with it yet.`);
    expect(ahead.text).not.toContain("check each talent");
    expect(await detail(mage.build)).toMatchObject({ olderBuild: false, newerBuild: false, text: expect.stringContaining(`active. Game build ${mage.build}.`) });
    expect(await detail("beta")).toMatchObject({ olderBuild: false, newerBuild: false, text: expect.stringContaining("active. Game build beta.") });
  });

  test("the list and one build agree on older and newer", async () => {
    const parts = mage.build.split(".");
    const newer = [...parts.slice(0, -1), String(Number(parts.at(-1)) + 1)].join(".");
    const games = ["1.0.0.1", newer, mage.build, "beta"];
    const data: AccountBuilds = {
      characters: [],
      builds: games.map((gameBuild, i) => build({ id: `0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e1${i}`, slug: `AbCd123${i}`, gameBuild, characterId: null })),
    };
    const list = await answerMyBuilds(data, {}, SITE);
    const listed = (list.structured as { builds: Array<{ slug: string; olderBuild: boolean; newerBuild: boolean }> }).builds;
    expect(listed.map((b) => [b.olderBuild, b.newerBuild])).toEqual([[true, false], [false, true], [false, false], [false, false]]);
    expect(list.text).toContain(`Game build ${newer} (newer build).`);
    for (const item of listed) {
      const one = (await answerMyBuilds(data, { slug: item.slug }, SITE)).structured as { build: { olderBuild: boolean; newerBuild: boolean } };
      expect([one.build.olderBuild, one.build.newerBuild]).toEqual([item.olderBuild, item.newerBuild]);
    }
  });

  test("a slug that is not on the account says so", async () => {
    const missing = await answerMyBuilds(account(), { slug: "Nope1234" }, SITE);
    expect(missing.text).toBe("No saved build with slug Nope1234 on this account. Ask without a slug for the list.");
    expect(missing.structured).toEqual({ build: null });
  });
});

const rpc = (method: string, params: object = {}) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
const mcpRequest = (key?: string) => new Request(`${SITE}/mcp/public`, { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {} });
/** The database: the key's scopes, and own_builds_for_key's answer. */
function database(scopes: string[] | null, own: object = { refusal: null, retry_after: 0, characters: [], builds: [] }) {
  auth.authQuery.mockImplementation(async (path: string) => {
    if (path.startsWith("api_keys?")) return scopes ? [{ scopes, expires_at: null }] : [];
    if (path === "rpc/own_builds_for_key") return [own];
    throw new Error(`unexpected ${path}`);
  });
}

describe("on the MCP mount", () => {
  beforeEach(() => { vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1"); auth.authQuery.mockReset(); });
  afterEach(() => vi.unstubAllEnvs());

  test("with the switch off nothing is added, whatever the key", async () => {
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
    database(["read:public", "read:own"]);
    expect(await accountMcpTools(mcpRequest(KEY), rpc("tools/list"))).toEqual([]);
    expect(await accountMcpTools(mcpRequest(KEY), rpc("tools/call", { name: "my_builds" }))).toEqual([]);
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("listed only for a live key with read:own; no key, another scope or a failed lookup leaves the list alone", async () => {
    expect(await accountMcpTools(mcpRequest(), rpc("tools/list"))).toEqual([]);
    database(["read:public"]);
    expect(await accountMcpTools(mcpRequest(KEY), rpc("tools/list"))).toEqual([]);
    database(null);
    expect(await accountMcpTools(mcpRequest(KEY), rpc("tools/list"))).toEqual([]);
    auth.authQuery.mockRejectedValue(new Error("down"));
    expect(await accountMcpTools(mcpRequest(KEY), rpc("tools/list"))).toEqual([]);
    database(["read:public", "read:own"]);
    expect((await accountMcpTools(mcpRequest(KEY), rpc("tools/list"))).map((t) => t.name)).toEqual(["my_builds"]);
    expect(auth.authQuery.mock.calls.at(-1)![0]).toMatch(/^api_keys\?select=scopes,expires_at&token_hash=eq\.[a-f0-9]{64}&revoked_at=is\.null&limit=1$/);
    // Other requests, and other tools' calls, never look the key up.
    auth.authQuery.mockClear();
    expect(await accountMcpTools(mcpRequest(KEY), rpc("initialize"))).toEqual([]);
    expect(await accountMcpTools(mcpRequest(KEY), rpc("tools/call", { name: "search_knowledge" }))).toEqual([]);
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("a call without a key, or with one that cannot read builds, is refused in words", async () => {
    const [anonymous] = await accountMcpTools(mcpRequest(), rpc("tools/call", { name: "my_builds" }));
    await expect(anonymous.handler({})).rejects.toThrow(MY_BUILDS_REFUSAL);
    database(["read:public"], { refusal: "no_scope", retry_after: 0, characters: null, builds: null });
    const [noScope] = await accountMcpTools(mcpRequest(KEY), rpc("tools/call", { name: "my_builds" }));
    await expect(noScope.handler({})).rejects.toThrow(MY_BUILDS_REFUSAL);
    database(["read:own"], { refusal: "limited", retry_after: 120, characters: null, builds: null });
    const [limited] = await accountMcpTools(mcpRequest(KEY), rpc("tools/call", { name: "my_builds" }));
    await expect(limited.handler({})).rejects.toThrow("Try again in 120 seconds.");
  });

  test("a call with a read:own key answers from own_builds_for_key", async () => {
    database(["read:own"], { refusal: null, retry_after: 0, characters: [], builds: [] });
    const [tool] = await accountMcpTools(mcpRequest(KEY), rpc("tools/call", { name: "my_builds" }));
    expect(await tool.handler({})).toMatchObject({ text: expect.stringContaining("No saved builds yet.") });
    expect(auth.authQuery).toHaveBeenCalledWith("rpc/own_builds_for_key", expect.anything());
  });

  test("with the data guard on, the mount has counted the request already, so the read does not count it again", async () => {
    const counted = async () => {
      auth.authQuery.mockClear();
      const [tool] = await accountMcpTools(mcpRequest(KEY), rpc("tools/call", { name: "my_builds" }));
      await tool.handler({});
      const call = auth.authQuery.mock.calls.find(([path]) => path === "rpc/own_builds_for_key")!;
      return JSON.parse(call[1].body).p_count;
    };
    database(["read:own"]);
    expect(await counted()).toBe(true);
    vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
    expect(await counted()).toBe(false);
  });
});

describe("GET /api/tools/my_builds", () => {
  const get = (query = "", headers: Record<string, string> = {}) => myBuildsRoute(new Request(`${SITE}/api/tools/my_builds${query}`, { headers }));
  beforeEach(() => { auth.getUser.mockReset(); auth.authQuery.mockReset(); });

  test("signed out is a 401 with the refusal; a bad slug a 400", async () => {
    auth.getUser.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: MY_BUILDS_REFUSAL });
    expect((await get("?slug=bad")).status).toBe(400);
  });

  test("signed in, the visitor's own builds, never cached", async () => {
    auth.getUser.mockResolvedValue({ id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" });
    auth.authQuery.mockResolvedValue([]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ tool: "my_builds", arguments: {}, answer: { builds: [] }, text: expect.stringContaining("No saved builds yet.") });
    expect(auth.authQuery.mock.calls.map((c) => c[0])).toEqual([
      expect.stringContaining("user_id=eq.11111111-2222-4333-8444-555555555555"), expect.stringContaining("user_id=eq.11111111-2222-4333-8444-555555555555"),
    ]);
  });

  test("a key without read:own is refused like a signed-out visitor", async () => {
    database(["read:public"], { refusal: "no_scope", retry_after: 0, characters: null, builds: null });
    const res = await get("", { authorization: `Bearer ${KEY}` });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(MY_BUILDS_REFUSAL);
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});
