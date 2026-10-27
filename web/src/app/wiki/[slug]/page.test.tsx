import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadPrivatePathPattern } from "../../../../../kb/src/wiki/data";

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, usePathname: () => "/" }));

// Three installs agree on an item name and an NPC name; the quest has no title anywhere, so it reads "Quest 166".
const agree = <T,>(row: (installId: string) => T) => ["a", "b", "c"].map(row);
const facts = vi.hoisted(() => ({ rates: [] as unknown[], names: [] as unknown[], npcs: [] as unknown[], unreachable: false }));
const world = vi.hoisted(() => ({ npcs: [] as unknown[], quests: [] as unknown[], vendors: [] as unknown[], unreachable: false }));
// Nobody has zoned into a dungeon or reported a boss unless a test says so.
const instances = vi.hoisted(() => ({ entrances: [] as unknown[], encounters: [] as unknown[], sightings: [] as unknown[], unreachable: false, dataAsOf: null as string | null }));
vi.mock("@/lib/rollup-compute", () => ({ loadItemFacts: async () => facts, loadWorldFacts: async () => world, loadInstanceFacts: async () => instances }));
facts.names = agree((installId) => ({ installId, itemId: 2589, name: "Linen Cloth" }));
world.npcs = agree((installId) => ({ installId, npcId: 639, name: "Edwin VanCleef", mapId: 1436, x: 40, y: 70, positionKind: "npc" }));

const FIXTURES = fileURLToPath(new URL("../../../test/wiki", import.meta.url));
beforeEach(() => { vi.stubEnv("WIKI_DIR", FIXTURES); });
afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(instances, { entrances: [], encounters: [], unreachable: false, dataAsOf: null });
});

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const render = async (slug: string) => {
  const { default: WikiArticle } = await import("./page");
  return renderToStaticMarkup(await WikiArticle(params(slug)));
};
/** The markup of one `<section>`, by the id of its heading. */
const section = (html: string, id: string) => new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";

test("a published page that meets the bar is indexed, with a self canonical and a title under 60 characters", async () => {
  const { generateMetadata } = await import("./page");
  const meta = await generateMetadata(params("test-dungeon"));
  expect(meta.title).toBe("Test Dungeon · WoW Forever dungeon");
  expect(String(meta.title).length).toBeLessThan(60);
  expect(meta.description).toBe("A fixture dungeon page, published and written in Everloot's own words, for the page tests.");
  expect(meta.robots).toEqual({ index: true, follow: true });
  expect(meta.alternates?.canonical).toBe("/wiki/test-dungeon");
  expect(meta.openGraph).toMatchObject({ type: "article", url: "/wiki/test-dungeon" });
});

test("a published page is in sitemap.xml, dated by its review; adapted pages and drafts are not", async () => {
  const { default: sitemap } = await import("../../sitemap");
  const entries = new Map((await sitemap()).map((e) => [new URL(e.url).pathname, e]));
  expect(entries.get("/wiki/test-dungeon")?.lastModified).toEqual(new Date("2026-10-27"));
  expect(entries.has("/wiki")).toBe(true);
  expect(entries.has("/wiki/test-zone")).toBe(false);
  expect(entries.has("/wiki/test-draft")).toBe(false);
});

test("only published pages are built, and a draft answers 404 in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { default: WikiArticle, generateMetadata, generateStaticParams } = await import("./page");
  expect(generateStaticParams().map((p) => p.slug).sort()).toEqual(["test-dungeon", "test-lost-raid", "test-new-dungeon", "test-raid", "test-zone"]);
  await expect(WikiArticle(params("test-draft"))).rejects.toThrow("NOT_FOUND");
  await expect(WikiArticle(params("no-such-page"))).rejects.toThrow("NOT_FOUND");
  expect((await generateMetadata(params("test-draft"))).robots).toEqual({ index: false, follow: true });
});

