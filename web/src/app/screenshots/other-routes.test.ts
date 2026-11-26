import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeBucket, webp } from "@/test/screenshots";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cf.env }) }));

import * as mine from "./mine/route";
import * as moderate from "./moderate/route";
import * as file from "./file/[id]/route";
import * as review from "./review/[id]/route";

const SITE = "https://everloot.app";
const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const MOD = { id: "22222222-2222-4333-8444-555555555555", name: "Mod#1" };
const SHOT = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const PENDING = `screenshots/pending/${SHOT}.webp`;
const PUBLIC = `screenshots/public/${SHOT}.webp`;

let bucket: ReturnType<typeof fakeBucket>;
let access: string | null;
let moderated: object;
let deleted: object;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, body: unknown, headers: Record<string, string> = { origin: SITE }) =>
  route.POST(new Request(`${SITE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const rpcCalls = (name: string) => auth.authQuery.mock.calls.filter(([path]) => path === `rpc/${name}`).map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_SCREENSHOTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  bucket = fakeBucket();
  bucket.objects.set(PENDING, webp(8, 8));
  cf.env = { SCREENSHOTS: bucket, IMAGES: {} };
  access = "public";
  moderated = { screenshot_ref: SHOT, status: "approved", refusal: null };
  deleted = { screenshot_ref: SHOT, was: "approved", refusal: null };
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string, init: { body: string }) => {
    if (path === "rpc/my_entity_screenshots") return [{ id: SHOT, status: "pending", width: 8, height: 8, created_at: "2026-11-25T10:00:00+00:00" }];
    if (path.startsWith("user_profiles?")) return [{ handle: "thrall", public_profile: false }];
    if (path === "rpc/delete_entity_screenshot") return deleted;
    if (path === "rpc/is_comment_moderator") return JSON.parse(init.body).p_user_id === MOD.id;
    if (path === "rpc/moderate_entity_screenshot") return moderated;
    if (path === "rpc/entity_screenshot_access") return access;
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

test("everything is 404 with the switch off, before any read", async () => {
  vi.stubEnv("EVERLOOT_SCREENSHOTS", "");
  expect((await mine.GET(new Request(`${SITE}/screenshots/mine?type=item&id=1`))).status).toBe(404);
  expect((await post(mine, "/screenshots/mine", { action: "delete", screenshotId: SHOT })).status).toBe(404);
  expect((await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "approve" })).status).toBe(404);
  expect((await file.GET(new Request(`${SITE}/screenshots/file/${SHOT}`), ctx(SHOT))).status).toBe(404);
  expect((await review.GET(new Request(`${SITE}/screenshots/review/${SHOT}`), ctx(SHOT))).status).toBe(404);
  expect(auth.authQuery).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("mine: the viewer's own screenshots on the page, never cached; signed out, no viewer", async () => {
  const response = await mine.GET(new Request(`${SITE}/screenshots/mine?type=npc&id=7`));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    viewer: { id: USER.id, handle: "thrall" },
    mine: [{ id: SHOT, status: "pending", width: 8, height: 8, createdAt: "2026-11-25T10:00:00.000Z" }],
  });
  expect(rpcCalls("my_entity_screenshots")).toEqual([{ p_user_id: USER.id, p_entity_type: "npc", p_entity_id: 7 }]);
  auth.getUser.mockResolvedValueOnce(null);
  expect(await (await mine.GET(new Request(`${SITE}/screenshots/mine?type=npc&id=7`))).json()).toEqual({ viewer: null, mine: [] });
  expect((await mine.GET(new Request(`${SITE}/screenshots/mine?type=npc`))).status).toBe(400);
});

test("delete: the uploader's own, same-origin; both files go", async () => {
  bucket.objects.set(PUBLIC, webp(8, 8));
  expect((await post(mine, "/screenshots/mine", { action: "delete", screenshotId: SHOT }, {})).status).toBe(403);
  expect((await post(mine, "/screenshots/mine", { action: "delete", screenshotId: "nope" })).status).toBe(400);
  expect((await post(mine, "/screenshots/mine", { action: "delete", screenshotId: SHOT, extra: 1 })).status).toBe(400);
  const response = await post(mine, "/screenshots/mine", { action: "delete", screenshotId: SHOT });
  expect(response.status).toBe(200);
  expect(rpcCalls("delete_entity_screenshot")).toEqual([{ p_user_id: USER.id, p_screenshot_id: SHOT }]);
  expect(bucket.objects.size).toBe(0);
  deleted = { screenshot_ref: null, was: null, refusal: "not_found" };
  bucket.objects.set(PUBLIC, webp(8, 8));
  expect((await post(mine, "/screenshots/mine", { action: "delete", screenshotId: SHOT })).status).toBe(404);
  expect(bucket.objects.has(PUBLIC)).toBe(true);
});

test("moderate: anyone but a moderator gets 404 and nothing moves", async () => {
  expect((await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "approve" })).status).toBe(404);
  auth.getUser.mockResolvedValue(MOD);
  expect((await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "approve" }, {})).status).toBe(403);
  expect((await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "publish" })).status).toBe(400);
  expect(rpcCalls("moderate_entity_screenshot")).toEqual([]);
  expect([...bucket.objects.keys()]).toEqual([PENDING]);
});

test("approve: the file moves from pending/ to public/ and the row says approved", async () => {
  auth.getUser.mockResolvedValue(MOD);
  const response = await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "approve" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "approved" });
  expect([...bucket.objects.keys()]).toEqual([PUBLIC]);
  expect(rpcCalls("moderate_entity_screenshot")).toEqual([{ p_moderator_id: MOD.id, p_screenshot_id: SHOT, p_action: "approve" }]);
});

test("approve with no file waiting is refused before the row changes", async () => {
  auth.getUser.mockResolvedValue(MOD);
  bucket.objects.clear();
  expect((await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "approve" })).status).toBe(409);
  expect(rpcCalls("moderate_entity_screenshot")).toEqual([]);
});

test("reject: the row says rejected and both files go", async () => {
  auth.getUser.mockResolvedValue(MOD);
  bucket.objects.set(PUBLIC, webp(8, 8));
  moderated = { screenshot_ref: SHOT, status: "rejected", refusal: null };
  const response = await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "reject" });
  expect(await response.json()).toEqual({ status: "rejected" });
  expect(bucket.objects.size).toBe(0);
  moderated = { screenshot_ref: null, status: "deleted", refusal: "wrong_status" };
  expect((await post(moderate, "/screenshots/moderate", { screenshotId: SHOT, action: "reject" })).status).toBe(409);
});

test("file: an approved one to anyone, cached an hour, always image/webp with nosniff; anything else 404", async () => {
  bucket.objects.set(PUBLIC, webp(8, 8));
  const response = await file.GET(new Request(`${SITE}/screenshots/file/${SHOT}`), ctx(SHOT));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp(8, 8));
  // The public file never reads the session and asks about no viewer.
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(rpcCalls("entity_screenshot_access")).toEqual([{ p_screenshot_id: SHOT, p_viewer: null }]);
  for (const a of [null, "review"]) {
    access = a;
    const refused = await file.GET(new Request(`${SITE}/screenshots/file/${SHOT}`), ctx(SHOT));
    expect(refused.status, String(a)).toBe(404);
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
  }
  expect((await file.GET(new Request(`${SITE}/screenshots/file/x`), ctx("../pending/x"))).status).toBe(404);
});

test("review: a pending file for its uploader or a moderator only, never cached", async () => {
  access = "review";
  const response = await review.GET(new Request(`${SITE}/screenshots/review/${SHOT}`), ctx(SHOT));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp(8, 8));
  expect(rpcCalls("entity_screenshot_access")).toEqual([{ p_screenshot_id: SHOT, p_viewer: USER.id }]);
  access = null;
  expect((await review.GET(new Request(`${SITE}/screenshots/review/${SHOT}`), ctx(SHOT))).status).toBe(404);
  auth.getUser.mockResolvedValueOnce(null);
  expect((await review.GET(new Request(`${SITE}/screenshots/review/${SHOT}`), ctx(SHOT))).status).toBe(404);
});
