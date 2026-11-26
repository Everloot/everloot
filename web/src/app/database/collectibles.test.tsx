import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: async () => ({ state: null, dataAsOf: null }) },
}));
// The manifest lists one mount spell's icon, one currency's and one pet's; nothing else has art.
const art = vi.hoisted(() => ({ assets: null as unknown }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => art.assets,
}));
// The toy list names a toy as its item page does: here only item 1973 has a name.
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: async () => ({ agreed: new Map([[1973, "Thief's Tools"]]), matched: null }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
vi.mock("@/components/ui/OpenData", () => ({ default: ({ text }: { text: string }) => <pre data-open-data>{text}</pre> }));

import MountPage, { generateMetadata as mountMeta } from "./mounts/[id]/page";
import PetPage from "./pets/[id]/page";
import CurrencyPage, { generateMetadata as currencyMeta } from "./currencies/[id]/page";
import MountListPage from "./mounts/page";
import ToyListPage from "./toys/page";
import CurrencyListPage from "./currencies/page";
import { siteSearch } from "@/lib/site-search";
import { DATABASE_HUBS } from "@/lib/database-hubs";

const at = "2026-11-25T00:00:00Z";
/** Brown Horse (mount 6) is taught by spell 458. */
const reportMount = (spellId: number, installs = 3) => store.loadCorpus.mockResolvedValue({
  unreachable: false, dataAsOf: at,
  records: Array.from({ length: installs }, (_, i) => ({ installId: `i${i}`, eventId: `e${i}`, capturedAt: at, kind: "collection_catalog", collection: "Mounts", source: "Vendor", itemId: spellId })),
});
const page = async (el: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await el);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const list = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const factOf = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";

beforeEach(() => {
  store.loadCorpus.mockResolvedValue({ unreachable: false, records: [], dataAsOf: at });
  art.assets = {
    spellIcons: new Map([[458, "https://a.test/icons/132261.webp"]]),
    currencyIcons: new Map([[3402, "https://a.test/icons/135725.webp"]]),
    petIcons: new Map([[39, "https://a.test/icons/132761.webp"]]),
  };
});

test("a mount page: icon, riding skill, the spell that teaches it, and the unconfirmed label until 3 installs report it", async () => {
  const out = await page(MountPage(params("6-brown-horse")));
  expect(out).toMatch(/<h1[^>]*>Brown Horse<\/h1>/);
  expect(out).toMatch(/data-entity-meta[^>]*>.*Mount.*ID 6/);
  expect(out).toContain('src="https://a.test/icons/132261.webp"');
  expect(out).toContain("data-unconfirmed");
  expect(factOf(out, "Taught by")).toContain('href="/database/spells/458"');
  expect(factOf(out, "Player reports")).toBe("None yet");
  expect(out).toContain("found in game files, unconfirmed");
  expect(out).toContain("The name is shown from the game files; players have not reported it yet.");
  expect(out).toContain('href="/tools/collections?view=mounts"');
  expect((await mountMeta(params("6-brown-horse"))).description).toContain("Found in game files, unconfirmed");
});

test("a mount 3 installs list in their mount collection is confirmed; storage out of reach is unrecorded", async () => {
  reportMount(458);
  const out = await page(MountPage(params("6-brown-horse")));
  expect(factOf(out, "Player reports")).toBe("3 of 3 installs agree");
  expect(out).not.toContain("data-unconfirmed");
  expect(out).toContain("Players reported it in their mount collection, three installs agreeing.");
  store.loadCorpus.mockResolvedValue({ unreachable: true, records: [] });
  expect(factOf(await page(MountPage(params("6-brown-horse"))), "Player reports")).toBe("Unrecorded");
});

test("a mount, pet or currency id the files do not list is a 404, and a wrong slug redirects", async () => {
  await expect(page(MountPage(params("999999")))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page(MountPage(params("6")))).rejects.toThrow("REDIRECT /database/mounts/6-brown-horse");
  await expect(page(PetPage(params("999999")))).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page(CurrencyPage(params("515-tickets")))).rejects.toThrow("REDIRECT /database/currencies/515-darkmoon-prize-ticket");
  expect((await mountMeta(params("999999"))).robots).toMatchObject({ index: false });
});

test("a companion pet page names its creature, links its summon spell and shows its icon", async () => {
  const out = await page(PetPage(params("39-mechanical-squirrel")));
  expect(out).toMatch(/<h1[^>]*>Mechanical Squirrel<\/h1>/);
  expect(out).toContain('src="https://a.test/icons/132761.webp"');
  expect(factOf(out, "Summoned by")).toContain('href="/database/spells/4055"');
  expect(factOf(out, "Creature")).toBe("2671");
  expect(out).toContain("No player report confirms companion pets yet.");
});

test("a currency page carries the files' own text and cap in the box, and no icon the manifest lacks", async () => {
  const out = await page(CurrencyPage(params("3469-tarnished-undermine-real")));
  expect(out).toContain("phased out of circulation");
  expect(out).toContain("Maximum: 165");
  expect(factOf(out, "Category")).toBe("Dungeon and Raid");
  expect(out).not.toContain("<img");
  expect(await page(CurrencyPage(params("3402-merchant-s-favor")))).toContain('src="https://a.test/icons/135725.webp"');
  expect((await currencyMeta(params("3469-tarnished-undermine-real"))).title).toBe("Tarnished Undermine Real (currency)");
});

test("the mount list links each page, filters by name, and marks the confirmed ones", async () => {
  reportMount(458);
  const out = await page(MountListPage(list({ q: "brown horse" })));
  expect(out).toContain('href="/database/mounts/6-brown-horse"');
  expect(out).toMatch(/Brown Horse[\s\S]*Confirmed/);
  expect(await page(MountListPage(list()))).toContain("Mounts in the game files: 141");
});

test("the currency list leaves the game's hidden counters out", async () => {
  const out = await page(CurrencyListPage(list()));
  expect(out).toContain("Currencies in the game files: 5");
  expect(out).not.toContain("Talent Reset");
  expect(out).not.toContain("Renown");
});

test("the toy list links each toy's item page and names it as that page does", async () => {
  const out = await page(ToyListPage(list()));
  expect(out).toContain("Toys in the game files: 21");
  expect(out).toContain('<a href="/database/items/1973">Thief&#x27;s Tools</a>');
  expect(out).toContain('href="/database/items/21540">Item 21540</a>');
});

test("search finds mounts, pets and currencies by name or id, and the database hub lists the four", async () => {
  const groups = await siteSearch("mechanical squirrel", { only: "pet" });
  expect(groups[0]).toMatchObject({ type: "pet", heading: "Companion pets" });
  expect(groups[0].results[0]).toMatchObject({ label: "Mechanical Squirrel", href: "/database/pets/39-mechanical-squirrel" });
  expect((await siteSearch("6", { only: "mount" }))[0].results[0]).toMatchObject({ label: "Brown Horse", exact: true });
  expect((await siteSearch("darkmoon prize", { only: "currency" }))[0].results[0].href).toBe("/database/currencies/515-darkmoon-prize-ticket");
  expect(DATABASE_HUBS.filter((h) => ["/database/mounts", "/database/pets", "/database/toys", "/database/currencies"].includes(h.href)).map((h) => h.source)).toEqual(["files", "files", "files", "files"]);
});
