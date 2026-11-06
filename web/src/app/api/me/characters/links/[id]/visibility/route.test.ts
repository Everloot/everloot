import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: cache.revalidatePath }));

import { POST } from "./route";
import { GET as LIST } from "../../route";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const LINK_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const KEY = `evl_${"a".repeat(64)}`;
const PATH = "/characters/forever/forever-pioneer/thrallina";

const send = (body: unknown, { id = LINK_ID, headers = { origin: "https://everloot.app" } as Record<string, string> } = {}) =>
  POST(new Request(`https://everloot.app/api/me/characters/links/${id}/visibility`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
/** The link's own row, then set_visibility's answer. */
const owned = (set: boolean = true) => auth.authQuery.mockResolvedValueOnce([{ ruleset: "forever", realm: "Forever Pioneer", name: "Thrallina" }]).mockResolvedValueOnce(set);

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_SHOWCASE", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
  cache.revalidatePath.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with either switch off it is a 404 and nothing is read", async () => {
  for (const [links, showcase] of [["", "1"], ["1", ""], ["1", "true"]]) {
    vi.stubEnv("EVERLOOT_CHARACTER_LINKS", links);
    vi.stubEnv("EVERLOOT_SHOWCASE", showcase);
    expect((await send({ page_public: true })).status).toBe(404);
  }
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

describe("who may change it", () => {
  test("only a session from this site: no Origin, another site or an API key alone is 403, signed out 401", async () => {
    expect((await send({ page_public: true }, { headers: {} })).status).toBe(403);
    expect((await send({ page_public: true }, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await send({ page_public: true }, { headers: { authorization: `Bearer ${KEY}` } })).status).toBe(403);
    auth.getUser.mockResolvedValue(null);
    expect((await send({ page_public: true })).status).toBe(401);
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("another account's link answers exactly as an unknown one, 404, and nothing is set or cleared", async () => {
    auth.authQuery.mockResolvedValueOnce([]);
    const foreign = await send({ page_public: false });
    const notAnId = await send({ page_public: false }, { id: "not-an-id" });
    expect(foreign.status).toBe(404);
    expect(notAnId.status).toBe(404);
    expect(await foreign.json()).toEqual(await notAnId.json());
    // The lookup is scoped to the session's account, and set_visibility is never called for it.
    expect(auth.authQuery).toHaveBeenCalledOnce();
    expect(auth.authQuery.mock.calls[0][0]).toContain(`user_id=eq.${USER.id}`);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  test("a link gone between the lookup and the write (set_visibility false) is a 404 too", async () => {
    owned(false);
    expect((await send({ page_public: true })).status).toBe(404);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the switch", () => {
  test("turning the page off goes through set_visibility for the session's account and clears the page and both cards", async () => {
    owned();
    const res = await send({ page_public: false });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ id: LINK_ID, page_public: false });
    expect(auth.authQuery.mock.calls[1][0]).toBe("rpc/set_visibility");
    expect(JSON.parse(auth.authQuery.mock.calls[1][1].body)).toEqual({ p_user_id: USER.id, p_id: LINK_ID, p_flags: { page_public: false } });
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual([PATH, `${PATH}/card.png`, `${PATH}/card-square.png`]);
  });

  test("turning it on clears the cache too, so a cached 404 does not linger", async () => {
    owned();
    expect((await send({ page_public: true })).status).toBe(200);
    expect(cache.revalidatePath).toHaveBeenCalledWith(PATH);
  });

  test("indexable may be turned off but not on until indexing is accepted", async () => {
    expect((await send({ indexable: true })).status).toBe(400);
    expect((await send({ page_public: true, indexable: true })).status).toBe(400);
    expect(auth.authQuery).not.toHaveBeenCalled();
    owned();
    expect((await send({ indexable: false })).status).toBe(200);
    expect(JSON.parse(auth.authQuery.mock.calls[1][1].body).p_flags).toEqual({ indexable: false });
  });

  test("only page_public and indexable, as booleans: anything else is a 400 and never reaches the database", async () => {
    for (const bad of [{}, null, [], "on", { show_gear: true }, { page_public: "yes" }, { page_public: true, show_gold: true }, { ranked_gear: false }]) {
      expect((await send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("storage failing is a 503", async () => {
    auth.authQuery.mockRejectedValueOnce(new Error("down"));
    expect((await send({ page_public: true })).status).toBe(503);
  });
});

describe("the section switches, with private sync on", () => {
  const SECTIONS = ["show_gear", "show_talents", "show_professions", "show_reputations", "show_raids", "show_collections"];

  test("each section switch goes to set_visibility as sent, and clears the page and both cards", async () => {
    vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
    owned();
    const flags = Object.fromEntries(SECTIONS.map((s, i) => [s, i % 2 === 0]));
    const res = await send(flags);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: LINK_ID, ...flags });
    expect(JSON.parse(auth.authQuery.mock.calls[1][1].body).p_flags).toEqual(flags);
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual([PATH, `${PATH}/card.png`, `${PATH}/card-square.png`]);
  });

  test("with private sync off they are refused as before; gold, guild and the rankings stay refused either way", async () => {
    for (const s of SECTIONS) expect((await send({ [s]: true })).status, s).toBe(400);
    vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
    for (const bad of [{ show_gold: true }, { show_guild: true }, { ranked_gear: false }, { show_talents: "on" }]) {
      expect((await send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(auth.authQuery).not.toHaveBeenCalled();
  });
});

describe("the gear ranking switch, with the leaderboards on", () => {
  test("ranked_gear goes to set_visibility only with EVERLOOT_LEADERBOARDS=1 and private sync on; the other rankings stay refused", async () => {
    vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
    expect((await send({ ranked_gear: true })).status).toBe(400);
    vi.stubEnv("EVERLOOT_LEADERBOARDS", "1");
    for (const bad of [{ ranked_achievements: true }, { ranked_gold: true }, { ranked_gear: "on" }]) {
      expect((await send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(auth.authQuery).not.toHaveBeenCalled();
    owned();
    const res = await send({ ranked_gear: true });
    expect(res.status).toBe(200);
    expect(JSON.parse(auth.authQuery.mock.calls[1][1].body).p_flags).toEqual({ ranked_gear: true });
  });
});

describe("the owner's list with the showcase on", () => {
  test("each link carries its page switch and address; with it off the list is as before", async () => {
    auth.authQuery.mockResolvedValueOnce([
      { id: LINK_ID, name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", faction: "Horde", level: 24, status: "linked",
        linked_at: "2026-10-21T18:00:00+00:00", last_upload_at: "2026-10-21T18:00:00+00:00", ruleset: "forever", character_visibility: { page_public: true } },
      { id: "9c0d7e3a-1b2c-4d5e-8f90-a1b2c3d4e5f6", name: "Jainara", realm: "Forever Pioneer", race: "Human", class: "PRIEST", faction: "Alliance", level: 10,
        status: "linked", linked_at: "2026-10-22T18:00:00+00:00", last_upload_at: "2026-10-22T18:00:00+00:00", ruleset: "forever", character_visibility: [] },
    ]);
    const body = await (await LIST()).json();
    expect(auth.authQuery.mock.calls[0][0]).toContain("select=id,name,realm,race,class,faction,level,status,linked_at,last_upload_at,ruleset,character_visibility(page_public)&");
    expect(body.links.map((l: { page: unknown }) => l.page)).toEqual([
      { public: true, path: PATH }, { public: false, path: "/characters/forever/forever-pioneer/jainara" },
    ]);
    expect(JSON.stringify(body)).not.toContain("character_visibility");
    expect(JSON.stringify(body)).not.toContain("ruleset");
  });
});
