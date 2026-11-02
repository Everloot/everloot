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
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
}));
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
// Durotar (1411): a level 5 mob drops Light Leather (2318). Nothing places reputation.
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
const zonesIn = (part: string | null) => [...(part ?? "").matchAll(/href="\/database\/zones\/(\d+)-/g)].map((m) => Number(m[1]));

beforeEach(() => store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: `2026-10-10T00:00:${String(n++ % 60).padStart(2, "0")}.000Z` }));

test("gold lists the zones its mobs back, with levels, the zone page and the map; reputation says why it is empty", async () => {
  const page = await html(FarmingPage(search()));
  expect(zonesIn(section(page, "gold"))).toEqual([1411, 1429]);
  expect(section(page, "gold")).toContain("11–15");
  expect(section(page, "gold")).toContain('href="/map?zone=1429"');
  expect(section(page, "reputation")).toContain("does not yet place in a zone");
  expect(section(page, "reputation")).not.toContain("<table");
  // Gathering and dungeons are not tabs here any more.
  for (const slug of ["herbs", "ore", "leather", "cloth", "dungeons"]) expect(section(page, slug)).toBeNull();
});

test("the tabs are gold and reputation with their counts, like the auction houses", async () => {
  const page = await html(FarmingPage(search({ category: "gold" })));
  const tabs = page.slice(page.indexOf("data-link-tabs"), page.indexOf("</nav>"));
  expect(tabs).toContain('href="/tools/farming-routes"');
  expect(tabs).toMatch(/href="\/tools\/farming-routes\?category=gold"[^>]*aria-current="page"/);
  expect(tabs).toContain("Gold<span class=\"ml-1 tabular-nums text-muted\"> (2)</span>");
  expect(tabs).toContain("Reputation<span class=\"ml-1 tabular-nums text-muted\"> (0)</span>");
  expect(tabs).not.toContain("category=herbs");
});

test("the old tabs' links go to where each now lives", async () => {
  const to = {
    herbs: "/tools/professions/herbalism#gather", ore: "/tools/professions/mining#gather", leather: "/tools/professions/skinning#gather",
    cloth: "/tools/professions/tailoring#gather", dungeons: "/database/instances",
  };
  for (const [category, href] of Object.entries(to)) {
    await expect(html(FarmingPage(search({ category, level: "1-10" }))), category).rejects.toThrow(`NEXT_REDIRECT ${href}`);
  }
  // And the page points there too.
  const page = await html(FarmingPage(search()));
  for (const href of Object.values(to)) expect(page).toContain(`href="${href}"`);
});

test("with no uploads gold shows the empty state with the meter, and invents nothing", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null });
  const none = await html(FarmingPage(search()));
  expect(section(none, "gold")).toContain("data-empty-state");
  expect(section(none, "gold")).toContain("No gold areas yet: a zone shows once 3 players upload loot from the same mobs there.");
  expect(section(none, "gold")).toContain('aria-label="0 of 3 installs agree"');
  expect(section(none, "gold")).not.toContain("<table");
});

test("storage down: the mob lists read as unread, not empty", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: null, unreachable: true });
  const page = await html(FarmingPage(search()));
  expect(section(page, "gold")).toContain("unreachable");
  expect(page).not.toContain("areas yet");
});

test("the page carries the same contribute card and questions as the auction house", async () => {
  const page = await html(FarmingPage(search()));
  expect(page).toMatch(/<section[^>]*aria-labelledby="farm-contribute"/);
  expect(page).toContain("Add your farming areas");
  expect(page).toContain('href="/addon#desktop"');
  expect(page).toContain("Where do these areas come from?");
  expect(page).toContain("Where did herbs, ore, leather, cloth and dungeons go?");
});

test("the category and level filters live in the URL", async () => {
  const gold = await html(FarmingPage(search({ category: "gold" })));
  expect(section(gold, "gold")).not.toBeNull();
  expect(section(gold, "reputation")).toBeNull();

  // Levels overlap the range; an area with no agreed level is out of every range.
  const low = await html(FarmingPage(search({ level: "1-10" })));
  expect(zonesIn(section(low, "gold"))).toEqual([1411]);
  expect(zonesIn(section(await html(FarmingPage(search({ level: "12-20" }))), "gold"))).toEqual([1429]);
  expect(section(await html(FarmingPage(search({ level: "30-40" }))), "gold")).toContain("Nothing here for levels 30-40.");

  const both = await html(FarmingPage(search({ category: "gold", level: "11-20" })));
  expect(zonesIn(section(both, "gold"))).toEqual([1429]);
  // The tabs and the level menu keep the other filter, and the bar offers a way back to any level.
  expect(both).toContain('href="/tools/farming-routes?category=reputation&amp;level=11-20"');
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
