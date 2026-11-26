import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { POST } from "./route";

const SITE = "https://everloot.app";
const MOD = { id: "11111111-2222-4333-8444-555555555555", name: "Mod#1" };
const COMMENT = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const post = (body: unknown, origin: string | null = SITE) =>
  POST(new Request(`${SITE}/comments/moderate`, { method: "POST", headers: origin ? { origin, "content-type": "application/json" } : {}, body: JSON.stringify(body) }));
let moderator: boolean;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_COMMENTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  moderator = true;
  auth.getUser.mockReset().mockResolvedValue(MOD);
  auth.authQuery.mockReset().mockImplementation(async (path: string, init: RequestInit) => {
    if (path === "rpc/is_comment_moderator") return moderator;
    if (path === "rpc/moderate_entity_comment") {
      const { p_action } = JSON.parse(String(init.body));
      return { comment_ref: COMMENT, status: p_action === "hide" ? "hidden" : "visible", refusal: null };
    }
    throw new Error(path);
  });
});
afterEach(() => vi.unstubAllEnvs());

test("off, from another origin, signed out or not a moderator: refused before any change", async () => {
  vi.stubEnv("EVERLOOT_COMMENTS", "");
  expect((await post({ commentId: COMMENT, action: "hide" })).status).toBe(404);
  vi.stubEnv("EVERLOOT_COMMENTS", "1");
  expect((await post({ commentId: COMMENT, action: "hide" }, "https://example.com")).status).toBe(403);
  expect((await post({ commentId: COMMENT, action: "hide" }, null)).status).toBe(403);
  auth.getUser.mockResolvedValueOnce(null);
  expect((await post({ commentId: COMMENT, action: "hide" })).status).toBe(404);
  moderator = false;
  expect((await post({ commentId: COMMENT, action: "hide" })).status).toBe(404);
  expect(auth.authQuery.mock.calls.some(([path]) => path === "rpc/moderate_entity_comment")).toBe(false);
});

test("a moderator hides, restores and dismisses as their own account", async () => {
  for (const [action, status] of [["hide", "hidden"], ["restore", "visible"], ["dismiss", "visible"]]) {
    const response = await post({ commentId: COMMENT, action });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ status });
  }
  const calls = auth.authQuery.mock.calls.filter(([path]) => path === "rpc/moderate_entity_comment").map(([, init]) => JSON.parse(init.body));
  expect(calls).toEqual(["hide", "restore", "dismiss"].map((a) => ({ p_moderator_id: MOD.id, p_comment_id: COMMENT, p_action: a })));
});

test("malformed requests are 400; a comment in the wrong state is 409", async () => {
  for (const body of [null, { commentId: COMMENT }, { commentId: "x", action: "hide" }, { commentId: COMMENT, action: "purge" }, { commentId: COMMENT, action: "hide", by: "x" }]) {
    expect((await post(body)).status, JSON.stringify(body)).toBe(400);
  }
  auth.authQuery.mockImplementation(async (path: string) => (path === "rpc/is_comment_moderator" ? true : { comment_ref: null, status: "deleted", refusal: "wrong_status" }));
  expect((await post({ commentId: COMMENT, action: "restore" })).status).toBe(409);
});
