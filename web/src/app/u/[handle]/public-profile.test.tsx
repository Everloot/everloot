import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import PublicProfilePage, { dynamic, generateMetadata } from "./page";

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });
let row: Record<string, unknown> | null;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  row = {
    handle: "thrall", display_name: "Go'el", status_emoji: "🔥", status_text: "Farming MC",
    characters: [{ name: "Jaina", class_slug: "mage", realm: "Pioneer", main: false }, { name: "Thrall", class_slug: "warrior", realm: null, main: true }],
    builds: [{ slug: "Frost123", name: "Raid frost", class_slug: "mage", updated_at: "2026-10-20T12:00:00+00:00" }],
  };
  auth.getUser.mockReset();
  auth.authQuery.mockReset().mockImplementation(async () => (row ? [row] : []));
});
afterEach(() => { vi.unstubAllEnvs(); });

test("off, unknown, not public or malformed: a 404 with noindex", async () => {
  vi.stubEnv("EVERLOOT_PROFILES", "");
  await expect(PublicProfilePage(params("thrall"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  row = null;
  await expect(PublicProfilePage(params("thrall"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect((await generateMetadata(params("thrall"))).robots).toEqual({ index: false, follow: false });
  auth.authQuery.mockClear();
  await expect(PublicProfilePage(params("th%20rall"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.authQuery).not.toHaveBeenCalled();
  auth.authQuery.mockRejectedValue(new Error("down"));
  await expect(PublicProfilePage(params("thrall"))).rejects.toThrow("NEXT_NOT_FOUND");
});

test("public: indexed, with the characters, shared builds and status the owner ticked, never their sign-in name", async () => {
  const metadata = await generateMetadata(params("Thrall"));
  expect(metadata.robots).toBeUndefined();
  expect(metadata.alternates?.canonical).toBe("/u/thrall");
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).toEqual({ p_handle: "Thrall" });
  const html = renderToStaticMarkup(await PublicProfilePage(params("thrall"))).replace(/&#x27;/g, "'");
  expect(html).toContain("Go'el");
  expect(html).toContain("@thrall");
  expect(html).toContain("🔥 Farming MC");
  expect(html).toMatch(/text-class-warrior">Thrall<\/span><span data-badge="neutral"[^>]*>Main</);
  expect(html).toContain("Pioneer");
  expect(html).toContain('href="/b/Frost123"');
  expect(html).toContain("Raid frost");
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(html).not.toMatch(/#\d{3,}|BattleTag|@everloot|email/i);
});

test("what the owner hides is not shown", async () => {
  row = { ...row, status_emoji: null, status_text: null, characters: null, builds: null, display_name: null };
  const html = renderToStaticMarkup(await PublicProfilePage(params("thrall")));
  expect(html).toContain("@thrall");
  expect(html).not.toContain("Characters");
  expect(html).not.toContain("Shared builds");
  expect(html).toContain("Nothing shared here yet.");
});

test("a private handle is the same uncached 404 as one nobody has", async () => {
  // public_profile returns no row for a private profile, and the page is rendered on every request, so turning
  // the profile off takes it down at once and nothing tells a private handle from a free one.
  expect(dynamic).toBe("force-dynamic");
  row = null;
  for (const handle of ["thrall", "nobody"]) {
    await expect(PublicProfilePage(params(handle))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(params(handle))).toEqual({ title: "Not found", robots: { index: false, follow: false } });
  }
});

test("every PROFILES and SAVED_BUILDS combination: off is a 404 that reads nothing; builds only while saved builds are on", async () => {
  for (const [profiles, savedBuilds] of [["0", "0"], ["0", "1"], ["1", "0"], ["1", "1"]]) {
    vi.stubEnv("EVERLOOT_PROFILES", profiles);
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", savedBuilds);
    auth.authQuery.mockClear();
    if (profiles === "0") {
      await expect(PublicProfilePage(params("thrall"))).rejects.toThrow("NEXT_NOT_FOUND");
      expect((await generateMetadata(params("thrall"))).robots).toEqual({ index: false, follow: false });
      expect(auth.authQuery).not.toHaveBeenCalled();
      continue;
    }
    const html = renderToStaticMarkup(await PublicProfilePage(params("thrall")));
    expect(html).toContain("@thrall");
    expect(html).toContain("Jaina");
    expect(html).toContain("🔥 Farming MC");
    // A shared build opens at /b/<slug>, a 404 while saved builds are off: not listed, not linked.
    expect(html.includes('href="/b/Frost123"'), `${profiles}/${savedBuilds}`).toBe(savedBuilds === "1");
    expect(html.includes("Raid frost")).toBe(savedBuilds === "1");
    expect(html.includes("Shared builds")).toBe(savedBuilds === "1");
  }
  // With saved builds off, builds alone leave nothing to show.
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "0");
  row = { ...row, status_emoji: null, status_text: null, characters: null };
  expect(renderToStaticMarkup(await PublicProfilePage(params("thrall")))).toContain("Nothing shared here yet.");
});

test("a legacy account's BattleTag, email and ids never reach the page or its metadata, even if a read returned them", async () => {
  const userId = "11111111-2222-4333-8444-555555555555";
  const characterId = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
  row = {
    ...row, user_id: userId, bnet_id: "bnet-913377", battletag: "Thrall#1234", email: "thrall@example.invalid", public_profile: true,
    characters: [{ name: "Jaina", class_slug: "mage", realm: "Pioneer", main: true, id: characterId, user_id: userId, note: "alt for farming" }],
    builds: [{ slug: "Frost123", name: "Raid frost", class_slug: "mage", updated_at: "2026-10-20T12:00:00+00:00", user_id: userId, notes: "private notes" }],
  };
  const html = renderToStaticMarkup(await PublicProfilePage(params("thrall")));
  const metadata = JSON.stringify(await generateMetadata(params("thrall")));
  expect(html).toContain("Raid frost");
  for (const secret of [userId, "bnet-913377", "Thrall#1234", "thrall@example.invalid", characterId, "alt for farming", "private notes"]) {
    expect(html).not.toContain(secret);
    expect(metadata).not.toContain(secret);
  }
});
