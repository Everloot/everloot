import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/components/ApiKeys", () => ({ default: () => <div>api keys</div> }));
vi.mock("@/lib/auth/auth", () => ({ authV2Enabled: () => false, getAuth: () => { throw new Error("unused"); } }));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { keySummary } from "@/lib/api-keys";
import AccountPage from "./page";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const THRALL = "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33";
const KEY_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const KEY_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function store(path: string): unknown {
  if (path.startsWith("users?")) return [{ created_at: "2026-10-03T12:00:00+00:00" }];
  if (path.startsWith("user_profiles?")) {
    return [{ handle: "thrall", display_name: "Go'el", status_emoji: null, status_text: null, status_clears_at: null,
      public_profile: true, show_characters: true, show_builds: true, show_status: true, main_character_id: THRALL, active_character_id: null }];
  }
  if (path.startsWith("build_characters?")) {
    return [{ id: THRALL, name: "Thrall", class_slug: "warrior", realm: null, note: null }, { id: "4b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e44", name: "Jaina", class_slug: "mage", realm: null, note: null }];
  }
  if (path.startsWith("saved_builds?")) return [{ id: "b1" }, { id: "b2" }, { id: "b3" }];
  if (path.startsWith("api_keys?")) {
    return [
      { id: KEY_A, hint: "abcd", label: "Everloot Desktop App", scopes: ["read:public"], created_at: "2026-10-10T00:00:00Z", last_used_at: null, revoked_at: null, expires_at: null },
      { id: KEY_B, hint: "ef01", label: "old", scopes: ["read:public"], created_at: "2026-10-01T00:00:00Z", last_used_at: null, revoked_at: "2026-10-05T00:00:00Z", expires_at: null },
    ];
  }
  if (path.startsWith("api_key_usage?")) return [{ count: 1200 }, { count: "34" }];
  throw new Error(`unexpected read ${path}`);
}

const SWITCHES = ["EVERLOOT_PROFILES", "EVERLOOT_SAVED_BUILDS", "EVERLOOT_DATA_GUARD", "EVERLOOT_PLAYER_PAGES"];
const switches = (on: boolean) => SWITCHES.forEach((name) => vi.stubEnv(name, on ? "1" : "0"));
const render = async () => renderToStaticMarkup(await AccountPage());

beforeEach(() => {
  switches(true);
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => store(path));
});
afterEach(() => { vi.unstubAllEnvs(); });

