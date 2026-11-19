import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The list itself is the client's; Integrations uses the module's Disconnect and refresh as they are.
vi.mock("@/components/ApiKeys", async (importOriginal) => ({ ...await importOriginal<typeof import("@/components/ApiKeys")>(), default: () => <div>api keys</div> }));
vi.mock("@/lib/auth/auth", () => ({ authV2Enabled: () => false, withAuth: () => { throw new Error("unused"); } }));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { keySummary, type KeyRow } from "@/lib/api-keys";
import SettingsPage from "./page";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const THRALL = "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33";
const JAINA = "4b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e44";
const KEY_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const KEY_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const KEY_C = "cccccccc-3333-4333-8333-cccccccccccc";

const PROFILE = {
  handle: "thrall", display_name: "Go'el", status_emoji: "🔥", status_text: "Raiding", status_clears_at: "2099-01-01T00:00:00+00:00",
  public_profile: true, show_characters: true, show_builds: false, show_status: true, main_character_id: THRALL, active_character_id: null,
};
let profileRow: object | null;

const row = (over: Partial<KeyRow>): KeyRow => ({
  id: KEY_A, hint: "abcd", label: "Everloot Desktop App", scopes: ["read:public"], created_at: "2026-10-10T00:00:00Z",
  last_used_at: null, revoked_at: null, expires_at: null, ...over,
});
/** The Desktop App's live key, a revoked key, and a live script key. */
const KEYS: KeyRow[] = [
  row({}),
  row({ id: KEY_B, hint: "ef01", label: "old", revoked_at: "2026-10-05T00:00:00Z" }),
  row({ id: KEY_C, hint: "c0de", label: "Drop-rate script", last_used_at: "2026-10-20T08:00:00Z" }),
];

function store(path: string): unknown {
  if (path.startsWith("users?")) return [{ created_at: "2026-10-03T12:00:00+00:00" }];
  if (path.startsWith("user_profiles?")) return profileRow ? [profileRow] : [];
  if (path.startsWith("build_characters?")) {
    return [{ id: THRALL, name: "Thrall", class_slug: "warrior", realm: null, note: null }, { id: JAINA, name: "Jaina", class_slug: "mage", realm: "Pioneer", note: "alt" }];
  }
  if (path.startsWith("saved_builds?")) return [{ id: "b1" }, { id: "b2" }, { id: "b3" }];
  if (path.startsWith("api_keys?")) return KEYS;
  if (path.startsWith("api_key_usage?")) return [{ count: 1200 }, { count: "34" }];
  throw new Error(`unexpected read ${path}`);
}

const SWITCHES = ["EVERLOOT_PROFILES", "EVERLOOT_SAVED_BUILDS", "EVERLOOT_DATA_GUARD", "EVERLOOT_PLAYER_PAGES"];
const switches = (on: boolean) => SWITCHES.forEach((name) => vi.stubEnv(name, on ? "1" : "0"));
const render = async (query: { linkError?: string } = {}) => renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve(query) }));
/** A section's markup, by its id: "" when it is not on the page. */
const section = (html: string, id: string) => new RegExp(`<section id="${id}"[^>]*>(.*?)</section>`).exec(html)?.[1] ?? "";
const SECTIONS = ["profile", "characters", "privacy", "integrations", "keys", "danger"];

beforeEach(() => {
  switches(true);
  profileRow = PROFILE;
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => store(path));
});
afterEach(() => { vi.unstubAllEnvs(); });

