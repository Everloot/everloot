import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { POST } from "./route";
import { DELETE } from "./[id]/route";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const CHARACTER_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const call = (body?: object, origin = "https://everloot.app") =>
  new Request("https://everloot.app/api/me/characters", { method: "POST", headers: { origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const remove = (id: string, origin = "https://everloot.app") =>
  DELETE(new Request(`https://everloot.app/api/me/characters/${id}`, { method: "DELETE", headers: { origin } }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("off, signed out or from another site, nothing is written", async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "0");
  expect((await POST(call({ name: "Jaina", classSlug: "mage" }))).status).toBe(404);
  expect((await remove(CHARACTER_ID)).status).toBe(404);
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  auth.getUser.mockResolvedValue(null);
  const signedOut = await POST(call({ name: "Jaina", classSlug: "mage" }));
  expect(signedOut.status).toBe(401);
  expect((await signedOut.json()).signIn).toBe("/sign-in?returnTo=%2Fme");
  auth.getUser.mockResolvedValue(USER);
  expect((await POST(call({ name: "Jaina", classSlug: "mage" }, "https://evil.example"))).status).toBe(403);
  // A write with no Origin is refused too.
  expect((await POST(new Request("https://everloot.app/api/me/characters", { method: "POST", body: JSON.stringify({ name: "Jaina", classSlug: "mage" }) }))).status).toBe(403);
  expect((await DELETE(new Request(`https://everloot.app/api/me/characters/${CHARACTER_ID}`, { method: "DELETE" }), { params: Promise.resolve({ id: CHARACTER_ID }) })).status).toBe(403);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a label is made under the signed-in account and answered with 201", async () => {
  auth.authQuery.mockResolvedValueOnce([{ character_ref: CHARACTER_ID, refusal: null }]);
  const res = await POST(call({ name: " Jaina ", classSlug: "mage", realm: "Pioneer", note: "" }));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ character: { id: CHARACTER_ID, name: "Jaina", classSlug: "mage", realm: "Pioneer", note: null } });
  expect(auth.authQuery.mock.calls[0][0]).toBe("rpc/save_build_character");
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).toEqual({
    p_user_id: USER.id, p_id: null, p_name: "Jaina", p_class_slug: "mage", p_realm: "Pioneer", p_note: null,
  });
});

test("editing another player's label is a 404; the limits and a locked class say why", async () => {
  const refuse = (refusal: string) => auth.authQuery.mockResolvedValueOnce([{ character_ref: null, refusal }]);
  refuse("not_found");
  expect((await POST(call({ id: CHARACTER_ID, name: "Mine", classSlug: "mage" }))).status).toBe(404);
  refuse("has_builds");
  expect((await POST(call({ id: CHARACTER_ID, name: "Jaina", classSlug: "warrior" }))).status).toBe(409);
  refuse("character_limit");
  const full = await POST(call({ name: "Alt", classSlug: "mage" }));
  expect(full.status).toBe(409);
  expect((await full.json()).error).toContain("30 characters");
  refuse("daily_limit");
  expect((await POST(call({ name: "Alt", classSlug: "mage" }))).status).toBe(429);
});

test("a label meant for another account than the session's is a private 409 and nothing is written; the session's own is saved", async () => {
  const sent = (owner: string) => new Request("https://everloot.app/api/me/characters", {
    method: "POST", headers: { origin: "https://everloot.app", "content-type": "application/json", "x-everloot-expected-owner": owner },
    body: JSON.stringify({ name: "Jaina", classSlug: "mage" }),
  });
  const refused = await POST(sent("99999999-2222-4333-8444-555555555555"));
  expect(refused.status).toBe(409);
  expect(refused.headers.get("cache-control")).toBe("private, no-store");
  expect((await refused.json()).code).toBe("account_mismatch");
  expect(auth.authQuery).not.toHaveBeenCalled();
  auth.authQuery.mockResolvedValueOnce([{ character_ref: CHARACTER_ID, refusal: null }]);
  expect((await POST(sent(USER.id))).status).toBe(201);
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body).p_user_id).toBe(USER.id);
});

test("bad labels are a 400 before the database is asked", async () => {
  for (const body of [{ name: "", classSlug: "mage" }, { name: "Jaina", classSlug: "monk" }, { name: "x".repeat(25), classSlug: "mage" }]) {
    expect((await POST(call(body))).status).toBe(400);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("deleting is for the owner's labels only", async () => {
  auth.authQuery.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await remove(CHARACTER_ID)).status).toBe(200);
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).toEqual({ p_user_id: USER.id, p_id: CHARACTER_ID });
  expect((await remove(CHARACTER_ID)).status).toBe(404);
  expect((await remove("nope")).status).toBe(400);
});
