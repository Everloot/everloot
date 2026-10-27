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
}));
const request = vi.hoisted(() => ({ headers: new Headers(), cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: (name: string) => (name in request.cookies ? { value: request.cookies[name] } : undefined) }),
}));
vi.mock("@/lib/auth/device-accounts", () => ({ ADD_FROM_COOKIE: "everloot_add_from" }));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("../page", () => ({ default: () => <p>The landing page</p> }));
vi.mock("@/lib/changes", () => ({
  TYPE_LABEL: { post: "Blue post", hotfix: "Hotfix", build: "Build" },
  loadTimeline: () => Array.from({ length: 8 }, (_, i) => ({
    id: i === 0 ? "build:e0" : `forum:${i}`, type: i === 0 ? "build" : "post", game: i === 1 ? "classic" : "forever", at: `2026-10-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
    title: `Entry ${i}`, url: i === 0 ? null : `https://us.forums.blizzard.com/t/${i}`,
  })),
  filterTimeline: (all: Array<{ game: string }>, _f: string, game?: string) => all.filter((e) => !game || e.game === game),
}));

import SignedInHome from "./page";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const JAINA = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const THRALL = "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33";
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const build = (over: object) => ({
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", slug: "AbCd1234", name: "Fire", notes: null, class_slug: "mage", character_id: null, code: MAGE,
  code2: null, game_build: "1.60.1.70450", shared: true, show_name: false, active: false, updated_at: "2026-10-20T12:00:00+00:00", ...over,
});
let profileRow: object | null;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  request.headers = new Headers();
  request.cookies = {};
  profileRow = { handle: "thrall", display_name: "Go'el", status_emoji: "🔥", status_text: "Raiding", status_clears_at: null, public_profile: false,
    show_characters: true, show_builds: true, show_status: true, main_character_id: THRALL, active_character_id: JAINA };
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("user_profiles")) return profileRow ? [profileRow] : [];
    if (path.startsWith("build_characters")) {
      return [{ id: JAINA, name: "Jaina", class_slug: "mage", realm: "Pioneer", note: null }, { id: THRALL, name: "Thrall", class_slug: "warrior", realm: null, note: null }];
    }
    return [build({ id: "4b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e44", name: "Raid frost", character_id: JAINA, active: true }), build({ name: "Loose fire" })];
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off /home is a 404 and nothing is read", async () => {
  vi.stubEnv("EVERLOOT_PROFILES", "");
  await expect(SignedInHome({})).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("no session: /home itself goes back to /, and a stale cookie on / gets the landing page", async () => {
  auth.getUser.mockResolvedValue(null);
  await expect(SignedInHome({})).rejects.toThrow("NEXT_REDIRECT /");
  request.headers = new Headers({ "x-everloot-home": "1" });
  expect(renderToStaticMarkup(await SignedInHome({}))).toBe("<p>The landing page</p>");
  // Storage trouble also falls back to the landing page.
  auth.getUser.mockResolvedValue(USER);
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect(renderToStaticMarkup(await SignedInHome({}))).toBe("<p>The landing page</p>");
});