test("signed out: the page sends the visitor to sign in and come back, and reads nothing else", async () => {
  auth.getUser.mockResolvedValue(null);
  await expect(SettingsPage({})).rejects.toThrow("NEXT_REDIRECT /sign-in?returnTo=%2Fsettings");
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("six sections in order, each with an anchor in the page's nav", async () => {
  const html = await render();
  const at = SECTIONS.map((id) => html.indexOf(`<section id="${id}"`));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(html.match(/<a href="#[a-z-]+" class="text-fg-2 hover:text-accent">[^<]+<\/a>/g)).toEqual([
    '<a href="#profile" class="text-fg-2 hover:text-accent">Profile</a>',
    '<a href="#characters" class="text-fg-2 hover:text-accent">Characters &amp; sync</a>',
    '<a href="#privacy" class="text-fg-2 hover:text-accent">Privacy</a>',
    '<a href="#integrations" class="text-fg-2 hover:text-accent">Integrations</a>',
    '<a href="#keys" class="text-fg-2 hover:text-accent">API keys</a>',
    '<a href="#danger" class="text-fg-2 hover:text-accent">Danger zone</a>',
  ]);
  expect(html).toContain('aria-label="Settings sections"');
});

test("every anchor an old /account or /settings link used is still on the page, so the redirect lands in the right place", async () => {
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  const html = await render();
  for (const id of ["overview", "profile", "status", "characters", "linked-characters", "integrations", "sign-in-methods", "keys", "chat-keys", "data"]) {
    expect(html, id).toContain(`id="${id}"`);
  }
});

test("Profile: the overview, the profile form and the status, with the handle in the header", async () => {
  const profile = section(await render(), "profile");
  expect(profile).toContain("BattleTag</dt><dd");
  expect(profile).toContain("Thrall#1234");
  expect(profile).toContain("October 3, 2026");
  expect(profile).toMatch(/Characters<\/dt><dd[^>]*>2<\/dd>/);
  expect(profile).toMatch(/Saved builds<\/dt><dd[^>]*><a href="\/me"[^>]*>3<\/a>/);
  expect(profile).toMatch(/API keys<\/dt><dd[^>]*><a href="#keys"[^>]*>2 of 5<\/a>/);
  expect(profile).toMatch(/Requests, last 7 days<\/dt><dd[^>]*>1,234<\/dd>/);
  expect(profile).toMatch(/name="handle"[^>]*value="thrall"/);
  expect(profile).toMatch(/name="publicProfile"[^>]*checked/);
  expect(profile).toContain('href="/u/thrall"');
  expect(profile).toMatch(/<h3 id="status"[^>]*>Status<\/h3>/);
  expect(profile).toMatch(/name="emoji"[^>]*value="🔥"/);
  expect(profile).toContain("Only you see your account name.");
  expect(await render()).toContain("@thrall");
});

test("before a profile is saved: the defaults, private and with no handle", async () => {
  profileRow = null;
  const html = await render();
  expect(html).toContain("No handle yet");
  expect(html).not.toMatch(/name="publicProfile"[^>]*checked/);
  expect(html).toMatch(/name="showCharacters"[^>]*checked/);
  expect(html).toContain('<option value="never" selected="">Never</option>');
  expect(html).not.toContain('href="/u/');
});

test("Characters & sync: the characters with the main marked, sync, and what lives only in this browser, labelled so", async () => {
  const characters = section(await render(), "characters");
  expect(characters).toMatch(/text-class-warrior">Thrall<\/a><span data-badge="neutral"[^>]*>Main</);
  expect(characters).toContain('aria-label="Make Jaina your main"');
  expect(characters).toContain('href="/upload"');
  expect(characters).toContain('href="#integrations"');
  expect(characters).toMatch(/<h3[^>]*>On this browser only<\/h3><p[^>]*>Kept in this browser, not in your account\./);
  expect(characters).toContain('<a href="/tools/builds"');
  expect(characters).toContain('<a href="/tools/alts"');
  // A label's note is not shown.
  expect(characters).not.toContain(">alt<");
});

test("character links on: Linked characters sits in Characters & sync, and Privacy and Danger zone say what is kept and where to unlink", async () => {
  expect(await render()).not.toContain('id="linked-characters"');
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  const html = await render();
  expect(section(html, "characters")).toMatch(/<div id="linked-characters"[^>]*><h3[^>]*>Linked characters<\/h3>/);
  expect(section(html, "privacy")).toContain("the characters you linked");
  expect(section(html, "danger")).toContain('Unlink a character in <a href="#linked-characters"');
});

test("every PROFILES and SAVED_BUILDS combination: the page opens, and the profile form and characters show only while profiles are on", async () => {
  for (const [profiles, savedBuilds] of [["0", "0"], ["0", "1"], ["1", "0"], ["1", "1"]]) {
    vi.stubEnv("EVERLOOT_PROFILES", profiles);
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", savedBuilds);
    const html = await render();
    for (const field of ["handle", "displayName", "publicProfile", "showCharacters", "showBuilds", "showStatus", "emoji", "text", "clearAfter"]) {
      expect(html.includes(`name="${field}"`), `${profiles}/${savedBuilds} ${field}`).toBe(profiles === "1");
    }
    expect(html.includes('aria-label="Make Jaina your main"')).toBe(profiles === "1");
    expect(/href="\/me(?:"|\/)/.test(html), `${profiles}/${savedBuilds} /me`).toBe(savedBuilds === "1");
    for (const id of SECTIONS) expect(html, `${profiles}/${savedBuilds} ${id}`).toContain(`<section id="${id}"`);
    expect(html).not.toContain(USER.id);
  }
});

test("switches off: rows behind them are left out quietly and their tables are never read", async () => {
  switches(false);
  const html = await render();
  for (const label of ["Handle", "Public profile", "Main character", "Characters", "Saved builds", "API keys", "Requests, last 7 days"]) {
    expect(html).not.toContain(`>${label}</dt>`);
  }
  expect(html).not.toContain('href="/players/opt-out"');
  expect(section(html, "privacy")).toContain("Everloot keeps your sign-in details.");
  const read = auth.authQuery.mock.calls.map(([path]) => path as string);
  expect(read).toEqual([`users?select=created_at&id=eq.${USER.id}&limit=1`]);
});

test("Privacy: what is kept, the key's last use among it, that it shows only to its owner, and the policy", async () => {
  const privacy = section(await render(), "privacy");
  expect(privacy).toContain("Everloot keeps your sign-in details, your API keys, with when each was last used and a daily count of their requests, your saved builds and characters, and your profile.");
  expect(privacy).toContain("A key&#x27;s last use is shown only to you. Everloot keeps no record of which app used the key or what it asked.");
  expect(privacy).toContain("Plans and alts on this device, and chat keys, stay in your browser.");
  expect(privacy).toContain('href="/privacy"');
  expect(privacy).toContain('href="/players/opt-out"');
  expect(privacy).toContain('href="#profile"');
});

test("Integrations: live keys are Connected with Disconnect; a revoked key is gone; Claude and ChatGPT are Not tracked", async () => {
  const integrations = section(await render(), "integrations");
  expect(integrations).toContain("Desktop App key");
  expect(integrations).toContain("Drop-rate script");
  expect(integrations).not.toContain("evl_…ef01");
  expect(integrations.match(/<button[^>]*>Disconnect<\/button>/g)).toHaveLength(2);
  expect(integrations).toContain('aria-label="Disconnect Drop-rate script (evl_…c0de)"');
  expect(integrations.match(/data-status="off"[^>]*><span[^>]*><\/span>Not tracked/g)).toHaveLength(2);
  expect(integrations).toMatch(/Battle\.net.*Connected · Thrall#1234/);
});

test("a social link that failed comes back with linkError=1 and says why", async () => {
  expect(await render()).not.toContain("That login could not be linked.");
  expect(section(await render({ linkError: "1" }), "integrations")).toContain("That login could not be linked.");
});

test("API keys holds the key list and Assistant setup, the chat's setup target, labelled as kept in this tab", async () => {
  const keys = section(await render(), "keys");
  expect(keys).toContain("api keys");
  expect(keys).toMatch(/<div id="chat-keys"[^>]*><h3 id="chat-keys-heading"[^>]*>Assistant setup <span[^>]*>· this tab only<\/span><\/h3>/);
  expect(keys).toContain("Everloot&#x27;s servers never receive them");
});

test("Danger zone: deletion is by email, as the privacy policy says; there is no self-serve delete or export", async () => {
  const danger = section(await render(), "danger");
  expect(danger).toContain('href="mailto:hello@everloot.app"');
  expect(danger).toContain('href="#keys"');
  expect(danger).toContain('href="/me"');
  expect(danger).not.toMatch(/download my data|export/i);
});

test("every read is the signed-in owner's: by user id, and usage only for the owner's keys", async () => {
  await render();
  const read = auth.authQuery.mock.calls.map(([path]) => path as string);
  expect(read.length).toBeGreaterThan(4);
  for (const path of read) {
    if (path.startsWith("api_key_usage?")) expect(path).toMatch(new RegExp(`key_id=in\\.\\(${KEY_A},${KEY_B},${KEY_C}\\)&day=gte\\.\\d{4}-\\d{2}-\\d{2}$`));
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

test("storage trouble: each part says it is unavailable and the rest of the page still works", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  const html = await render();
  expect(html).toContain("Thrall#1234");
  expect(html).toContain("Some details are unavailable right now.");
  expect(html).toContain("Your profile is unavailable right now.");
  expect(html).not.toContain("Member since");
  expect(html).toContain("Your keys could not be read right now");
  for (const id of SECTIONS) expect(html).toContain(`<section id="${id}"`);
  expect(html).toContain('id="chat-keys"');
});

test("the sign-in itself failing says so instead of failing the page", async () => {
  auth.getUser.mockRejectedValue(new Error("down"));
  expect(await render()).toContain("Your settings are unavailable right now.");
});
