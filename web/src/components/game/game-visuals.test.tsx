import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../../kb/src/market";
import { itemIndex, shard0, siteManifest } from "@/lib/game-assets.fixture";
import { forgetPrivateReads } from "@/lib/game-assets";
import { CREDIT } from "@/lib/talents/assets";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadMarket: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadMarket: store.loadMarket },
}));
// Like next/link, every other prop (aria-describedby, aria-current) reaches the anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

// The map's pictures are drawn in the browser, so the page hands them to the map as props: this puts them in the markup to read.
vi.mock("@/components/WorldMapView", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/WorldMapView")>();
  return { default: (props: Parameters<typeof real.default>[0]) => <><i data-map-art={JSON.stringify(props.art ?? null)} />{real.default(props)}</> };
});

import Home from "@/app/page";
import DropsPage from "@/app/database/drops/page";
import AuctionsRealmPage from "@/app/tools/auctions/[realm]/page";
import ProfessionsPage from "@/app/tools/professions/page";
import RaidPage from "@/app/tools/raid/page";
import MapPage from "@/app/map/page";
import ContinentMapPage from "@/app/map/[continent]/page";
import ItemPage from "@/app/database/items/[id]/page";
import VendorPage from "@/app/database/vendors/[id]/page";
import ChangesPage from "@/app/changes/page";
import WowForeverPage from "@/app/wow-forever/page";
import LorePage from "@/app/lore/page";

/** The wide-screen banner's markup: from its start to the end of its caption. */
const onBanner = (html: string) => html.slice(html.indexOf("data-banner"), html.indexOf("</p>", html.indexOf("data-banner-credit")));
/** The banner's one-line caption, tiny and quiet in the corner; the full credit with the build is at the foot of the page. */
const CAPTION = /data-banner-credit(?:="true")? class="absolute bottom-1 right-0 text-\[10px\] leading-none text-muted[^"]*">Art © Blizzard Entertainment$/;

const BASE = "https://assets.example.test/wow_classic_beta-70450-84bea423";
const PRIVATE = "https://r2.example.test/everloot-game-data/wow_classic_beta-70450-84bea423";
/** The server-only variables for the private item bucket. */
function privateBucket() {
  vi.stubEnv("GAME_DATA_S3_ENDPOINT", "https://r2.example.test");
  vi.stubEnv("GAME_DATA_BUCKET", "everloot-game-data");
  vi.stubEnv("GAME_DATA_ACCESS_KEY_ID", "id");
  vi.stubEnv("GAME_DATA_SECRET_ACCESS_KEY", "secret");
}