test("an adapted page shows exactly one credit line and stays out of search; an original page shows none", async () => {
  const adapted = await render("test-zone");
  expect(adapted.match(/data-wiki-credit/g)).toHaveLength(1);
  expect(adapted).toMatch(/Adapted from <span><a href="https:\/\/warcraft\.wiki\.gg\/wiki\/Westfall"[^>]*>Westfall<\/a><\/span> by Warcraft Wiki contributors · <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/" rel="license noopener"[^>]*>CC BY-SA 4.0<\/a>/);
  const { generateMetadata } = await import("./page");
  expect((await generateMetadata(params("test-zone"))).robots).toEqual({ index: false, follow: true });

  const original = await render("test-dungeon");
  expect(original).not.toContain("data-wiki-credit");
  expect(original).not.toContain("Adapted from");
  expect(original).not.toContain("CC BY-SA");
});

test("tokens link to their database pages under the name rules, and [[links]] to published pages only", async () => {
  const html = await render("test-dungeon");
  expect(html).toContain('<a href="/database/items/2589" data-wiki-token="item:2589">Linen Cloth</a>');
  expect(html).toContain('<a href="/database/npcs/639" data-wiki-token="npc:639">Edwin VanCleef</a>');
  expect(html).toContain('<a href="/database/quests/166" data-wiki-token="quest:166">Quest 166</a>');
  expect(html).toContain('<a href="/database/zones/1436-westfall" data-wiki-token="zone:1436">Westfall</a>');
  expect(html).toContain('<a href="/wiki/test-zone" data-wiki-link="test-zone">Test Zone</a>');
  expect(html).not.toContain('href="/wiki/test-draft"');
  expect(html).toContain("<span>test draft</span>");
  // Inline Markdown is drawn, and quotes keep their words.
  expect(html).toContain("&quot;a short quote stays a quote&quot;");
});

test("a Markdown link into the wiki is drawn only to a published page; to a draft or a missing page it stays words, in every written form", async () => {
  const html = await render("test-dungeon");
  expect(html).toContain('<a href="/wiki/test-zone#history">the zone page</a> is published');
  expect(html).toContain("while the draft, the draft in full and a page never written stay words.");
  expect(html).not.toMatch(/href="[^"]*(?:test-draft|no-such-page)/);
  // Links that are not wiki pages are drawn as before.
  expect(html).toContain('<a href="https://worldofwarcraft.blizzard.com/en-us/news/1" rel="noopener">Blizzard&#x27;s post</a>');
  expect(html).toContain('<a href="/database/zones/1436-westfall">the zone&#x27;s database page</a>');
});

