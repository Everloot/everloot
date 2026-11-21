import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import adFree from "@/data/ad-free-paths.json";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
}));
const armory = vi.hoisted(() => ({ character: vi.fn() }));
vi.mock("@/lib/armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/armory-store")>()), armoryStore: () => ({ character: armory.character }) }));

import { armoryCharacter } from "@/lib/armory.fixture";
import Page, { dynamic, metadata } from "./page";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const at = "2026-11-20T08:00:00.000Z";
const OWN = [
  { link_id: "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22", region: "eu", slug: "velkara-duskmantle" },
  { link_id: "3c7f2d2f-4f54-4b5f-8b62-4e3b2f1d0f33", region: "eu", slug: "torvin-ashbrook" },
];
const render = async () => renderToStaticMarkup(await Page());

beforeEach(() => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/armory_own_links") return OWN;
    throw new Error(`unexpected ${path}`);
  });
  armory.character.mockReset().mockImplementation(async (_region: string, slug: string) => slug === "velkara-duskmantle"
    ? armoryCharacter({ details: { revision: 1, playHistory: { asOf: at, groups: [], ranked: { quests: 791, fish: 1993 } } } })
    : armoryCharacter({ slug, name: "Torvin", surname: "Ashbrook", details: { revision: 1, playHistory: { asOf: at, groups: [], ranked: { quests: 100 } } } }));
});
afterEach(() => { vi.unstubAllEnvs(); });

test("the summary is the signed-in account's own characters, one row each and a total", async () => {
  const html = await render();
  expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).toEqual({ p_user_id: USER.id });
  expect(armory.character.mock.calls).toEqual([["eu", "velkara-duskmantle"], ["eu", "torvin-ashbrook"]]);
  for (const text of ["Velkara Duskmantle", "Torvin Ashbrook", "891", "1,993", "2 of 2 characters read", "Data from Blizzard Entertainment"]) expect(html, text).toContain(text);
  expect(html).toContain('href="/armory/eu/velkara-duskmantle"');
});

test("signed out goes to sign-in; with the armory or links off there is no page", async () => {
  auth.getUser.mockResolvedValue(null);
  await expect(render()).rejects.toThrow("NEXT_REDIRECT");
  expect(auth.authQuery).not.toHaveBeenCalled();
  auth.getUser.mockResolvedValue(USER);
  vi.stubEnv("EVERLOOT_ARMORY", "");
  await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "");
  await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
});

test("an account with no armory character says so; a failed read says it could not be read", async () => {
  auth.authQuery.mockResolvedValue([]);
  expect(await render()).toContain("None of your linked characters is connected to an armory character yet.");
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect(await render()).toContain("could not be read");
});

test("drawn per request, never indexed, and free of ads", () => {
  expect(dynamic).toBe("force-dynamic");
  expect(metadata.robots).toEqual({ index: false, follow: false });
  expect(adFree).toContain("/me/characters/lifetime");
});
