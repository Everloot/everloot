import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, permanentRedirect: () => {}, usePathname: () => mocks.path }));
vi.mock("@/components/CookieConsent", () => ({ CookiePreferencesButton: () => null }));
vi.mock("./upload/UploadClient", () => ({ default: () => null }));
vi.mock("@/lib/rollup-compute", () => ({
  computeRollups: async () => ({ rates: [], measuredZeros: [], stats: mocks.stats }),
  loadWorldFacts: async () => ({ npcs: [], quests: [], vendors: [], unreachable: false }),
}));
vi.mock("@/lib/upload-store", () => ({ STORAGE_UNREACHABLE: "unreachable", uploadStore: { loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }), loadCorpus: async () => ({ records: [], unreachable: false, dataAsOf: "2026-10-17T00:00:00.000Z" }), loadMarket: async () => ({ state: null, dataAsOf: null, unreachable: false }) } }));
vi.mock("@/lib/release", () => ({ getRelease: () => null }));

const mocks = vi.hoisted(() => ({ path: "/", stats: { uploads: 0, lootWindows: 0, unreachable: false, dataAsOf: "2026-10-17T18:20:27.999Z" } as Record<string, unknown> }));
beforeEach(() => {
  mocks.path = "/";
  mocks.stats = { uploads: 0, lootWindows: 0, unreachable: false, dataAsOf: "2026-10-17T18:20:27.999Z" };
});

/** Every JSON-LD block in the markup, parsed. A block that does not parse fails the test. */
function blocks(html: string): Record<string, any>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1].replaceAll("&quot;", '"')));
}
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const h1 = (html: string) => visible(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1]).trim();

test("the home page carries Organization and WebSite, and shows the lore search the action points at", async () => {
  const { default: Home } = await import("./page");
  const html = renderToStaticMarkup(await Home());
  const [org, site] = blocks(html);
  expect(org["@type"]).toBe("Organization");
  expect(site["@type"]).toBe("WebSite");
  expect(site.potentialAction.name).toBe("Search the lore archive");
  expect(visible(html)).toContain("Search the lore archive");
  expect(html).toContain('action="/search"');
});

test("the footer shows the email, the blurb and the non-affiliation line the Organization repeats", async () => {
  const { default: Footer } = await import("@/components/Footer");
  const { organizationJsonLd } = await import("@/lib/jsonld");
  const text = visible(renderToStaticMarkup(<Footer />));
  const org = organizationJsonLd() as { email: string; description: string };
  expect(text).toContain(org.email);
  for (const sentence of org.description.split(/(?<=\.) /)) expect(text).toContain(sentence);
});

test("a class page: name matches the H1, description and facts are visible, the hub is its parent, and the breadcrumb is real links", async () => {
  const { default: Page } = await import("./tools/talents/[class]/page");
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ class: "hunter" }) }));
  const [app] = blocks(html);
  expect(app["@type"]).toBe("WebApplication");
  expect(app.name).toBe(h1(html));
  expect(app.name).toBe("WoW Forever Hunter Talent Calculator");
  expect(visible(html)).toContain(app.description);
  expect(app.isPartOf["@id"]).toBe("https://everloot.app/tools/talents#webapplication");
  expect(visible(html)).toContain("How many talent points does a Hunter get at level 60?");
  expect(visible(html)).toMatch(/Beast Mastery\s*: \d+ talents, \d+ ranks/);
  expect(visible(html)).toContain("row 2 needs 5");

  mocks.path = "/tools/talents/hunter";
  const { default: Breadcrumbs } = await import("@/components/Breadcrumbs");
  const crumbs = renderToStaticMarkup(<Breadcrumbs />);
  const list = blocks(crumbs)[0];
  expect(list["@type"]).toBe("BreadcrumbList");
  const names = list.itemListElement.map((i: { name: string }) => i.name);
  expect(names).toEqual(["Home", "Talent calculator", "Hunter"]);
  // The trail is for search engines only: nothing visible (density spec, 2026-10-20).
  expect(visible(crumbs).trim()).toBe("");
  expect(JSON.stringify(list)).not.toContain('"https://everloot.app/tools"');
  expect(crumbs).not.toContain('href="/tools"');
});

test("the talent hub answers points and the two talent sets in visible text", async () => {
  const { default: Page } = await import("./tools/talents/page");
  const html = renderToStaticMarkup(await Page());
  const [app] = blocks(html);
  expect(app.name).toBe(h1(html));
  expect(visible(html)).toContain("every class has 51 talent points by level 60");
  expect(visible(html)).toContain("beta notes");
});

test("the raid page lists the talent-gated buffs from the raid data and its JSON-LD matches the H1", async () => {
  const { default: Page } = await import("./tools/raid/page");
  const html = renderToStaticMarkup(await Page());
  const [app] = blocks(html);
  expect(app.name).toBe(h1(html));
  expect(visible(html)).toContain("Which raid buffs need a talent?");
  expect(visible(html)).toContain("Trueshot Aura");
  expect(visible(html)).toContain("Hunter, Marksmanship tree");
});

