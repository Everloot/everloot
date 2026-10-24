import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, "aria-current": current }: { href: string; children: ReactNode; "aria-current"?: "page" }) => <a href={href} aria-current={current}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/EmailCapture", () => ({ default: () => null }));

import FarmingPage, { generateMetadata } from "./page";

let n = 0;
const base = (installId: string) => ({ installId, eventId: `e${n++}`, capturedAt: "2026-10-10T00:00:00.000Z" });
const three = ["a", "b", "c"];
const sight = (npcId: number, name: string, level: number, mapId: number) =>
  three.map((i) => ({ ...base(i), kind: "npc_sighting", positionKind: "npc", npcId, name, mapId, x: 40, y: 60, level, reaction: "hostile" }));
const loot = (npcId: number, itemId: number) =>
  three.map((i) => ({ ...base(i), kind: "loot", sourceEvidence: "loot-api", sourceNpcId: npcId, items: [{ itemId, count: 1 }] }));
// Elwynn Forest (1429): Hogger, level 11, drops a non-trade item; a level 15 mob drops Linen Cloth (2589).
// Durotar (1411): a level 5 mob drops Light Leather (2318). Nothing places herbs, ore or reputation.
const records = [
  ...sight(448, "Hogger", 11, 1429), ...loot(448, 1931),
  ...sight(500, "Defias Bandit", 15, 1429), ...loot(500, 2589),
  ...sight(600, "Mottled Boar", 5, 1411), ...loot(600, 2318),
];

const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);
const search = (s: Record<string, string> = {}) => ({ searchParams: Promise.resolve(s) });
/** One category's section of the page. */
const section = (page: string, slug: string) => {
  const at = page.indexOf(`data-farm="${slug}"`);
  return at < 0 ? null : page.slice(at, page.indexOf("</section>", at));
};
/** The one empty state the unbacked categories share, with the slugs it stands for. */
const shared = (page: string) => {
  const m = page.match(/data-farm-empty="([^"]*)"/);
  if (!m) return null;
  const at = page.indexOf(m[0]);
  return { slugs: m[1].split(" "), html: page.slice(at, page.indexOf("</section>", at)) };
};
const zonesIn = (part: string | null) => [...(part ?? "").matchAll(/href="\/database\/zones\/(\d+)-/g)].map((m) => Number(m[1]));

beforeEach(() => store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: `2026-10-10T00:00:${String(n++ % 60).padStart(2, "0")}.000Z` }));

test("each category lists the zones its mobs back, with levels, the zone page and the map", async () => {
  const page = await html(FarmingPage(search()));
  expect(zonesIn(section(page, "gold"))).toEqual([1411, 1429]);
  expect(section(page, "gold")).toContain("11–15");
  expect(section(page, "gold")).toContain('href="/map?zone=1429"');
  expect(zonesIn(section(page, "cloth"))).toEqual([1429]);
  expect(section(page, "cloth")).toContain(">15<");
  expect(zonesIn(section(page, "leather"))).toEqual([1411]);
  expect(section(page, "dungeons")).toContain("Shadowfang Keep");
});

test("the categories are tabs with their counts, like the auction houses", async () => {
  const page = await html(FarmingPage(search({ category: "cloth" })));
  const tabs = page.slice(page.indexOf("data-link-tabs"), page.indexOf("</nav>"));
  expect(tabs).toContain('href="/tools/farming-routes"');
  expect(tabs).toMatch(/href="\/tools\/farming-routes\?category=cloth"[^>]*aria-current="page"/);
  expect(tabs).toContain('href="/tools/farming-routes?category=dungeons"');
  // The tab counts: 2 gold zones, 1 cloth, 1 leather, 0 herbs, and the dungeons from the game files.
  expect(tabs).toContain("Gold<span class=\"ml-1 tabular-nums text-muted\"> (2)</span>");
  expect(tabs).toContain("Herbs<span class=\"ml-1 tabular-nums text-muted\"> (0)</span>");
});

