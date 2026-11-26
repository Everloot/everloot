import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PNG_BYTES, fakeBucket, fakeImages, text, webp, webpWithExif } from "@/test/screenshots";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cf.env }) }));

import { GET, POST } from "./route";

const SITE = "https://everloot.app";
const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const SHOT = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";

let bucket: ReturnType<typeof fakeBucket>;
let images: ReturnType<typeof fakeImages>;
let refusal: string | null;

const get = (query: string) => GET(new Request(`${SITE}/screenshots?${query}`));
function upload(fields: Record<string, string | Blob> = {}, headers: Record<string, string> = { origin: SITE }, size?: number) {
  const form = new FormData();
  const all = { type: "item", id: "19019", confirm: "yes", file: new File([PNG_BYTES], "shot.png", { type: "image/png" }), ...fields };
  for (const [k, v] of Object.entries(all)) if (v !== "") form.append(k, v);
  const request = new Request(`${SITE}/screenshots`, { method: "POST", headers, body: form });
  // A browser always sends the length of a form upload; undici leaves it to the transport, so tests set it.
  const sized = new Request(request, { headers: new Headers(request.headers) });
  sized.headers.set("content-length", String(size ?? 4096));
  return POST(sized);
}
const rpcCalls = (name: string) => auth.authQuery.mock.calls.filter(([path]) => path === `rpc/${name}`).map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_SCREENSHOTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  bucket = fakeBucket();
  images = fakeImages({ format: "image/png", width: 2560, height: 1440 });
  cf.env = { SCREENSHOTS: bucket, IMAGES: images };
  refusal = null;
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/entity_screenshots_for") return [{ id: SHOT, author: "thrall", width: 1920, height: 1080, approved_at: "2026-11-25T10:00:00+00:00" }];
    if (path === "rpc/screenshot_upload_refusal") return refusal;
    if (path === "rpc/submit_entity_screenshot") return { screenshot_ref: SHOT, refusal: null };
    if (path === "rpc/delete_entity_screenshot") return { screenshot_ref: SHOT, was: "pending", refusal: null };
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

test("off unless EVERLOOT_SCREENSHOTS=1 and profiles are on: 404, no storage, no session read", async () => {
  for (const [shots, profiles] of [["", "1"], ["1", ""], ["true", "1"]]) {
    vi.stubEnv("EVERLOOT_SCREENSHOTS", shots);
    vi.stubEnv("EVERLOOT_PROFILES", profiles);
    expect((await get("type=item&id=19019")).status).toBe(404);
    expect((await upload()).status).toBe(404);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(images.info).not.toHaveBeenCalled();
});

test("GET is the approved gallery, the same for everyone: cached, unindexed, and it never reads the session", async () => {
  const response = await get("type=item&id=19019");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.get("cdn-cache-control")).toBe("max-age=300");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(rpcCalls("entity_screenshots_for")).toEqual([{ p_entity_type: "item", p_entity_id: 19019 }]);
  expect(await response.json()).toEqual({ screenshots: [{ id: SHOT, author: "thrall", width: 1920, height: 1080, approvedAt: "2026-11-25T10:00:00.000Z" }] });
  for (const q of ["type=guild&id=1", "type=item&id=0", "type=item&id=abc", "type=item"]) expect((await get(q)).status, q).toBe(400);
});

test("an upload needs this site's Origin, a session, and the account the page named", async () => {
  expect((await upload({}, {})).status).toBe(403);
  expect((await upload({}, { origin: "https://evil.example" })).status).toBe(403);
  auth.getUser.mockResolvedValueOnce(null);
  expect((await upload()).status).toBe(401);
  expect((await upload({}, { origin: SITE, "x-everloot-expected-owner": "99999999-2222-4333-8444-555555555555" })).status).toBe(409);
  expect(images.info).not.toHaveBeenCalled();
  expect(bucket.put).not.toHaveBeenCalled();
});

test("size: a body without a length, or over 8 MB, is refused before it is read", async () => {
  const form = new FormData();
  form.append("file", new File([PNG_BYTES], "shot.png"));
  const unsized = new Request(`${SITE}/screenshots`, { method: "POST", headers: { origin: SITE }, body: form });
  expect(unsized.headers.has("content-length")).toBe(false);
  expect((await POST(unsized)).status).toBe(411);
  expect((await upload({}, { origin: SITE }, 8 * 1024 * 1024 + 70_000)).status).toBe(413);
  const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png");
  expect((await upload({ file: big }, { origin: SITE }, 8 * 1024 * 1024 + 2000)).status).toBe(413);
  expect(images.info).not.toHaveBeenCalled();
});