test("signed out: the page sends the visitor to sign in and reads nothing else", async () => {
  auth.getUser.mockResolvedValue(null);
  await expect(AccountPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?returnTo=%2Faccount");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("the sections come in order, each with an anchor in the page's nav", async () => {
  const html = await render();
  const ids = ["overview", "profile", "keys", "chat-keys", "data"];
  for (const id of ids) {
    expect(html).toContain(`<section id="${id}"`);
    expect(html).toContain(`href="#${id}"`);
  }
  const at = ids.map((id) => html.indexOf(`<section id="${id}"`));
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(html).toMatch(/<nav aria-label="Account sections"[^>]*>(<a href="#[a-z-]+"[^>]*>[^<]+<\/a>){5}<\/nav>/);
});

test("switches off: Profile has nothing to show, so it and its nav link go and its sentence moves into Overview", async () => {
  switches(false);
  const html = await render();
  expect(html).not.toContain('<section id="profile"');
  expect(html).not.toContain('href="#profile"');
  expect(html).toMatch(/<nav aria-label="Account sections"[^>]*>(<a href="#[a-z-]+"[^>]*>[^<]+<\/a>){4}<\/nav>/);
  expect(html).toMatch(/<section id="overview"[^>]*>(?:(?!<\/section>).)*Only you see your account name\.<\/p><\/section>/);
});

test("Chat keys keeps its own section, the target of chat's key setup, and says keys stay in the browser", async () => {
  const html = await render();
  expect(html).toMatch(/<section id="chat-keys"[^>]*><h2 id="chat-keys-heading"[^>]*>Chat keys<\/h2>/);
  expect(html).toContain("Everloot&#x27;s servers never receive them");
  expect(html).toContain("Chat keys stay in this browser.");
});

test("switches on: the overview counts characters, builds, keys and this week's requests", async () => {
  const html = await render();
  expect(html).toContain("BattleTag</dt><dd");
  expect(html).toContain("Thrall#1234");
  expect(html).toContain("Battle.net");
  expect(html).toContain("October 3, 2026");
  expect(html).toContain("@thrall");
  expect(html).toContain('href="/u/thrall"');
  expect(html).toMatch(/Main character<\/dt><dd[^>]*><span class="[^"]*">Thrall<\/span>/);
  expect(html).toMatch(/Characters<\/dt><dd[^>]*>2<\/dd>/);
  expect(html).toMatch(/Saved builds<\/dt><dd[^>]*><a href="\/me"[^>]*>3<\/a>/);
  expect(html).toMatch(/API keys<\/dt><dd[^>]*><a href="#keys"[^>]*>1 of 5<\/a>/);
  expect(html).toMatch(/Requests, last 7 days<\/dt><dd[^>]*>1,234<\/dd>/);
  expect(html).toMatch(/Desktop App<\/dt><dd[^>]*>Has a key · <a href="\/addon#desktop"/);
  expect(html).toContain('href="/docs/guides/desktop"');
  expect(html).toContain("Go&#x27;el");
  expect(html).toContain('href="/settings"');
  expect(html).toContain('href="/players/opt-out"');
  expect(html).toContain('href="/me"');
  expect(html).toContain("Everloot keeps your sign-in details, your API keys with a daily count of their requests, your saved builds and characters, and your profile.");
});

test("switches off: those rows are left out quietly and their tables are never read", async () => {
  switches(false);
  const html = await render();
  for (const row of ["Handle", "Public profile", "Main character", "Characters", "Saved builds", "API keys</dt>", "Requests, last 7 days"]) {
    expect(html).not.toContain(`>${row}`);
  }
  expect(html).toContain("October 3, 2026");
  expect(html).toMatch(/Desktop App<\/dt><dd[^>]*><a href="\/addon#desktop"/);
  expect(html).not.toContain('href="/players/opt-out"');
  expect(html).not.toContain('href="/settings"');
  expect(html).toContain("Everloot keeps your sign-in details.");
  const read = auth.authQuery.mock.calls.map(([path]) => path as string);
  expect(read).toEqual([`users?select=created_at&id=eq.${USER.id}&limit=1`]);
});

test("every read is the signed-in owner's: by user id, and usage only for the owner's keys", async () => {
  await render();
  const read = auth.authQuery.mock.calls.map(([path]) => path as string);
  expect(read.length).toBeGreaterThan(4);
  for (const path of read) {
    if (path.startsWith("api_key_usage?")) expect(path).toMatch(new RegExp(`key_id=in\\.\\(${KEY_A},${KEY_B}\\)&day=gte\\.\\d{4}-\\d{2}-\\d{2}$`));
    else if (path.startsWith("users?")) expect(path).toContain(`id=eq.${USER.id}`);
    else expect(path).toContain(`user_id=eq.${USER.id}`);
  }
});

test("this week is the last 7 UTC days, today included; an account with no keys reads no usage", async () => {
  expect((await keySummary(USER.id, 7, new Date("2026-10-20T03:00:00Z"))).requests).toBe(1234);
  expect(auth.authQuery.mock.calls.at(-1)?.[0]).toContain("&day=gte.2026-10-14");
  auth.authQuery.mockReset().mockResolvedValue([]);
  expect(await keySummary(USER.id)).toEqual({ keys: [], requests: 0 });
  expect(auth.authQuery).toHaveBeenCalledTimes(1);
});

test("account deletion is by email, as the privacy policy says; there is no self-serve delete or export", async () => {
  const html = await render();
  expect(html).toContain('href="mailto:hello@everloot.app"');
  expect(html).toContain('href="/privacy"');
  expect(html).not.toMatch(/download my data|export/i);
});

test("storage trouble: the overview keeps the sign-in rows and says the rest is unavailable", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  const html = await render();
  expect(html).toContain("Thrall#1234");
  expect(html).toContain("Some details are unavailable right now.");
  expect(html).not.toContain("Member since");
  expect(html).toContain('<section id="chat-keys"');
});