test("the page shows title, summary, sections in type order, categories and Linked from, with no visible breadcrumb", async () => {
  const html = await render("test-dungeon");
  expect(html).toContain("<h1");
  expect(html).toContain("Test Dungeon");
  expect(html).toContain("A fixture dungeon page, published and written in Everloot&#x27;s own words, for the page tests.");
  const order = ["Overview", "Getting there", "History", "In WoW: Forever", "Before you go"].map((h) => html.indexOf(`>${h}</h2>`));
  expect(order.every((i) => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(html).toContain("Dungeons · Eastern Kingdoms · Westfall");
  // "Linked from": published pages only, collapsed.
  expect(html).toMatch(/<details[^>]*id="linked-from"/);
  expect(html).toContain("Linked from (1)");
  expect(html).toMatch(/<a href="\/wiki\/test-zone"[^>]*>Test Zone<\/a><\/li>/);
  expect(html).not.toContain("Test Draft");
  // No visible trail: the BreadcrumbList is structured data only, beside the Article.
  expect(html).not.toMatch(/<nav[^>]*breadcrumb/i);
  expect(html).not.toMatch(/>Home</);
  expect(html).toContain('"@type":"BreadcrumbList"');
  expect(html).toContain('"@type":"Article"');
  expect(html).toContain('"headline":"Test Dungeon"');
  expect(html).toContain('"dateModified":"2026-10-27"');
  expect(html).toContain('"about":{"@type":"Thing","name":"Deadmines"}');
  // No ads on wiki pages.
  expect(html).not.toContain("adsbygoogle");
});

test("a dungeon known only from a Blizzard post, with no entrance bound, renders without placeholders or a map link and stays out of search", async () => {
  const html = await render("test-new-dungeon");
  expect(html).toContain("Test New Dungeon");
  expect(html).toMatch(/>Overview<\/h2>[\s\S]*>Getting there<\/h2>[\s\S]*>In WoW: Forever<\/h2>/);
  expect(html).not.toContain("data-wiki-placeholder");
  expect(html).not.toContain("At a glance");
  expect(html).not.toContain("/map");
  expect(html).not.toContain('"about"');
  expect(html).toContain('"@type":"Article"');
  const { generateMetadata } = await import("./page");
  expect((await generateMetadata(params("test-new-dungeon"))).robots).toEqual({ index: false, follow: true });
  const { default: sitemap } = await import("../../sitemap");
  expect((await sitemap()).map((e) => new URL(e.url).pathname)).not.toContain("/wiki/test-new-dungeon");
});

test("a published dungeon page shows the game files' level and entrance marked unconfirmed, prints one level as one number and links the instance in the database", async () => {
  const html = await render("test-dungeon");
  const glance = section(html, "at-a-glance");
  // The committed build gives the Deadmines one level; it is printed as given, never widened into a range.
  expect(glance).toMatch(/<dt[^>]*>Level<\/dt><dd[^>]*>16 <span data-badge="files"/);
  expect(glance).not.toMatch(/16\s*[–-]/);
  expect(glance).toMatch(/<dt[^>]*>Entrance<\/dt><dd[^>]*>[\s\S]*href="\/database\/zones\/1436-westfall"[^>]*>Westfall<\/a>[\s\S]*href="\/map\?zone=1436&amp;x=38.2&amp;y=77.5"[^>]*>38.2, 77.5<\/a>[\s\S]*data-badge="files"/);
  expect(glance.match(/data-badge="files"/g)).toHaveLength(2);
  expect(glance).toContain('<a href="/database/instances/36-deadmines"');
  // The facts link the database and the map, never another wiki page, so no draft can surface through them.
  expect(glance).not.toContain('href="/wiki/');
});

test("players' reports keep their evidence: the entrance and each boss 3 installs report, with how many and when last; fewer than 3 installs list nothing", async () => {
  Object.assign(instances, {
    dataAsOf: "2026-10-22T00:00:00Z",
    entrances: ["a", "b", "c"].map((installId, n) => ({ installId, instanceMapId: 36, name: "Deadmines", instanceType: "party", mapId: 1436, x: 38, y: 77, capturedAt: `2026-10-${17 + n}T10:00:00Z` })),
    encounters: [
      ...["a", "b", "c", "a"].map((installId, n) => ({ installId, encounterId: 1, name: "Edwin VanCleef", instanceMapId: 36, success: true, npcIds: [639], capturedAt: `2026-10-${18 + n}T11:00:00Z` })),
      ...["a", "b"].map((installId) => ({ installId, encounterId: 2, name: "Rhahk'Zor", instanceMapId: 36, success: true, npcIds: [644], capturedAt: "2026-10-20T11:00:00Z" })),
    ],
  });
  const html = await render("test-dungeon");
  expect(section(html, "at-a-glance")).toMatch(/<dt[^>]*>Confirmed entrance<\/dt><dd[^>]*>[\s\S]*>Westfall<\/a>[\s\S]*>38, 77<\/a>[\s\S]*from 3 installs, last seen 2026-10-19/);
  const bosses = section(html, "bosses");
  expect(bosses).toContain(">Bosses</h2>");
  expect(bosses).toContain("Edwin VanCleef (4 kills) from 3 installs, last seen 2026-10-21");
  expect(html).not.toContain("Rhahk");
});

test("relations nobody has reported are left out: no boss section, no quest or loot list, no zero and no later-update placeholder", async () => {
  const html = await render("test-dungeon");
  expect(html).not.toContain('aria-labelledby="bosses"');
  expect(html).not.toContain("Confirmed entrance");
  expect(html).not.toMatch(/Quests that send you here|Loot by boss|From the database/);
  expect(html).not.toMatch(/\b0 (?:bosses|installs|kills)\b/);
  expect(html).not.toContain("data-wiki-placeholder");
  expect(html).not.toContain("in a later update");
});

test("with storage down, the game files' facts stay and the page says players' reports are unknown, not none", async () => {
  instances.unreachable = true;
  const html = await render("test-dungeon");
  const glance = section(html, "at-a-glance");
  expect(glance).toContain("Storage unreachable. These figures are unrecorded, not zero. Players&#x27; reports cannot be shown until it is back; what is here is from the game files.");
  expect(glance).toMatch(/>Level<\/dt><dd[^>]*>16 /);
  expect(glance).toContain(">Westfall</a>");
  expect(html).not.toContain('aria-labelledby="bosses"');
  expect(html).not.toContain("data-wiki-placeholder");
});

test("Before you go is labelled as advice, not data, and a link in it to a draft stays plain text", async () => {
  const html = await render("test-dungeon");
  const advice = section(html, "before-you-go");
  expect(advice).toContain(">Before you go</h2>");
  expect(advice).toContain("Advice in Everloot&#x27;s own words, not data from the game files or from players.");
  expect(advice).toContain("pull one pack at a time, and read <span>test draft</span> before you set out.");
  expect(advice).not.toContain('href="/wiki/');
  expect(html.match(/Advice in Everloot/g)).toHaveLength(1);
});

test("a raid page shows the same facts, and a level the game files do not give has no row, not a dash or a zero", async () => {
  // The committed build places Onyxia's Lair in Dustwallow Marsh but gives it no level.
  const html = await render("test-raid");
  const glance = section(html, "at-a-glance");
  expect(glance).not.toContain(">Level</dt>");
  expect(glance).toMatch(/<dt[^>]*>Entrance<\/dt><dd[^>]*>[\s\S]*>Dustwallow Marsh<\/a>/);
  expect(glance.match(/data-badge="files"/g)).toHaveLength(1);
  expect(glance).toContain('<a href="/database/instances/249-onyxia-s-lair"');
  expect(html).not.toContain("data-wiki-placeholder");
});

test("a raid page whose entrance the game files no longer have shows neither facts nor placeholders", async () => {
  const html = await render("test-lost-raid");
  expect(html).toContain("Test Lost Raid");
  expect(html).not.toContain("At a glance");
  expect(html).not.toContain("data-wiki-placeholder");
  expect(html).not.toContain("/database/instances/");
  expect(html).not.toContain('aria-labelledby="bosses"');
});

test("other wiki types are unchanged: a zone page keeps its placeholders and shows no dungeon facts or advice note", async () => {
  const html = await render("test-zone");
  expect(html).toContain('data-wiki-placeholder="infobox"');
  expect(html).toContain("Facts from the database appear here in a later update.");
  expect(html).toMatch(/data-wiki-placeholder="blocks"[\s\S]*NPCs[\s\S]*Quests[\s\S]*Vendors/);
  expect(html).not.toContain("data-wiki-facts");
  expect(html).not.toContain("/database/instances/");
  expect(html).not.toContain("Advice in Everloot");
});

test("no private path or internal name reaches the output", async () => {
  const pattern = loadPrivatePathPattern();
  for (const slug of ["test-dungeon", "test-zone", "test-new-dungeon"]) expect(await render(slug)).not.toMatch(pattern);
});
