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
const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import SettingsPage from "./page";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const JAINA = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const THRALL = "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33";
let profileRow: object | null;

beforeEach(() => {
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  profileRow = { handle: "thrall", display_name: null, status_emoji: "🔥", status_text: "Raiding", status_clears_at: "2099-01-01T00:00:00+00:00",
    public_profile: true, show_characters: true, show_builds: false, show_status: true, main_character_id: THRALL, active_character_id: null };
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("user_profiles")) return profileRow ? [profileRow] : [];
    return [{ id: JAINA, name: "Jaina", class_slug: "mage", realm: "Pioneer", note: "alt" }, { id: THRALL, name: "Thrall", class_slug: "warrior", realm: null, note: null }];
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

test("off: a 404 and nothing is read; signed out: sign in and come back", async () => {
  vi.stubEnv("EVERLOOT_PROFILES", "0");
  await expect(SettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  expect(auth.getUser).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  auth.getUser.mockResolvedValue(null);
  await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT /sign-in?returnTo=%2Fsettings");
});

test("profile, status, characters with the main marked, and the links to keys and the Desktop App", async () => {
  const html = renderToStaticMarkup(await SettingsPage());
  expect(html).toContain("@thrall");
  expect(html).toMatch(/name="handle"[^>]*value="thrall"/);
  expect(html).toMatch(/placeholder="Thrall"[^>]*name="displayName" value=""/);
  expect(html).toMatch(/name="publicProfile"[^>]*checked/);
  expect(html).not.toMatch(/name="showBuilds"[^>]*checked/);
  expect(html).toContain('href="/u/thrall"');
  expect(html).toMatch(/name="emoji"[^>]*value="🔥"/);
  expect(html).toMatch(/name="text"[^>]*value="Raiding"/);
  for (const label of ["30 minutes", "4 hours", "Today", "This week", "Never"]) expect(html).toContain(`>${label}</option>`);
  // Editing a status that clears later keeps that time unless the player picks another.
  expect(html).toContain('<option value="keep" selected="">Keep current</option>');
  expect(html).toContain("Clear status");
  expect(html).toMatch(/text-class-warrior">Thrall<\/a><span data-badge="neutral"[^>]*>Main</);
  expect(html).toContain('aria-label="Make Jaina your main"');
  expect(html).toContain('aria-label="Unset Thrall as main"');
  expect(html).toContain('href="/me"');
  // The section nav lists the four sections in page order.
  expect(html).toMatch(/<nav aria-label="Settings sections"[^>]*>(<a href="#(profile|status|characters|more)"[^>]*>[^<]+<\/a>){4}<\/nav>/);
  expect(html.match(/<a href="#(profile|status|characters|more)"/g)).toEqual(['<a href="#profile"', '<a href="#status"', '<a href="#characters"', '<a href="#more"']);
  // Settings points back at the account overview, which is where data and privacy live.
  expect(html).toContain('href="/account"');
  expect(html).toContain("overview, data and privacy");
  expect(html).toContain('href="/account#keys"');
  expect(html).toContain('href="/addon"');
  // Chat keys live on /account; Settings only links there.
  expect(html).toContain('href="/account#chat-keys"');
  expect(html).not.toContain('id="chat-keys"');
  // The account name stays off the page except as the display name's placeholder; a label's note is not shown.
  expect(html).not.toContain("Thrall#1234");
  expect(html).not.toContain(">alt<");
});

test("before anything is saved: the defaults, private and with no handle", async () => {
  profileRow = null;
  const html = renderToStaticMarkup(await SettingsPage());
  expect(html).toContain("No handle yet");
  expect(html).not.toMatch(/name="publicProfile"[^>]*checked/);
  expect(html).toMatch(/name="showCharacters"[^>]*checked/);
  expect(html).not.toContain("Clear status");
  expect(html).not.toContain("Keep current");
  expect(html).toContain('<option value="never" selected="">Never</option>');
  expect(html).not.toContain('href="/u/');
});

test("storage trouble says so instead of failing the page", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect(renderToStaticMarkup(await SettingsPage())).toContain("unavailable right now");
});
