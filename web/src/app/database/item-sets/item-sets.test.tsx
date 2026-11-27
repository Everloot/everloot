import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

// The private name files: set 1's and one of its bonus spells' names; a piece named under the item name rule.
const files = vi.hoisted(() => ({ sets: true as boolean }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadItemSetNames: async () => (files.sets ? { version: "x", names: new Map([[1, "The Gladiator"], [342, "Champion's Raiment"]]) } : null),
  loadSpellNames: async () => ({ version: "x", names: new Map([[9331, "Increased Defense"]]) }),
  loadSiteAssets: async () => ({ spellIcons: new Map() }),
  // Piece 11729 has a whole record; 11728 only an icon (no ItemSparse row), as tier pieces often do.
  readItemTips: async (_: unknown, ids: readonly number[]) => ({
    tips: new Map(ids.filter((id) => id === 11729).map((id) => [id, { icon: "https://assets.test/icon.webp" }])),
    icons: new Map(ids.filter((id) => id === 11729 || id === 11728).map((id) => [id, id === 11729 ? "https://assets.test/icon.webp" : "https://assets.test/legs.webp"])),
    unreachable: false, degraded: false, indexed: true,
  }),
}));
vi.mock("@/lib/shown-item-names", () => ({
  loadShownNames: async () => ({
    facts: { unreachable: false }, agreed: new Map([[11729, "Savage Gladiator Chain"], [11728, "Savage Gladiator Leggings"]]), matched: null,
    named: { has: (id: number) => id === 11729 || id === 11728 }, showsTip: (id: number) => id === 11729 || id === 11728, degraded: false,
  }),
}));
// Where players got each piece, under the 3-install rule the item lists' Source column uses.
const seen = vi.hoisted(() => ({ unreachable: false }));
vi.mock("@/lib/item-seen", () => ({
  loadItemSeen: async () => ({ seen: new Set([11729]), from: seen.unreachable ? new Map() : new Map([[11729, ["drop", "vendor"]]]), unreachable: seen.unreachable }),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/components/ui/OpenData", () => ({ default: ({ text }: { text: string }) => <pre data-open-data>{text}</pre> }));

import ItemSetPage, { generateMetadata } from "./[id]/page";
import ItemSetListPage from "./page";

const html = async (id: string) => renderToStaticMarkup(await ItemSetPage({ params: Promise.resolve({ id }) }));
const list = async (search: Record<string, string> = {}) => renderToStaticMarkup(await ItemSetListPage({ searchParams: Promise.resolve(search) }));

beforeEach(() => { files.sets = true; seen.unreachable = false; });

test("a piece the files give only an icon for still shows that icon", async () => {
  const out = await html("1");
  expect(out).toMatch(/src="https:\/\/assets\.test\/legs\.webp"[^>]*>(?:<[^>]*>)*Savage Gladiator Leggings/);
});

test("each piece says where players got it, linking the item page's tab; a piece with no report shows a dash", async () => {
  const out = await html("1");
  expect(out).toMatch(/<th[^>]*>(?:<[^>]*>)*Source</);
  expect(out).toMatch(/<a href="\/database\/items\/11729#dropped-by"[^>]*>Drop<\/a>/);
  expect(out).toMatch(/<a href="\/database\/items\/11729#sold-by"[^>]*>Vendor<\/a>/);
  // On a phone the column folds into the row's meta line.
  expect(out).toContain("Head · Drop, Vendor · ID 11729");
  // Storage out of reach: unrecorded, not "no source".
  seen.unreachable = true;
  expect(await html("1")).toContain("Unrecorded");
});

test("a set page: the name with the unconfirmed marker, its pieces with icons and links, its bonuses with pieces needed and spell links", async () => {
  const out = await html("1");
  expect(out.match(/<h1[ >]/g)).toHaveLength(1);
  expect(out).toMatch(/<h1[^>]*>The Gladiator<\/h1>/);
  expect(out).toMatch(/data-entity-meta[^>]*>.*Item set.*6 pieces.*ID 1.*data-badge="files"/);
  // Pieces: every one links its item page; a named one by its name and icon, the rest by id.
  expect(out).toContain('<a href="/database/items/11729">Savage Gladiator Chain</a>');
  expect(out).toContain('src="https://assets.test/icon.webp"');
  expect(out).toContain('<a href="/database/items/11726">Item 11726</a>');
  // Bonuses: pieces needed, the spell's page, its name from the files with the quiet marker.
  expect(out).toContain('<a href="/database/spells/9331">Increased Defense</a>');
  expect(out).toContain('<a href="/database/spells/1301126">Spell 1301126</a>');
  expect(out).toContain("(3) Set: Increased Defense");
  // Found in game files, unconfirmed, with the build.
  expect(out).toContain("Found in game files, unconfirmed: read from build 1.60.1.71139");
  expect(out).toContain("Blizzard Entertainment");
});

test("a set whose pieces' class masks agree names the class; a crafted set names its profession and rank", async () => {
  const pvp = await html("342");
  expect(pvp).toContain('<a href="/classes/priest">Priest</a>');
  const crafted = (await import("@/lib/item-sets")).ITEM_SETS.find((s) => s.skill)!;
  const out = await html(String(crafted.id));
  expect(out).toMatch(/>Requires<\/dt><dd[^>]*>.*\(\d+\)/);
});

test("an id the item set file does not list is a 404; the page is indexed only when the names file names the set", async () => {
  await expect(html("999999")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html("abc")).rejects.toThrow("NEXT_NOT_FOUND");
  expect((await generateMetadata({ params: Promise.resolve({ id: "1" }) })).robots).toEqual({ index: true, follow: true });
  files.sets = false;
  expect((await generateMetadata({ params: Promise.resolve({ id: "1" }) })).robots).toEqual({ index: false, follow: true });
  expect(await html("1")).toMatch(/<h1[^>]*>Item set 1<\/h1>/);
});

test("the list: every set by name, with pieces, bonuses and classes, filtered by name or id", async () => {
  const out = await list();
  expect(out).toContain('<a href="/database/item-sets/1">The Gladiator</a>');
  expect(out).toContain("found in game files, unconfirmed");
  const found = await list({ q: "raiment" });
  expect(found).toContain("Champion&#x27;s Raiment");
  expect(found).not.toContain("The Gladiator");
  expect(await list({ q: "342" })).toContain('href="/database/item-sets/342"');
  // Without the names file the sets are listed by id, and the page says why.
  files.sets = false;
  const plain = await list();
  expect(plain).toContain(">Item set 1</a>");
  expect(plain).toContain("could not be read just now");
});
