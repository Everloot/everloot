import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: cache.revalidatePath }));

import { GET, POST } from "./route";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const LINK_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const KEY = `evl_${"a".repeat(64)}`;
const PATH = "/characters/forever/forever-pioneer/thrallina";
const ctx = (id = LINK_ID) => ({ params: Promise.resolve({ id }) });

const send = (body: unknown, { id = LINK_ID, headers = { origin: "https://everloot.app" } as Record<string, string> } = {}) =>
  POST(new Request(`https://everloot.app/api/me/characters/links/${id}/sync`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }), ctx(id));
const read = (id = LINK_ID, headers: Record<string, string> = {}) =>
  GET(new Request(`https://everloot.app/api/me/characters/links/${id}/sync`, { headers }), ctx(id));
/** The link's own row (its address), then each set_sync_consent answer. */
const owned = (...answers: Array<string | null>) => {
  auth.authQuery.mockResolvedValueOnce([{ ruleset: "forever", realm: "Forever Pioneer", name: "Thrallina" }]);
  for (const a of answers) auth.authQuery.mockResolvedValueOnce(a);
};
const consentCalls = () => auth.authQuery.mock.calls.filter((c) => c[0] === "rpc/set_sync_consent").map((c) => JSON.parse(c[1].body));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
  cache.revalidatePath.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off both methods are 404 and nothing is read", async () => {
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "");
  expect((await send({ gear: true })).status).toBe(404);
  expect((await read()).status).toBe(404);
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

