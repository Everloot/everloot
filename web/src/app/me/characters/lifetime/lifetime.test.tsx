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

test("with private sync off the page reads no synced facts and shows no gold", async () => {
  const html = await render();
  expect(auth.authQuery.mock.calls.map((c) => c[0])).not.toContain("rpc/own_character_facts");
  expect(html).not.toContain("Total gold acquired");
  expect(html).not.toContain("Not reported");
});

test("with private sync on, the addon's gold joins each of the account's own characters; most ever owned is one character's", async () => {
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
  const links = [...OWN, { link_id: "4d8f3e3f-5f65-4c6f-9c73-5f4c3f2e1f44", region: "eu", slug: "orla-fenwick" }];
  const gold: Record<string, Record<string, number>> = {
    [OWN[0]!.link_id]: { "328": 1_150_905, "334": 2_000_000 },
    [OWN[1]!.link_id]: { "328": 50, "334": 30 },
  };
  auth.authQuery.mockImplementation(async (path: string, init: { body: string }) => {
    if (path === "rpc/armory_own_links") return links;
    if (path === "rpc/own_character_facts") {
      const stats = gold[JSON.parse(init.body).p_link_id];
      return [
        { category: "raids", consented: false, captured_at: null, data: null },
        stats ? { category: "gold", consented: true, captured_at: at, data: { stats } } : { category: "gold", consented: false, captured_at: null, data: null },
      ];
    }
    throw new Error(`unexpected ${path}`);
  });
  const html = await render();
  const reads = auth.authQuery.mock.calls.filter((c) => c[0] === "rpc/own_character_facts").map((c) => JSON.parse(c[1].body));
  // Only the signed-in account's own links, each read as that account.
  expect(reads).toEqual(expect.arrayContaining(links.map((l) => ({ p_user_id: USER.id, p_link_id: l.link_id }))));
  expect(reads).toHaveLength(links.length);
  for (const text of ["Total gold acquired", "Most gold ever owned (one character)", "from your addon"]) expect(html, text).toContain(text);
  // 1,150,905 + 50 copper; the most ever owned total is the largest, not the sum.
  expect(html).toContain("115 gold 9 silver 55 copper");
  expect(html).toContain("200 gold 0 silver 0 copper");
  expect(html).not.toContain("200 gold 0 silver 30 copper");
  // Orla has no gold fact: "Not reported", never 0.
  expect(html.match(/Not reported/g)).toHaveLength(2);
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