// Three installs saw item 9 drop from NPC 77, so its row is public; three scanned it on the auction house.
const loot = (install: string) => ({
  kind: "loot", eventId: `${install}:77:1`, installId: install, capturedAt: "2026-10-09T00:00:00.000Z",
  sourceNpcId: 77, sourceEvidence: "loot-api", items: [{ itemId: 9, count: 1 }],
});
const today = new Date();
const market = foldMarket(emptyMarket(), ["install-a", "install-b", "install-c"].map((installId, i) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:s`, capturedAt: today.toISOString(), realm: "Forever",
  scanId: `${installId}-s`, part: 1, parts: 1, items: [[9, 2, 40 + i, 10, 12]],
})), today);

const pages: [string, () => Promise<ReactNode>][] = [
  ["home", () => Home()],
  ["drops", () => DropsPage({})],
  ["auctions", () => AuctionsRealmPage({ params: Promise.resolve({ realm: "forever" }) })],
  ["professions", () => ProfessionsPage({ searchParams: Promise.resolve({}) })],
  ["raid", () => RaidPage()],
  ["map", () => MapPage({ searchParams: Promise.resolve({}) })],
  ["item", () => ItemPage({ params: Promise.resolve({ id: "9" }) })],
  ["vendor", () => VendorPage({ params: Promise.resolve({ id: "1" }) })],
  ["changes", () => ChangesPage({ searchParams: Promise.resolve({}) })],
  ["wow-forever", () => WowForeverPage()],
];
const render = async (page: () => Promise<ReactNode>) => renderToStaticMarkup(await page());

/** The public asset folder and the private item bucket, as the server reads them. Item files are only in the private one. */
function bucket(manifest: unknown = siteManifest) {
  return vi.fn(async (input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === `${BASE}/manifest.json`) return Response.json(manifest);
    if (url === `${PRIVATE}/items.json`) return Response.json(itemIndex);
    if (url === `${PRIVATE}/items/0.json`) return Response.json(shard0);
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  forgetPrivateReads();
  // One install's vendor row for NPC 1: short of agreement, but enough that its vendor page exists (an NPC no upload names as a vendor is a 404).
  const vendorRow = { kind: "vendor", installId: "install-a", eventId: "vendor-1", capturedAt: "2026-10-09T00:00:00.000Z", vendorNpcId: 1, items: [{ itemId: 2589, priceCopper: 10 }] };
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records: [...["install-a", "install-b", "install-c"].map(loot), vendorRow], dataAsOf: "2026-10-09T00:00:00.000Z" });
  store.loadMarket.mockReset().mockResolvedValue({ state: market, dataAsOf: "2026-10-09T00:00:00.000Z" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ART = /<img|<image|data-game-credit|data-item-tip|data-spell-tip|data-page-banner|data-launch-banner|Blizzard Entertainment, Inc\.|Classes and professions|Game map art/;

test.each(pages)("%s: with the asset URL unset there is no image, no tooltip, no credit and no fetch", async (_name, page) => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const html = await render(page);
  expect(html).not.toMatch(ART);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each(pages)("%s: a manifest that cannot be read leaves the same text-only page", async (_name, page) => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "");
  vi.stubGlobal("fetch", vi.fn());
  const plain = await render(page);
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
  expect(await render(page)).toBe(plain);
});

test("drops and auctions: the item's icon beside its link and the tooltip as its description; the credit is site-wide on auctions", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  privateBucket();
  const fetcher = bucket();
  vi.stubGlobal("fetch", fetcher);
  for (const [, page] of [["drops", () => DropsPage({})], ["auctions", () => AuctionsRealmPage({ params: Promise.resolve({ realm: "forever" }) })]] as const) {
    const html = await render(page);
    expect(html).toContain(`src="${BASE}/icons/132889.webp"`);
    expect(html).toMatch(/<img[^>]*alt=""[^>]*aria-hidden="true"/);
    expect(html).toMatch(/href="\/(database\/items|tools\/auctions\/forever)\/9"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain("Linen Cloth, Common");
    // Neither list carries a credit line of its own now: the site footer does (density spec, 2026-10-20).
    expect(html).not.toContain(CREDIT);
  }
  // Item data is read from the private bucket, never from the public asset folder.
  const urls = fetcher.mock.calls.map(([input]) => (typeof input === "string" ? input : input.url));
  expect(urls.some((u) => u.startsWith(`${BASE}/items`))).toBe(false);
  expect(urls).toContain(`${PRIVATE}/items/0.json`);
});

test("without the private bucket's variables, item links stay plain: no item icon, no tooltip, no credit for items", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => DropsPage({}));
  expect(html).not.toMatch(/data-item-tip|<img|data-game-credit/);
  expect(html).toContain("Item 9");
});

test("item page: the tooltip card for an item players reported; an id nobody reported reads nothing at all", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  privateBucket();
  const fetcher = bucket();
  vi.stubGlobal("fetch", fetcher);
  const seen = await render(() => ItemPage({ params: Promise.resolve({ id: "9" }) }));
  expect(seen).toMatch(/data-tooltip-frame[^>]*>[\s\S]*Linen Cloth/);
  // The credit for the icon and tooltip is the site footer's line, not one on the page.
  expect(seen).not.toContain(CREDIT);
  // Item 25 is in the same shard, but no install reported it: a typed id must not reveal it.
  fetcher.mockClear();
  forgetPrivateReads();
  const typed = await render(() => ItemPage({ params: Promise.resolve({ id: "25" }) }));
  expect(typed).not.toMatch(/Worn Shortsword|<img|data-game-credit/);
  // The one read is the file of names the game files and the wiki agree on (none for item 25 here): no manifest, no shard.
  expect(fetcher.mock.calls.map(([req]) => String(req instanceof Request ? req.url : req))).toEqual([expect.stringMatching(/\/item-names\.json$/)]);
});

test("home: class icons link to the talent calculator, names kept, and no credit line on the page", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => Home());
  expect(html).toMatch(/href="\/tools\/talents\/warrior"[^>]*><img[^>]*icons\/6001\.webp[^>]*\/?>Warrior/);
  // A class the upload has no icon for keeps its link and name.
  expect(html).toMatch(/href="\/tools\/talents\/druid"[^>]*>(?:<img[^>]*\/?>)?Druid/);
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
  expect(html).not.toContain(CREDIT);
});

test("raid builder: buff icons beside the effect names, and no credit block (it is site-wide)", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket({ ...siteManifest, spellTips: {}, loadingScreens: {} }));
  const html = await render(() => RaidPage());
  expect(html).toMatch(/<img[^>]*icons\/8001\.webp[^>]*\/?>Battle Shout/);
  expect(html).not.toContain(CREDIT);
});

test("raid builder: a raid's loading screen above the title, and a buff's tooltip on hover and focus", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => RaidPage());
  expect(html).toMatch(/<img[^>]*src="[^"]*loading\/9409\.webp"[^>]*alt=""[^>]*aria-hidden="true"[^>]*data-page-banner/);
  expect(html.indexOf("data-page-banner")).toBeLessThan(html.indexOf("<h1"));
  // The banner is the page's largest paint, so it is fetched first.
  expect(html).toMatch(/<img(?=[^>]*fetchpriority="high")[^>]*data-page-banner/i);
  // The name stays text, focusable, described by the tooltip text.
  expect(html).toMatch(/data-spell-tip[^>]*><img[^>]*icons\/8001\.webp[^>]*\/?><span tabindex="0"[^>]*aria-describedby="[^"]+"[^>]*>Battle Shout<\/span>/);
  expect(html).toContain("Battle Shout. Raises attack power by 20 for 2 min. found in game files, unconfirmed · build 1.60.1.70450.");
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
});

test("home: the hero shows the game's own logo and its name as text, on a phone too, with no credit line on the page", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => Home());
  const start = html.indexOf("data-launch-banner");
  const banner = html.slice(start, html.indexOf("</section>", start));
  expect(banner).toMatch(/<img[^>]*src="[^"]*logo\/logo-wow-forever-2x\.webp"[^>]*alt=""[^>]*aria-hidden="true"/);
  expect(banner).toMatch(/<img[^>]*src="[^"]*loading\/9249\.webp"[^>]*alt=""[^>]*aria-hidden="true"/);
  expect(banner).toContain(">World of Warcraft: Forever</p>");
  expect(banner).not.toMatch(/class="[^"]*hidden[^"]*">World of Warcraft: Forever/);
  expect(banner).not.toContain("endorsed by Blizzard");
  // The countdown sits on the banner, in Glint's speech bubble, and only there.
  expect(banner).toMatch(/data-glint-hero[\s\S]*Forever launches <a href="\/wow-forever"[^>]*><time/);
  expect(html.match(/Forever launches/g)).toHaveLength(1);
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
  expect(html.indexOf("data-launch-banner")).toBeLessThan(html.indexOf("<h1"));
});

test("home: without the game's logo in the upload there is no launch banner, and nothing stands in for it", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket({ ...siteManifest, logo: null }));
  const html = await render(() => Home());
  expect(html).not.toMatch(/data-launch-banner|logo-wow|World of Warcraft: Forever<\/p>/);
  expect(html).not.toContain("loading/9249");
  // The countdown stays in the hero.
  expect(html).toContain("Forever launches");
});

test("wow-forever: race and faction emblems beside the names in the race and class table, and no credit line", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => WowForeverPage());
  // The faction's emblem beside its heading, the race's beside its name in the first column.
  expect(html).toMatch(/<h3[^>]*><span[^>]*><img[^>]*emblems\/HordeEmblem\.webp"[^>]*alt=""[^>]*aria-hidden="true"[^>]*\/?>Horde<\/span><\/h3>/);
  expect(html).toMatch(/<td[^>]*><span[^>]*><img[^>]*emblems\/raceicon128-human-female\.webp"[^>]*\/?>Human<\/span><\/td>/);
  expect(html).toMatch(/<td[^>]*><span[^>]*><img[^>]*emblems\/raceicon128-nightelf-male\.webp"[^>]*\/?>Night Elf<\/span><\/td>/);
  // A race the upload has no icon for keeps its plain name.
  expect(html).toMatch(/<td[^>]*><span[^>]*>Orc<\/span><\/td>/);
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
});

test("map: each dungeon's loading screen beside its entrance in the list", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => ContinentMapPage({ params: Promise.resolve({ continent: "eastern-kingdoms" }), searchParams: Promise.resolve({}) }));
  expect(html).toMatch(/<li class="flex items-center gap-3"><img src="[^"]*loading\/9036-small\.webp" alt="" aria-hidden="true"[^>]*><span class="min-w-0"><span class="text-fg">Deadmines<\/span>/);
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
});

test("changes: a compact title row like the database lists, no loading-screen banner and no credit block (it is site-wide)", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => ChangesPage({ searchParams: Promise.resolve({}) }));
  expect(html).not.toContain("data-page-banner");
  expect(html).not.toMatch(/loading\/9001\.webp/);
  expect(html).toMatch(/<h1[^>]*>Changes<\/h1>/);
  expect(html).not.toContain('aria-label="Breadcrumb"');
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
});

test("professions: a picker of profession icons with their names", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => ProfessionsPage({ searchParams: Promise.resolve({ profession: "alchemy" }) }));
  expect(html).toMatch(/<nav aria-label="Professions"/);
  expect(html).toMatch(/href="\/tools\/professions\?profession=Alchemy&amp;from=1&amp;to=75" aria-current="page"[^>]*><img[^>]*icons\/7001\.webp[^>]*\/?>Alchemy/);
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
});

test("map: the continent picture and zone pictures; held-back zones only with spoilers", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const art = (html: string): { continent: { url: string } | null; zones: { url: string; smallUrl: string | null }[] } | null =>
    JSON.parse((html.match(/data-map-art="([^"]*)"/)![1]!).replaceAll("&quot;", '"'));
  const off = await render(() => ContinentMapPage({ params: Promise.resolve({ continent: "eastern-kingdoms" }), searchParams: Promise.resolve({}) }));
  // The continent's own picture always; never a held-back zone's.
  expect(art(off)!.continent!.url).toBe(`${BASE}/maps/13.webp`);
  expect(art(off)!.zones.find((z) => z.url === `${BASE}/maps/1429.webp`)?.smallUrl).toBe(`${BASE}/maps/1429-small.webp`);
  expect(off).not.toContain("maps/2548");
  expect(off).toContain("Game map art");
  expect(off).not.toContain("No game art.");
  expect(off).not.toContain(CREDIT);
  // With spoilers on, the held-back zone's picture too.
  const on = await render(() => ContinentMapPage({ params: Promise.resolve({ continent: "eastern-kingdoms" }), searchParams: Promise.resolve({ spoilers: "1" }) }));
  expect(art(on)!.zones.some((z) => z.url === `${BASE}/maps/2548.webp`)).toBe(true);
  // The page's description no longer says "No game art" once the pictures are on.
  const { generateMetadata } = await import("@/app/map/page");
  expect((await generateMetadata({ searchParams: Promise.resolve({}) })).description).toContain("The map pictures are the game's own.");
  // Kalimdor has no map pictures in this upload: none drawn, and no credit for them.
  const kalimdor = await render(() => ContinentMapPage({ params: Promise.resolve({ continent: "kalimdor" }), searchParams: Promise.resolve({}) }));
  expect(art(kalimdor)).toBeNull();
  expect(kalimdor).not.toMatch(/Map pictures/);
});

test("lore archive: the same wide-screen banner, Scarlet Monastery's loading screen with the title on it", async () => {
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", BASE);
  vi.stubGlobal("fetch", bucket());
  const html = await render(() => LorePage());
  expect(onBanner(html)).toMatch(/<img[^>]*loading\/9189\.webp[^>]*data-page-banner/);
  expect(onBanner(html)).toMatch(/<h1[^>]*>Lore archive<\/h1>/);
  expect(onBanner(html)).toMatch(CAPTION);
  // No credit block: the credit is site-wide; the lore page keeps only its one source line.
  expect(html).not.toMatch(/data-game-credit|data-source-line/);
  expect(html.match(/data-lore-source/g)).toHaveLength(1);
});