test("type by content, not by name: HTML, SVG and GIF named .png are refused with no re-encode", async () => {
  for (const body of ["<!doctype html><script>alert(1)</script>", "<svg xmlns='http://www.w3.org/2000/svg' onload='x()'/>", "GIF89a\u0001\u0000"]) {
    const response = await upload({ file: new File([body], "shot.png", { type: "image/png" }) });
    expect(response.status, body).toBe(415);
  }
  expect(images.info).not.toHaveBeenCalled();
  expect(bucket.put).not.toHaveBeenCalled();
});

test("the form: the licence box must be ticked, the page must be real, and nothing else may come along", async () => {
  expect((await upload({ confirm: "" })).status).toBe(400);
  expect((await upload({ confirm: "no" })).status).toBe(400);
  expect((await upload({ type: "guild" })).status).toBe(400);
  expect((await upload({ id: "-4" })).status).toBe(400);
  expect((await upload({ caption: "hi" })).status).toBe(400);
  expect((await upload({ file: "not a file" })).status).toBe(400);
  expect(bucket.put).not.toHaveBeenCalled();
});

test("a refusal (handle, limits) comes before any re-encode, and counts nothing", async () => {
  for (const [r, status] of [["needs_handle", 409], ["too_many_pending", 429], ["daily_limit", 429], ["site_limit", 429]] as const) {
    refusal = r;
    expect((await upload()).status, r).toBe(status);
  }
  expect(images.info).not.toHaveBeenCalled();
  expect(rpcCalls("submit_entity_screenshot")).toEqual([]);
});

test("a picture Cloudflare Images reads as another type, cannot read, or finds too large is refused", async () => {
  images.info.mockResolvedValueOnce({ format: "image/gif", width: 10, height: 10 });
  expect((await upload()).status).toBe(415);
  images.info.mockRejectedValueOnce(new Error("bad"));
  expect((await upload()).status).toBe(415);
  images.info.mockResolvedValueOnce({ format: "image/png", width: 10000, height: 10000 });
  expect((await upload()).status).toBe(413);
  expect(bucket.put).not.toHaveBeenCalled();
});

test("taken: re-encoded to a WebP of at most 1920 px, metadata stripped, stored under pending/ and recorded", async () => {
  images = fakeImages({ format: "image/png", width: 2560, height: 1440 }, webpWithExif(1920, 1080));
  cf.env = { SCREENSHOTS: bucket, IMAGES: images };
  const response = await upload();
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ screenshotId: SHOT });
  expect(images.transform).toHaveBeenCalledWith({ width: 1920, height: 1920, fit: "scale-down" });
  expect(images.output).toHaveBeenCalledWith({ format: "image/webp", quality: 85, anim: false });
  const stored = bucket.objects.get(`screenshots/pending/${SHOT}.webp`)!;
  expect(stored).toEqual(webp(1920, 1080));
  expect(text(stored)).not.toMatch(/EXIF|GPS/);
  expect([...bucket.objects.keys()]).toEqual([`screenshots/pending/${SHOT}.webp`]);
  expect(rpcCalls("submit_entity_screenshot")).toEqual([
    { p_user_id: USER.id, p_entity_type: "item", p_entity_id: 19019, p_width: 1920, p_height: 1080, p_bytes: stored.length },
  ]);
});

test("a refusal at submit (a race past the limit) writes no file", async () => {
  auth.authQuery.mockImplementation(async (path: string) => {
    if (path === "rpc/screenshot_upload_refusal") return null;
    if (path === "rpc/submit_entity_screenshot") return { screenshot_ref: null, refusal: "daily_limit" };
    throw new Error(path);
  });
  expect((await upload()).status).toBe(429);
  expect(bucket.put).not.toHaveBeenCalled();
});

test("a failed file write takes the row back, so no empty entry waits for review", async () => {
  bucket.put.mockRejectedValueOnce(new Error("R2 down"));
  expect((await upload()).status).toBe(503);
  expect(rpcCalls("delete_entity_screenshot")).toEqual([{ p_user_id: USER.id, p_screenshot_id: SHOT }]);
});

test("without the bucket or Cloudflare Images bound, uploads are unavailable", async () => {
  cf.env = { SCREENSHOTS: bucket };
  expect((await upload()).status).toBe(503);
  cf.env = { IMAGES: images };
  expect((await upload()).status).toBe(503);
});
