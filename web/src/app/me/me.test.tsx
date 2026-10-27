import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/me",
}));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import MyBuildsPage from "./page";
import CharacterPage from "./characters/[id]/page";
import { loadCatalog } from "@/lib/talents/catalogs";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const JAINA = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const build = (over: object) => ({
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", slug: "AbCd1234", name: "Fire", notes: null, class_slug: "mage", character_id: null, code: MAGE,
  code2: null, game_build: "1.60.1.70450", shared: true, show_name: false, active: false, updated_at: "2026-10-20T12:00:00+00:00", ...over,
});
let characters: object[] = [];
let builds: object[] = [];

beforeEach(() => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  characters = [{ id: JAINA, name: "Jaina", class_slug: "mage", realm: "Pioneer", note: null }];
  builds = [
    build({ id: "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33", name: "Raid frost", character_id: JAINA, active: true, slug: "Frost123" }),
    build({ id: "4b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e44", name: "Old arcane", character_id: JAINA, game_build: "1.50.0.1", shared: false, slug: "Arcane12" }),
    build({ name: "Loose fire" }),
  ];
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => (path.startsWith("build_characters") ? characters : builds));
});
afterEach(() => { vi.unstubAllEnvs(); });

const characterPage = (id: string) => CharacterPage({ params: Promise.resolve({ id }) });

test("with the switch off both pages are a 404 and nothing is read", async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
  await expect(MyBuildsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(characterPage(JAINA)).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("signed out, both pages send the visitor to sign in and back", async () => {
  auth.getUser.mockResolvedValue(null);
  await expect(MyBuildsPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?returnTo=%2Fme");
  await expect(characterPage(JAINA)).rejects.toThrow(`NEXT_REDIRECT /sign-in?returnTo=${encodeURIComponent(`/me/characters/${JAINA}`)}`);
});

test("/me shows each character's card, then the builds filed under none", async () => {
  const html = renderToStaticMarkup(await MyBuildsPage());
  expect(html).toContain("My builds");
  expect(html).toContain("3 builds · 1 character");
  expect(html).toContain(`href="/me/characters/${JAINA}"`);
  expect(html).toContain("Mage · Pioneer · 2 builds");
  expect(html).toContain("Active: Raid frost");
  expect(html).toContain("Loose fire");
  // Builds under a character are on the character's page, not repeated here.
  expect(html).not.toContain("Old arcane");
  expect(html).toContain('href="/b/AbCd1234"');
  expect(html).toContain(`href="/tools/talents/mage?saved=0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11#plan=${MAGE}"`);
  for (const [path] of auth.authQuery.mock.calls) expect(path).toContain(`user_id=eq.${USER.id}`);
});

test("an account with nothing saved is pointed at the calculator", async () => {
  characters = [];
  builds = [];
  const html = renderToStaticMarkup(await MyBuildsPage());
  expect(html).toContain("No saved builds yet");
  expect(html).toContain('href="/tools/talents"');
});

test("a character's page lists its builds, the active mark and the quiet older-build marker, and edits the label", async () => {
  const html = renderToStaticMarkup(await characterPage(JAINA));
  expect(html).toContain("Jaina");
  expect(html).toContain("Mage · Pioneer");
  expect(html).toContain("Raid frost");
  expect(html).toContain("Old arcane");
  expect(html).not.toContain("Loose fire");
  expect(html).toContain('data-badge="neutral"');
  expect(html).toMatch(/data-badge="files" title="Made on an older game build[^"]*"/);
  expect(html).toContain("made on an older game build");
  expect(html).toContain(">Off<");
  expect(html).toContain("Make active");
  expect(html).toContain('aria-label="Edit character"');
  // The class is fixed while builds are filed under it.
  expect(html).toMatch(/<select[^>]*disabled/);
});

test("the game build's marker says older only when it is older, newer when it is newer, and nothing for the tree's build or one that cannot be read", async () => {
  const { build: tree } = await loadCatalog("mage");
  const parts = tree.split(".");
  const step = (by: number) => [...parts.slice(0, -1), String(Number(parts.at(-1)) + by)].join(".");
  // 9999 comes before 70450 as a number, though not as text.
  const games = [step(-1), "1.0.0.9999", step(1), tree, "", "latest", "1.60"];
  builds = games.map((game_build, i) => build({ id: `${i}b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e0${i}`, slug: `Game${i}aaa`, name: `Build ${i}`, character_id: JAINA, game_build }));
  const html = renderToStaticMarkup(await characterPage(JAINA));
  expect(html.match(/made on an older game build/g)).toHaveLength(2);
  expect(html.match(/made on a newer game build/g)).toHaveLength(1);
  expect(html).toMatch(/data-badge="files" title="Made on a newer game build[^"]*"/);
  // The phone line says the same, build by build.
  expect(html).toContain(`· ${step(-1)} (older build) ·`);
  expect(html).toContain("· 1.0.0.9999 (older build) ·");
  expect(html).toContain(`· ${step(1)} (newer build) ·`);
  for (const plain of [tree, "latest", "1.60"]) expect(html, plain).toContain(`· ${plain} ·`);
});

test("another player's character, or a malformed id, is a 404", async () => {
  await expect(characterPage("5b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e55")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(characterPage("nope")).rejects.toThrow("NEXT_NOT_FOUND");
});

test("storage trouble says so instead of failing the page", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect(renderToStaticMarkup(await MyBuildsPage())).toContain("unavailable right now");
});