test("categories with nothing behind them share one empty state with the meter, and invent nothing", async () => {
  const page = await html(FarmingPage(search()));
  for (const slug of ["herbs", "ore", "reputation"]) expect(section(page, slug)).toBeNull();
  const empty = shared(page)!;
  expect(empty.slugs).toEqual(["herbs", "ore", "reputation"]);
  expect(empty.html).toContain("data-empty-state");
  expect(empty.html).toContain('aria-label="0 of 3 installs agree"');
  expect(empty.html).toContain("No herbs, ore and reputation areas yet: a zone shows once 3 players upload loot from the same mobs there.");
  expect(empty.html).toContain('href="/addon"');
  expect(empty.html).not.toContain("<table");

  // Shown alone, an unbacked category gets the same empty state under its own heading.
  const herbs = await html(FarmingPage(search({ category: "herbs" })));
  expect(section(herbs, "herbs")).toContain("No herbs areas yet");
  expect(section(herbs, "herbs")).toContain("data-empty-state");
  expect(shared(herbs)).toBeNull();

  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null });
  const none = await html(FarmingPage(search()));
  expect(shared(none)!.slugs).toEqual(["gold", "herbs", "ore", "leather", "cloth", "reputation"]);
  expect(none).toContain("No gold, herbs, ore, skins and leather, cloth and reputation areas yet");
  // The dungeons are in the game files, so they stay.
  expect(section(none, "dungeons")).toContain("Shadowfang Keep");
});

test("storage down: the mob lists read as unread, not empty", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null, unreachable: true });
  const page = await html(FarmingPage(search()));
  expect(shared(page)!.html).toContain("unreachable");
  expect(page).not.toContain("areas yet");
  expect(section(page, "dungeons")).toContain("Shadowfang Keep");
  const gold = await html(FarmingPage(search({ category: "gold" })));
  expect(section(gold, "gold")).toContain("unreachable");
});

test("the page carries the same contribute card and questions as the auction house", async () => {
  const page = await html(FarmingPage(search()));
  expect(page).toMatch(/<section[^>]*aria-labelledby="farm-contribute"/);
  expect(page).toContain("Add your farming areas");
  expect(page).toContain('href="/addon#desktop"');
  expect(page).toContain("Where do these areas come from?");
  expect(page).toContain("Why are herbs, ore and reputation empty?");
});

test("the category and level filters live in the URL", async () => {
  const cloth = await html(FarmingPage(search({ category: "cloth" })));
  expect(section(cloth, "cloth")).not.toBeNull();
  expect(section(cloth, "gold")).toBeNull();
  expect(section(cloth, "dungeons")).toBeNull();

  // Levels overlap the range; an area with no agreed level is out of every range.
  const low = await html(FarmingPage(search({ level: "1-10" })));
  expect(zonesIn(section(low, "gold"))).toEqual([1411]);
  expect(section(low, "cloth")).toContain("Nothing here for levels 1-10.");
  expect(section(low, "dungeons")).toContain("Nothing here for levels 1-10.");
  expect(shared(low)!.slugs).toEqual(["herbs", "ore", "reputation"]);
  expect(zonesIn(section(await html(FarmingPage(search({ level: "12-20" }))), "gold"))).toEqual([1429]);

  const both = await html(FarmingPage(search({ category: "gold", level: "11-20" })));
  expect(zonesIn(section(both, "gold"))).toEqual([1429]);
  // The tabs and the level menu keep the other filter, and the bar offers a way back to any level.
  expect(both).toContain('href="/tools/farming-routes?category=cloth&amp;level=11-20"');
  expect(both).toContain('href="/tools/farming-routes?category=gold&amp;level=1-10"');
  expect(both).toContain('href="/tools/farming-routes?category=gold"');

  for (const bad of [{ category: "fish" }, { level: "20-10" }, { level: "x" }] as Record<string, string>[]) {
    await expect(html(FarmingPage(search(bad))), JSON.stringify(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  }
});

test("only the plain page is indexed", async () => {
  expect((await generateMetadata(search())).robots).toBeUndefined();
  expect((await generateMetadata(search({ category: "gold" }))).robots).toEqual({ index: false, follow: true });
  expect((await generateMetadata(search({ level: "1-10" }))).robots).toEqual({ index: false, follow: true });
});