test("the three columns: the player, the Ask box and the active character's builds, the latest from Forever", async () => {
  const html = renderToStaticMarkup(await SignedInHome({})).replace(/&#x27;/g, "'");
  // Left rail: the card, the switch, the characters with the main marked, the recent builds.
  expect(html).toContain("Go'el");
  expect(html).toContain("@thrall");
  expect(html).toContain("🔥 Raiding");
  expect(html).toMatch(/Playing<\/span><span class="[^"]*text-class-mage[^"]*">Jaina</);
  expect(html).toContain('aria-label="Switch character"');
  expect(html).toContain('bg-class-warrior');
  expect(html).toMatch(/Thrall<\/span><span class="text-meta text-muted">Main</);
  expect(html).toContain('href="/changes"');
  expect(html).toContain("Loose fire");
  // Centre: the greeting the server can say, quick actions, the active character's builds only.
  expect(html).toContain("Hello, Go'el!");
  for (const href of ["/tools/talents", "/database/items", "/tools/auctions", "/upload"]) expect(html).toContain(`href="${href}"`);
  expect(html).toContain("Builds for <span");
  expect(html).toContain('aria-label="Builds for Jaina"');
  // Right rail: the five newest Forever entries, no Classic.
  expect(html).toContain("Latest from Forever");
  expect(html).toContain("Entry 0");
  expect(html).toMatch(/<a href="\/changes" class="[^"]*">Entry 0</);
  // A blue post links its page on Everloot, in blue; the build links the list.
  expect(html).toMatch(/<a href="\/changes\/us-2-entry-2" class="[^"]*text-blue-post[^"]*">Entry 2</);
  expect(html).not.toContain("forums.blizzard.com");
  expect(html).not.toContain("Entry 1<");
  expect(html).toContain("Entry 5");
  expect(html).not.toContain("Entry 6");
  // Never the BattleTag.
  expect(html).not.toContain("Thrall#1234");
});

test("disabled saved builds keeps Home useful without character or build navigation", async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "0");
  const html = renderToStaticMarkup(await SignedInHome({}));
  expect(html).toContain("Hello, Go&#x27;el!");
  expect(html).toContain('aria-label="Ask anything"');
  expect(html).toContain("Latest from Forever");
  expect(html).not.toMatch(/href="\/me(?:"|\/)/);
  expect(html).not.toContain("Recent builds");
  expect(html).not.toContain('id="active-builds"');
  expect(html).not.toContain('name="character"');
  expect(auth.authQuery.mock.calls.some(([path]) => path.startsWith("saved_builds"))).toBe(false);
});

test("the Ask box hands the question and the active character to Chat", async () => {
  const html = renderToStaticMarkup(await SignedInHome({}));
  const form = html.match(/<form[^>]*>.*?<\/form>/)![0];
  expect(form).toContain('action="/chat"');
  expect(form).toContain('method="get"');
  expect(form).toContain('name="q"');
  expect(form).toContain(`<input type="hidden" name="character" value="${JAINA}"/>`);
  // So the browser goes to /chat?q=<question>&character=<id>.
  const fields = new URLSearchParams({ q: "Best spec?", character: JAINA });
  expect(`/chat?${fields}`).toBe(`/chat?q=Best+spec%3F&character=${JAINA}`);
});

test("back from adding a Battle.net account that was already here: says so, once and only then", async () => {
  const added = (value: string) => ({ searchParams: Promise.resolve({ added: value }) });
  const notice = "You're already signed in as Go'el. To add a different Battle.net account, sign out at battle.net first, then try again.";
  const text = async (props?: object) => renderToStaticMarkup(await SignedInHome((props ?? {}) as never)).replace(/&#x27;/g, "'");
  request.cookies = { everloot_add_from: `99999999-0000-4000-8000-000000000000,${USER.id}` };
  expect(await text(added("bnet"))).toContain(notice);
  // Not after an email sign-in, not without the marker, not when a new account came back.
  expect(await text(added("email"))).not.toContain("already signed in");
  expect(await text()).not.toContain("already signed in");
  request.cookies = { everloot_add_from: "99999999-0000-4000-8000-000000000000" };
  expect(await text(added("bnet"))).not.toContain("already signed in");
  request.cookies = {};
  expect(await text(added("bnet"))).not.toContain("already signed in");
});

test("a new player: no handle, no character, the active character follows the main", async () => {
  profileRow = null;
  const html = renderToStaticMarkup(await SignedInHome({}));
  expect(html).toContain("Hello, Thrall!");
  expect(html).toContain("Choose a handle");
  expect(html).not.toContain('name="character"');
  expect(html).toContain("bg-accent");
  profileRow = { handle: null, display_name: null, status_emoji: null, status_text: null, status_clears_at: null, public_profile: false,
    show_characters: true, show_builds: true, show_status: true, main_character_id: THRALL, active_character_id: null };
  expect(renderToStaticMarkup(await SignedInHome({}))).toContain(`name="character" value="${THRALL}"`);
});
