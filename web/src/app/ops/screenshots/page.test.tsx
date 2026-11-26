import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, usePathname: () => "/ops/screenshots" }));

import ScreenshotModerationPage, { dynamic, fetchCache, metadata } from "./page";

const MOD = { id: "11111111-2222-4333-8444-555555555555", name: "Mod#1" };
const PENDING = {
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", entity_type: "npc", entity_id: 11502, author: "thrall", status: "pending",
  width: 1920, height: 1080, bytes: 312000, created_at: "2026-11-25T10:00:00+00:00", moderated_at: null,
};
const APPROVED = { ...PENDING, id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e12", status: "approved", moderated_at: "2026-11-25T11:00:00+00:00" };
let moderator: boolean;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_SCREENSHOTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  moderator = true;
  auth.getUser.mockReset().mockResolvedValue(MOD);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/is_comment_moderator") return moderator;
    if (path === "rpc/screenshot_moderation_queue") return [PENDING, APPROVED];
    throw new Error(path);
  });
});
afterEach(() => vi.unstubAllEnvs());

it("is a 404 with the switch off, signed out, or for an account that does not moderate, before reading the queue", async () => {
  vi.stubEnv("EVERLOOT_SCREENSHOTS", "");
  await expect(ScreenshotModerationPage()).rejects.toThrow("NOT_FOUND");
  vi.stubEnv("EVERLOOT_SCREENSHOTS", "1");
  auth.getUser.mockResolvedValueOnce(null);
  await expect(ScreenshotModerationPage()).rejects.toThrow("NOT_FOUND");
  moderator = false;
  await expect(ScreenshotModerationPage()).rejects.toThrow("NOT_FOUND");
  expect(auth.authQuery.mock.calls.some(([path]) => path === "rpc/screenshot_moderation_queue")).toBe(false);
});

it("shows a moderator each waiting screenshot from the review route, its page and uploader, with approve and reject", async () => {
  const html = renderToStaticMarkup(await ScreenshotModerationPage());
  expect(html).toContain(`src="/screenshots/review/${PENDING.id}"`);
  expect(html).toContain(`src="/screenshots/file/${APPROVED.id}"`);
  expect(html).toContain('href="/database/npcs/11502"');
  expect(html).toContain("@thrall");
  expect(html).toContain("1920 × 1080");
  expect(html).toMatch(/>Approve<\/button>/);
  expect(html).toMatch(/>Reject<\/button>/);
  expect(html).toMatch(/>Take down<\/button>/);
  expect(dynamic).toBe("force-dynamic");
  expect(fetchCache).toBe("force-no-store");
  expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
});