test.each([
  ["/tools/professions", () => import("./tools/professions/page")],
  ["/tools/guild-board", () => import("./tools/guild-board/page")],
  ["/tools/collections", () => import("./tools/collections/page")],
  ["/tools/gold-ledger", () => import("./tools/gold-ledger/page")],
])("%s carries WebApplication named by its H1 and described by its visible lead line", async (path, load) => {
  const { default: Page } = await load();
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  const [app] = blocks(html);
  expect(app["@type"]).toBe("WebApplication");
  expect(app.name).toBe(h1(html));
  expect(app.url).toBe(`https://everloot.app${path}`);
  expect(visible(html)).toContain(app.description);
  // Only what the page shows: no rating, price or user count.
  for (const key of ["aggregateRating", "offers", "interactionStatistic"]) expect(app).not.toHaveProperty(key);
});

test("/tools/auctions carries WebApplication named by its H1; with no lead line, its meta description describes it", async () => {
  const { default: Page, metadata } = await import("./tools/auctions/page");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  const [app] = blocks(html);
  expect(app["@type"]).toBe("WebApplication");
  expect(app.name).toBe(h1(html));
  expect(app.url).toBe("https://everloot.app/tools/auctions");
  expect(app.description).toBe(metadata.description);
});

test("the profession hub's H1 names WoW Forever and is its title", async () => {
  const { default: Page, metadata } = await import("./tools/professions/page");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(h1(html)).toBe("WoW Forever Profession Hubs");
  expect(metadata.title).toBe(h1(html));
});

test("/changes opens with the latest build and its ItemList items are the entries shown", async () => {
  const { default: Page } = await import("./changes/page");
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  const [page] = blocks(html);
  expect(page["@type"]).toBe("CollectionPage");
  expect(visible(html)).toMatch(/Latest build: WoW: Forever \d+\.\d+\.\d+\.\d+, first seen by Everloot on \d{4}-\d{2}-\d{2}\./);
  expect(h1(html)).toBe(page.name);
  const shown = (html.match(/data-change-row/g) ?? []).length;
  expect(page.mainEntity.itemListElement).toHaveLength(shown);
  for (const { item } of page.mainEntity.itemListElement) expect(visible(html)).toContain(item.name);
});

test("/upload: the download is the one the site serves, with the licence beside it; the addon's structured data is on /addon", async () => {
  const { default: Page } = await import("./upload/page");
  const { latestAddonRelease } = await import("@/lib/addon-release");
  const html = renderToStaticMarkup(<Page />);
  expect(blocks(html).find((b) => b["@type"] === "SoftwareApplication")).toBeUndefined();
  const release = latestAddonRelease()!;
  expect(html).toContain(`href="${release.downloadPath}"`);
  expect(visible(html)).toContain(`Download Alpha addon ${release.version}`);
  expect(visible(html)).toContain("Licence: AGPL-3.0");
});

test("/wow-forever: the page is about the VideoGame it names, published by Blizzard, with the post it quotes", async () => {
  const { default: Page } = await import("./wow-forever/page");
  const { LAUNCH } = await import("@/data/wow-forever");
  const html = renderToStaticMarkup(await Page());
  const page = blocks(html).find((b) => b["@type"] === "WebPage")!;
  expect(page.url).toBe("https://everloot.app/wow-forever");
  expect(page.about).toMatchObject({ "@type": "VideoGame", name: "World of Warcraft: Forever", publisher: { name: "Blizzard Entertainment" } });
  expect(page.about.subjectOf).toEqual({ "@type": "Article", headline: LAUNCH.sourceTitle, url: LAUNCH.sourceUrl });
  for (const shown of ["World of Warcraft: Forever", "WoW: Forever", "Blizzard"]) expect(visible(html)).toContain(shown);
  expect(html).toContain(`href="${LAUNCH.sourceUrl}"`);
});

test("/database: no Dataset while nothing is uploaded, a Dataset with its licence once something is, and no licence text on the page", async () => {
  const { default: Page } = await import("./database/page");
  const empty = renderToStaticMarkup(await Page());
  expect(blocks(empty)).toEqual([]);
  mocks.stats = { uploads: 2, lootWindows: 5, unreachable: false, dataAsOf: "2026-10-17T18:20:27.999Z" };
  const full = renderToStaticMarkup(await Page());
  const [dataset] = blocks(full);
  expect(dataset["@type"]).toBe("Dataset");
  expect(JSON.stringify(dataset.license)).toContain("creativecommons.org/licenses/by-sa/4.0");
  // The site footer and /methodology carry the licence (Carlos, 2026-10-20: no licence lines on pages).
  expect(visible(full)).not.toContain("CC BY-SA");
  mocks.stats = { uploads: 9, lootWindows: 5, unreachable: true, dataAsOf: "2026-10-17T18:20:27.999Z" };
  expect(blocks(renderToStaticMarkup(await Page()))).toEqual([]);
});

