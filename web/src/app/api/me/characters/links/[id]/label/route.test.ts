import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: cache.revalidatePath }));

import { POST } from "./route";
import { GET as LIST } from "../../route";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const LINK_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const LABEL_ID = "7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const KEY = `evl_${"a".repeat(64)}`;
const PATH = "/characters/forever/forever-pioneer/thrallina";

const send = (body: unknown, { id = LINK_ID, headers = { origin: "https://everloot.app" } as Record<string, string> } = {}) =>
  POST(new Request(`https://everloot.app/api/me/characters/links/${id}/label`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
/** The link's own row, then attach_build_label's answer (null when done). */
const owned = (refusal: string | null = null) =>
  auth.authQuery.mockResolvedValueOnce([{ ruleset: "forever", realm: "Forever Pioneer", name: "Thrallina" }]).mockResolvedValueOnce(refusal);

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_SHOWCASE", "1");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  vi.stubEnv("EVERLOOT_SHOWCASE_BUILDS", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
  cache.revalidatePath.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with any of its switches off it is a 404 and nothing is read", async () => {
  const off = [
    ["", "1", "1", "1"], ["1", "", "1", "1"], ["1", "1", "", "1"], ["1", "1", "1", ""], ["1", "1", "1", "true"],
  ];
  for (const [links, showcase, saved, builds] of off) {
    vi.stubEnv("EVERLOOT_CHARACTER_LINKS", links);
    vi.stubEnv("EVERLOOT_SHOWCASE", showcase);
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", saved);
    vi.stubEnv("EVERLOOT_SHOWCASE_BUILDS", builds);
    expect((await send({ label: LABEL_ID })).status).toBe(404);
  }
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

describe("who may change it", () => {
  test("only a session from this site: no Origin, another site or an API key alone is 403, signed out 401", async () => {
    expect((await send({ label: LABEL_ID }, { headers: {} })).status).toBe(403);
    expect((await send({ label: LABEL_ID }, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await send({ label: LABEL_ID }, { headers: { authorization: `Bearer ${KEY}` } })).status).toBe(403);
    auth.getUser.mockResolvedValue(null);
    expect((await send({ label: LABEL_ID })).status).toBe(401);
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("another account's link answers as an unknown one, 404, and nothing is attached", async () => {
    auth.authQuery.mockResolvedValueOnce([]);
    const foreign = await send({ label: LABEL_ID });
    const notAnId = await send({ label: LABEL_ID }, { id: "not-an-id" });
    expect(foreign.status).toBe(404);
    expect(notAnId.status).toBe(404);
    expect(await foreign.json()).toEqual(await notAnId.json());
    expect(auth.authQuery).toHaveBeenCalledOnce();
    expect(auth.authQuery.mock.calls[0][0]).toContain(`user_id=eq.${USER.id}`);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  test("another account's label, a frozen link and a label of another class are refused, and the page is left alone", async () => {
    for (const [refusal, status] of [["not_found", 404], ["frozen", 409], ["class_mismatch", 409]] as const) {
      owned(refusal);
      const res = await send({ label: LABEL_ID });
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("attaching", () => {
  test("a label is attached only by its id, for the session's account, and the page is cleared from the cache", async () => {
    owned();
    const res = await send({ label: LABEL_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: LINK_ID, label: LABEL_ID });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const [path, init] = auth.authQuery.mock.calls[1];
    expect(path).toBe("rpc/attach_build_label");
    expect(JSON.parse(init.body)).toEqual({ p_user_id: USER.id, p_link_id: LINK_ID, p_label_id: LABEL_ID });
    expect(cache.revalidatePath).toHaveBeenCalledWith(PATH);
  });

  test("null takes the label off", async () => {
    owned();
    expect((await send({ label: null })).status).toBe(200);
    expect(JSON.parse(auth.authQuery.mock.calls[1][1].body).p_label_id).toBeNull();
  });

  test("anything but one label id or null is a 400 before anything is read: no name matching, no extra fields", async () => {
    for (const body of [{}, { label: "Thrallina" }, { label: 5 }, { label: LABEL_ID, extra: true }, { name: "Thrallina" }, [LABEL_ID], null]) {
      expect((await send(body)).status).toBe(400);
    }
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("storage failing is a 503", async () => {
    auth.authQuery.mockRejectedValue(new Error("down"));
    expect((await send({ label: LABEL_ID })).status).toBe(503);
  });
});

describe("the owner's list", () => {
  const ROW = {
    id: LINK_ID, name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", faction: "Horde", level: 24,
    status: "linked", linked_at: "2026-10-21T18:00:00+00:00", last_upload_at: "2026-10-30T18:00:00+00:00",
    ruleset: "forever", character_visibility: { page_public: true },
  };
  const list = async () => (await (await LIST()).json()).links[0];

  test("names the attached label only with planned builds on, and reads the label column only then", async () => {
    auth.authQuery.mockResolvedValue([{ ...ROW, build_characters: [{ id: LABEL_ID, name: "Raid plans" }] }]);
    expect((await list()).page).toEqual({ public: true, path: PATH, label: { id: LABEL_ID, name: "Raid plans" } });
    expect(auth.authQuery.mock.calls[0][0]).toContain("build_characters(id,name)");

    auth.authQuery.mockClear().mockResolvedValue([{ ...ROW, build_characters: [] }]);
    expect((await list()).page.label).toBeNull();

    vi.stubEnv("EVERLOOT_SHOWCASE_BUILDS", "");
    auth.authQuery.mockClear().mockResolvedValue([ROW]);
    expect((await list()).page).toEqual({ public: true, path: PATH });
    expect(auth.authQuery.mock.calls[0][0]).not.toContain("build_characters");
  });
});