describe("who may change it", () => {
  test("only a session from this site: no Origin, another site or an API key alone is 403, signed out 401", async () => {
    expect((await send({ gear: true }, { headers: {} })).status).toBe(403);
    expect((await send({ gear: true }, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    // A sync:own key sends facts; it never grants consent.
    expect((await send({ gear: true }, { headers: { authorization: `Bearer ${KEY}` } })).status).toBe(403);
    auth.getUser.mockResolvedValue(null);
    expect((await send({ gear: true })).status).toBe(401);
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("another account's link answers exactly as an unknown one, 404, and no consent is touched", async () => {
    auth.authQuery.mockResolvedValueOnce([]);
    const foreign = await send({ gear: true });
    const notAnId = await send({ gear: true }, { id: "not-an-id" });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await notAnId.json());
    expect(auth.authQuery.mock.calls[0][0]).toContain(`user_id=eq.${USER.id}`);
    expect(consentCalls()).toEqual([]);
  });

  test("the owner's read is the session's only: an API key alone is 401, another account's link 404", async () => {
    auth.getUser.mockResolvedValue(null);
    expect((await read(LINK_ID, { authorization: `Bearer ${KEY}` })).status).toBe(401);
    auth.getUser.mockResolvedValue(USER);
    auth.authQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await read();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("consent", () => {
  test("grants and revokes per category through set_sync_consent, for the session's account, and clears the page", async () => {
    owned(null, null, null, null);
    const res = await send({ gear: true, stats: true, pvp: false, raids: false });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ id: LINK_ID, gear: true, stats: true, pvp: false, raids: false });
    expect(consentCalls()).toEqual([
      { p_user_id: USER.id, p_link_id: LINK_ID, p_category: "gear", p_granted: true },
      { p_user_id: USER.id, p_link_id: LINK_ID, p_category: "stats", p_granted: true },
      { p_user_id: USER.id, p_link_id: LINK_ID, p_category: "pvp", p_granted: false },
      { p_user_id: USER.id, p_link_id: LINK_ID, p_category: "raids", p_granted: false },
    ]);
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual([PATH, `${PATH}/card.png`, `${PATH}/card-square.png`]);
  });

  test("a frozen link cannot be granted: 409", async () => {
    owned("frozen");
    expect((await send({ talents: true })).status).toBe(409);
  });

  test("anything but category names with booleans is a 400 before anything is read", async () => {
    for (const bad of [{}, { gold: true }, { gear: "yes" }, [], null]) expect((await send(bad)).status).toBe(400);
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("the owner's read lists every category with sync, its public switch and the capture date; no data, source or key", async () => {
    auth.authQuery
      .mockResolvedValueOnce([{ id: LINK_ID, ruleset: "forever", name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", faction: "Horde", level: 60,
        last_upload_at: "2026-11-01T10:00:00+00:00", status: "linked", character_visibility: { page_public: true, show_gear: true, show_stats: true, show_talents: false, show_pvp: false, show_professions: false, show_reputations: false, show_raids: false, show_collections: true } }])
      .mockResolvedValueOnce([
        { category: "gear", consented: true, captured_at: "2026-11-05T10:00:00+00:00", data: { equipped: [] } },
        { category: "stats", consented: true, captured_at: null, data: null },
        { category: "talents", consented: false, captured_at: null, data: null },
        { category: "pvp", consented: false, captured_at: null, data: null },
        { category: "professions", consented: false, captured_at: null, data: null },
        { category: "reputations", consented: false, captured_at: null, data: null },
        { category: "raids", consented: false, captured_at: null, data: null },
        { category: "achievements", consented: true, captured_at: null, data: null },
      ]);
    const res = await read();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: LINK_ID, status: "linked", pagePublic: true,
      categories: [
        { category: "gear", sync: true, shown: true, capturedAt: "2026-11-05T10:00:00.000Z" },
        { category: "stats", sync: true, shown: true, capturedAt: null },
        { category: "talents", sync: false, shown: false, capturedAt: null },
        { category: "pvp", sync: false, shown: false, capturedAt: null },
        { category: "professions", sync: false, shown: false, capturedAt: null },
        { category: "reputations", sync: false, shown: false, capturedAt: null },
        { category: "raids", sync: false, shown: false, capturedAt: null },
        { category: "achievements", sync: true, shown: true, capturedAt: null },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(USER.id);
  });
});

test("boss-kill consent is separate, session-only, and off until its migration is approved", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "");
  expect((await send({ bossKills: true })).status).toBe(400);
  expect(auth.authQuery).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "1");
  owned(null);
  expect((await send({ bossKills: true })).status).toBe(200);
  const call = auth.authQuery.mock.calls.find((c) => c[0] === "rpc/set_boss_kill_consent");
  expect(JSON.parse(call![1].body)).toEqual({ p_user_id: USER.id, p_link_id: LINK_ID, p_granted: true });
  auth.authQuery.mockReset();
  auth.authQuery.mockResolvedValueOnce([]);
  expect((await send({ bossKills: true })).status).toBe(404);
  expect(auth.authQuery).toHaveBeenCalledTimes(1);
});

test("boss-kill reads are owner-only and no-store, and an absent table returns a retryable 503", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "1");
  auth.authQuery.mockResolvedValueOnce([{ ruleset: "forever", name: "Thrallina", realm: "Forever Pioneer", race: "Orc",
    class: "SHAMAN", faction: "Horde", level: 60, last_upload_at: "2026-11-10T00:00:00Z", status: "linked" }]);
  auth.authQuery.mockResolvedValueOnce([]);
  auth.authQuery.mockResolvedValueOnce({ sync: true, kills: [{ encounterId: 2916, killCount: 2 }] });
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).bossKills).toEqual({ sync: true, kills: [{ encounterId: 2916, killCount: 2 }] });
  const call = auth.authQuery.mock.calls.find((c) => c[0] === "rpc/own_boss_kills");
  expect(JSON.parse(call![1].body)).toEqual({ p_user_id: USER.id, p_link_id: LINK_ID });
});

test("a missing boss-kill RPC leaves owner reads unavailable without exposing partial facts", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "1");
  auth.authQuery.mockResolvedValueOnce([{ ruleset: "forever", name: "Thrallina", realm: "Forever Pioneer", race: "Orc",
    class: "SHAMAN", faction: "Horde", level: 60, last_upload_at: "2026-11-10T00:00:00Z", status: "linked" }]);
  auth.authQuery.mockResolvedValueOnce([]);
  auth.authQuery.mockRejectedValueOnce(new Error("own_boss_kills missing"));
  const response = await read();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).not.toHaveProperty("bossKills");
});