test("/lore shows the credit text its CollectionPage carries; /about carries AboutPage and names no person", async () => {
  const { default: Lore } = await import("./lore/page");
  const lore = renderToStaticMarkup(await Lore());
  const [coll] = blocks(lore);
  expect(coll["@type"]).toBe("CollectionPage");
  expect(visible(lore)).toContain(coll.creditText);
  expect(visible(lore)).toContain(coll.description);
  const { default: About } = await import("./about/page");
  const about = renderToStaticMarkup(<About />);
  const [page] = blocks(about);
  expect(page["@type"]).toBe("AboutPage");
  expect(page.name).toBe(h1(about));
  expect(JSON.stringify(blocks(about))).not.toContain("Person");
  expect(about).not.toMatch(/TODO/i);
});

test("/wow-forever quotes only the source, shows the checked-on date and links the source; the lore page points to it", async () => {
  const { default: Page } = await import("./wow-forever/page");
  const { LAUNCH } = await import("@/data/wow-forever");
  const html = renderToStaticMarkup(await Page());
  expect(visible(html)).toContain(`“${LAUNCH.quote}”`);
  expect(visible(html)).toContain("Checked on October 17, 2026");
  expect(html).toContain(`href="${LAUNCH.sourceUrl}"`);
  expect(visible(html)).toContain("What is WoW: Forever?");
  expect(visible(html)).toContain("When does WoW: Forever launch?");
  // One block: the page and the game it is about (its own test below); no claim of its own beyond that.
  expect(blocks(html).map((b) => b["@type"])).toEqual(["WebPage"]);
});

test("the launch source and date agree with the curated lore row", () => {
  const yaml = readFileSync(new URL("../../../kb/curated/forever.yaml", import.meta.url), "utf8");
  return import("@/data/wow-forever").then(({ LAUNCH, longDate }) => {
    expect(yaml).toContain(`source_url: ${LAUNCH.sourceUrl}`);
    expect(yaml).toContain(longDate(LAUNCH.date));
    expect(LAUNCH.quote).toContain(longDate(LAUNCH.date));
  });
});

test("/wow-forever shows Blizzard's race and class tables with the new combinations marked and the source linked", async () => {
  const { default: Page } = await import("./wow-forever/page");
  const { RACES, NEW_COMBOS } = await import("@/data/wow-forever");
  const html = renderToStaticMarkup(await Page());
  expect(visible(html)).toContain("Which races and classes can you play?");
  expect(html).toContain(`href="${RACES.sourceUrl}"`);
  expect(visible(html)).toContain("published September 22, 2026");
  expect(html.match(/<table/g)).toHaveLength(2);
  const tables = html.match(/<table[\s\S]*?<\/table>/g)!.join("");
  expect(tables.match(/>New</g)).toHaveLength(NEW_COMBOS.length);
});

test("/methodology states the three-installs rule, unrecorded is not zero, and links the data policy", async () => {
  const { default: Page } = await import("./methodology/page");
  const html = renderToStaticMarkup(await Page());
  expect(h1(html)).toBe("How we count");
  // The full credits the footer's one line links to, with the build.
  expect(html).toContain('id="credits"');
  expect(visible(html)).toContain("Icons, tooltip text and interface art are © Blizzard Entertainment, Inc.");
  expect(visible(html)).toMatch(/Game files read from build \d+\.\d+\.\d+\.\d+/);
  expect(visible(html)).toContain("Warcraft Wiki contributors.");
  expect(html).toContain('href="https://github.com/wowdev/WoWDBDefs"');
  expect(visible(html)).toContain("at least three different installs");
  expect(visible(html)).toContain("Unrecorded is not zero");
  expect(html).toContain('/blob/main/docs/DATA_POLICY.md"');
  // Population numbers: the exact counting rules, before the first number on /census.
  expect(visible(html)).not.toContain("doesn't publish player counts yet");
  expect(visible(html)).toContain("Each character is counted once");
  expect(visible(html)).toContain("at least 10 characters reported by at least 3 installs");
  expect(visible(html)).toContain("reads “not enough reports”");
  expect(visible(html)).toContain("fewer than 10 characters, fewer than 3 installs or fewer than 3 addresses, or hidden to protect a small count");
  expect(visible(html)).toContain("at least two counts are hidden and together they cover at least 10 characters");
  expect(visible(html)).toContain("they are not a guarantee");
  expect(visible(html)).toContain("rounded to the nearest 5");
  expect(visible(html)).toContain("the last 7 days");
  expect(html).toContain('href="/census"');
});
