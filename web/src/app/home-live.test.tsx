import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { HomeFact, HomeLadder, HomeWeek } from "@/lib/home-live";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const live = vi.hoisted(() => ({
  newest: null as HomeFact[] | null,
  ladder: null as HomeLadder | null | undefined,
  week: null as HomeWeek | null,
}));
vi.mock("@/lib/home-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/home-live")>()),
  loadHomeNewest: async () => live.newest,
  loadHomeLadder: async () => live.ladder,
  loadHomeWeek: async () => live.week,
}));

import Home from "./page";
import { LADDER_LINE, START_LINE } from "@/lib/guilds";
import { COLLECTING_LINE, RANKINGS } from "@/lib/rankings";

const NEWEST: HomeFact[] = [
  { kind: "item", id: 12587, name: "Eye of Rend", path: "/database/items/12587", publicAt: "2026-11-25T18:00:00.000Z", icon: "https://assets.test/icons/133146.webp", quality: "rare" },
  { kind: "npc", id: 448, name: "Hogger", path: "/database/npcs/448", publicAt: "2026-11-24T10:00:00.000Z" },
  { kind: "item", id: 2589, name: "Linen Cloth", path: "/database/items/2589", publicAt: "2026-11-23T10:00:00.000Z", estimated: true },
];
const LADDER: HomeLadder = {
  instance: { name: "The Deadmines", raid: false },
  rows: [
    { key: "a", rank: 1, guildName: "Merthy", realm: "Nightslayer", faction: "horde", killed: 8, bosses: 8 },
    { key: "b", rank: 2, guildName: "Second Wind", realm: "Doomhowl", faction: "alliance", killed: 6, bosses: 8 },
  ],
  total: 14,
  raidsOpen: false,
};
const WEEK: HomeWeek = {
  week: { start: "2026-11-23", current: true },
  classes: [
    { key: "WARRIOR", label: "Warrior", classToken: "WARRIOR", share: 0.25 },
    { key: "MAGE", label: "Mage", classToken: "MAGE", share: 0.15 },
  ],
  classHidden: true,
  movers: [{ def: RANKINGS[0], row: { key: "MAGE", label: "Mage", classToken: "MAGE", count: 30, share: 0.15, rank: 2, change: { dir: "up", by: 3 } }, href: "/census?class=MAGE" }],
};

beforeEach(() => {
  live.newest = NEWEST;
  live.ladder = LADDER;
  live.week = WEEK;
});

const render = async () => renderToStaticMarkup(await Home());
const panel = (html: string, id: string) => {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};

test("the live panels come right after the hero, before Start here", async () => {
  const html = await render();
  for (const id of ["live-newest", "live-ladder", "live-week"]) {
    expect(html.indexOf(`aria-labelledby="${id}"`), id).toBeGreaterThan(html.indexOf('id="hero-title"'));
    expect(html.indexOf(`aria-labelledby="${id}"`), id).toBeLessThan(html.indexOf('aria-labelledby="start-here"'));
  }
});

test("newly confirmed lists the newest facts with their link, date, and an item's icon and quality colour", async () => {
  const block = panel(await render(), "live-newest");
  expect(block).toContain("Newly confirmed");
  expect(block).toMatch(/<a href="\/database\/items\/12587" class="[^"]*text-q-rare[^"]*">Eye of Rend<\/a>/);
  expect(block).toMatch(/<img src="https:\/\/assets\.test\/icons\/133146\.webp"[^>]*border-q-rare/);
  expect(block).toContain('href="/database/npcs/448"');
  expect(block).toContain("NPC");
  expect(block).toContain('dateTime="2026-11-25T18:00:00.000Z"');
  // An item without an icon from the files keeps its name, as a plain link.
  expect(block).toContain(">Linen Cloth</a>");
  expect(block).toContain('href="/database/recent"');
});

test("the guild ladder shows the newest ladder's top rows, linked to each guild", async () => {
  const block = panel(await render(), "live-ladder");
  expect(block).toContain("Guild ladder");
  expect(block).toContain("The Deadmines");
  expect(block).toContain('href="/guilds/nightslayer/merthy"');
  expect(block).toContain(">8/8<");
  expect(block).toContain('href="/guilds"');
});

test("before anyone has an agreed kill, the ladder says when ladders start; once raids open, what starts them", async () => {
  live.ladder = { instance: null, rows: [], total: 0, raidsOpen: false };
  expect(panel(await render(), "live-ladder")).toContain(LADDER_LINE);
  live.ladder = { instance: null, rows: [], total: 0, raidsOpen: true };
  expect(panel(await render(), "live-ladder")).toContain(START_LINE);
});

test("with the guild pages off, there is no ladder panel at all", async () => {
  live.ladder = undefined;
  const html = await render();
  expect(html).not.toContain('aria-labelledby="live-ladder"');
  expect(html).toContain('aria-labelledby="live-newest"');
  expect(html).toContain('aria-labelledby="live-week"');
});

test("this week draws the class shares as one stacked bar, lists them, and names the top movers", async () => {
  const block = panel(await render(), "live-week");
  expect(block).toContain("This week");
  expect(block).toMatch(/class="[^"]*bg-class-warrior[^"]*" style="width:25%"/);
  expect(block).toMatch(/class="[^"]*bg-class-mage[^"]*" style="width:15%"/);
  expect(block).toContain("Warrior");
  expect(block).toContain("25%");
  expect(block).toContain('href="/census?class=MAGE"');
  expect(block).toContain('href="/rankings"');
});

test("a week still under the census thresholds says so instead of drawing a bar", async () => {
  live.week = { week: { start: "2026-11-23", current: true }, classes: [], classHidden: true, movers: null };
  const block = panel(await render(), "live-week");
  expect(block).toContain(COLLECTING_LINE);
  expect(block).not.toMatch(/bg-class-/);
});

test.each(["newest", "ladder", "week"] as const)("when the %s read fails, only that panel says so; the others still show", async (which) => {
  live[which] = null;
  const html = await render();
  const blocks = { newest: panel(html, "live-newest"), ladder: panel(html, "live-ladder"), week: panel(html, "live-week") };
  expect(blocks[which]).toContain("could not be read just now");
  for (const other of (["newest", "ladder", "week"] as const).filter((k) => k !== which)) {
    expect(blocks[other], other).not.toContain("could not be read just now");
  }
  if (which !== "newest") expect(blocks.newest).toContain("Eye of Rend");
  if (which !== "ladder") expect(blocks.ladder).toContain("Merthy");
  if (which !== "week") expect(blocks.week).toContain("bg-class-warrior");
});

test("the live panels link no armory page: the landing page carries an ad slot", async () => {
  const html = await render();
  const live = ["live-newest", "live-ladder", "live-week"].map((id) => panel(html, id)).join("");
  expect(live).not.toMatch(/href="\/(armory|characters|players|blizzard-auctions)/);
});
