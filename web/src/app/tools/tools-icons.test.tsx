import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

// An upload that has every kind of icon the cards draw from: class, profession, faction, map legend and currency icons.
vi.mock("@/lib/game-assets", async (orig) => {
  const real = await orig<typeof import("@/lib/game-assets")>();
  const icon = (key: string) => `https://a.test/icons/${encodeURIComponent(key)}.webp`;
  const classes = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
  return {
    ...real,
    loadSiteAssets: async () => ({ currencyIcons: new Map([515, 3402, 3468, 3469].map((id) => [id, icon(`currency-${id}`)])) }) as never,
    classAndProfessionIcons: () => ({
      classes: classes.map((key) => ({ key, name: key, icon: icon(key) })),
      professions: real.PROFESSIONS.map((key) => ({ key, name: key, icon: icon(key) })),
    }),
    emblems: () => ({ races: new Map(), factions: new Map([["Alliance", icon("alliance")], ["Horde", icon("horde")]]) }),
    poiIcons: () => Object.fromEntries(["flight", "dungeon", "raid", "service", "trainer", "quest", "chest"].map((k) => [k, icon(`poi-${k}`)])),
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/tools" }));

afterEach(() => vi.unstubAllEnvs());

const cards = (html: string) => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);

test.each([["off", ""], ["on", "1"]])("with the guild switch %s, every tool card has a game icon and none a letter placeholder", async (_, guilds) => {
  vi.stubEnv("EVERLOOT_GUILDS", guilds);
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  const all = cards(html);
  expect(all.length).toBeGreaterThan(10);
  for (const card of all) {
    const name = /<a [^>]*>([^<]+)<\/a>/.exec(card)?.[1];
    expect(card, name).toContain("data-game-icon");
  }
  // Each tool its own picture, so the cards are told apart at a glance.
  const srcs = all.map((c) => /src="([^"]+)"/.exec(c)?.[1]);
  expect(new Set(srcs).size).toBe(srcs.length);
});
