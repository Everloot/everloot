import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, usePathname: () => "/ops/comments" }));

import CommentModerationPage, { dynamic, fetchCache, metadata } from "./page";

const MOD = { id: "11111111-2222-4333-8444-555555555555", name: "Mod#1" };
const QUEUED = {
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", entity_type: "item", entity_id: 19019, author: "thrall", body: "Buy gold at **cheap-gold**",
  status: "visible", created_at: "2026-11-25T10:00:00+00:00", edited_at: null, moderated_at: null, open_reports: 2,
  reasons: ["spam", "abuse"], notes: ["selling gold"],
};
let moderator: boolean;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_COMMENTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  moderator = true;
  auth.getUser.mockReset().mockResolvedValue(MOD);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/is_comment_moderator") return moderator;
    if (path === "rpc/comment_moderation_queue") return [QUEUED];
    throw new Error(path);
  });
});
afterEach(() => vi.unstubAllEnvs());

it("is a 404 with the switch off, signed out, or for an account that does not moderate, before reading the queue", async () => {
  vi.stubEnv("EVERLOOT_COMMENTS", "");
  await expect(CommentModerationPage()).rejects.toThrow("NOT_FOUND");
  vi.stubEnv("EVERLOOT_COMMENTS", "1");
  auth.getUser.mockResolvedValueOnce(null);
  await expect(CommentModerationPage()).rejects.toThrow("NOT_FOUND");
  moderator = false;
  await expect(CommentModerationPage()).rejects.toThrow("NOT_FOUND");
  expect(auth.authQuery.mock.calls.some(([path]) => path === "rpc/comment_moderation_queue")).toBe(false);
});

it("shows a moderator the reported comments with reasons, notes, the page and the actions, never who reported", async () => {
  const html = renderToStaticMarkup(await CommentModerationPage());
  expect(html).toContain("@thrall");
  expect(html).toContain('href="/database/items/19019"');
  expect(html).toContain("2 open reports");
  expect(html).toContain("Spam or advertising");
  expect(html).toContain("selling gold");
  expect(html).toContain("<strong>cheap-gold</strong>");
  expect(html).toMatch(/>Hide<\/button>/);
  expect(html).toMatch(/>Dismiss reports<\/button>/);
  expect(dynamic).toBe("force-dynamic");
  expect(fetchCache).toBe("force-no-store");
  expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
});
