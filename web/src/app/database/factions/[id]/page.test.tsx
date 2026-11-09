import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCompletion: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCompletion: store.loadCompletion },
}));
// The game files' factions: Booty Bay under the Steamwheedle Cartel, and one faction no player has reported.
const game = vi.hoisted(() => ({ factions: [] as { id: number; name: string; shown: boolean; parentId?: number }[] }));
vi.mock("@/data/game-data/client-factions", () => ({ get CLIENT_FACTIONS() { return { factions: game.factions }; } }));
vi.mock("@/data/game-data/client-titles", () => ({ get CLIENT_TITLES() { return { titles: [] }; } }));
vi.mock("@/data/game-data/client-quest-lines", () => ({ get CLIENT_QUEST_LINES() { return { questLines: [] }; } }));
vi.mock("@/data/game-data/client-achievements", () => ({ get CLIENT_ACHIEVEMENTS() { return { achievements: {} }; } }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
// The copy button keeps its text in a click handler, which static markup does not carry: shown here as a block instead.
vi.mock("@/components/ui/OpenData", () => ({
  default: ({ text, jsonHref }: { text: string; jsonHref?: string }) => <p><button type="button">Copy for AI</button>{jsonHref ? <a href={jsonHref}>Raw JSON</a> : null}<pre data-open-data>{text}</pre></p>,
}));
// The lore archive answers from here: no match unless a test sets one.
const lore = vi.hoisted(() => ({ match: null as { extId: string; name: string; intro: string } | null, asked: [] as [string, string][] }));
vi.mock("@/lib/lore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lore")>()),
  loreForEntity: async (type: string, name: string) => { lore.asked.push([type, name]); return lore.match; },
}));

import FactionPage, { generateMetadata } from "./page";
import { emptyCompletion, foldCompletion } from "../../../../../../kb/src/completion-rollup";

const at = "2026-11-08T00:00:00Z";
let seq = 0;
const rep = (installId: string, id: number, name: string, header?: string) =>
  ({ kind: "reputation_catalog", installId, eventId: `e:${++seq}`, capturedAt: at, factionId: id, name, ...(header ? { header } : {}) });
/** The same faction from three installs: public. */
const agreed = (id: number, name: string, header?: string) => ["one", "two", "three"].map((i) => rep(`reporter-${i}`, id, name, header));

const html = async (id: string) => renderToStaticMarkup(await FactionPage({ params: Promise.resolve({ id }) }));
const meta = (id: string) => generateMetadata({ params: Promise.resolve({ id }) });
/** A quick fact's value markup, by its label. */
const factOf = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";

beforeEach(() => {
  seq = 0;
  lore.match = null;
  lore.asked = [];
  game.factions = [
    { id: 169, name: "Steamwheedle Cartel", shown: true },
    { id: 21, name: "Booty Bay", shown: true, parentId: 169 },
    { id: 529, name: "Argent Dawn", shown: true },
  ];
  const state = foldCompletion(emptyCompletion(), [{ records: agreed(21, "Booty Bay", "Steamwheedle Cartel"), grants: [] }]);
  store.loadCompletion.mockResolvedValue({ state, dataAsOf: at });
});

test("a confirmed faction page has the header meta, the facts, In short, Open data, a Track this link and a relation tab", async () => {
  const out = await html("21-booty-bay");
  expect(out).toMatch(/data-entity-meta[^>]*>.*Faction.*Steamwheedle Cartel.*ID 21/);
  expect(out.match(/ID 21/g)).toHaveLength(1);
  // The facts: the files' header flag and parent, three installs' standing, and where to track it.
  expect(factOf(out, "Header")).toBe("No");
  expect(factOf(out, "Parent faction")).toContain('href="/database/factions/169-steamwheedle-cartel"');
  expect(factOf(out, "Player reports")).toBe("3 of 3 installs agree");
  expect(factOf(out, "Track this")).toContain('href="/tools/collections"');
  expect(out).not.toContain("Not reported");
  expect(out).not.toMatch(/>ID<\/dt>/);
  // In short says what it is, who reported it, what the files say, what is still missing and where the name came from.
  expect(out).toContain("In short");
  expect(out).toContain("A reputation faction under Steamwheedle Cartel in WoW: Forever.");
  expect(out).toContain("Players reported it in their reputation pane, three installs agreeing.");
  expect(out).toContain("The game files list it under Steamwheedle Cartel.");
  expect(out).toContain("No quest is linked to it yet.");
  expect(out).toContain("Players agree on the name.");
  expect(out).toContain('href="/database#reading"');
  // Open data: the copy button, and no Raw JSON link since no tooltip route serves a faction.
  expect(out).toContain("Copy for AI");
  expect(out).not.toContain("Raw JSON");
  // The relation tab is there, empty, and names the 3-install rule without sending anyone to the addon for a fact it cannot change.
  expect(out).toContain("Reputation from");
  expect(out).toContain("data-empty-state");
  expect(out).toContain("No quest is linked to this faction yet. A quest shows once 3 installs report it");
  expect(out).not.toContain("Get the addon");
});

test("the Open data text is the page's own lines with the source address", async () => {
  const out = await html("21-booty-bay");
  const text = /<pre data-open-data="true">([\s\S]*?)<\/pre>/.exec(out)?.[1] ?? "";
  expect(text.split("\n")).toEqual([
    "Booty Bay (faction 21)",
    "A reputation faction under Steamwheedle Cartel in WoW: Forever.",
    "Players reported it in their reputation pane, three installs agreeing.",
    "The game files list it under Steamwheedle Cartel.",
    "No quest is linked to it yet.",
    "Players agree on the name.",
    "Source: https://everloot.app/database/factions/21-booty-bay",
  ]);
});

test("a faction only the game files know keeps an empty meter for player reports and says so in short", async () => {
  const out = await html("529-argent-dawn");
  expect(factOf(out, "Player reports")).toContain('data-agreement="0"');
  expect(out).not.toContain("3 of 3 installs agree");
  expect(out).toContain("No player has reported it in a reputation pane yet.");
  expect(out).toContain("The game files list it.");
  expect(out).toContain("It has no agreed name yet: that needs three installs reporting the same one.");
  expect(out).toContain("found in game files, unconfirmed");
  expect(out).not.toContain("Not reported");
  expect(factOf(out, "Track this")).toContain('href="/tools/collections"');
  expect((await meta("529-argent-dawn")).description).toContain("Found in game files, unconfirmed");
});

test("a header the files name as other factions' parent says so in short", async () => {
  const out = await html("169-steamwheedle-cartel");
  expect(factOf(out, "Header")).toBe("Yes");
  expect(out).toContain("A header of the reputation pane in WoW: Forever.");
  expect(out).toContain("The game files list it and name it as other factions&#x27; parent.");
  expect((await meta("169-steamwheedle-cartel")).robots).toMatchObject({ index: false });
});

test("the lore block shows when the archive has a page under the faction's name, and is asked as an 'other' page", async () => {
  expect(await html("21-booty-bay")).not.toContain("lore archive");
  lore.match = { extId: "4242", name: "Booty Bay", intro: "Booty Bay is a goblin port on the southern tip of Stranglethorn Vale." };
  const out = await html("21-booty-bay");
  expect(lore.asked).toContainEqual(["other", "Booty Bay"]);
  expect(out).toContain("Booty Bay is a goblin port");
  expect(out).toContain('href="/lore/4242-booty-bay"');
  expect(out).toContain("Read Booty Bay in the lore archive");
});

test("an id nothing lists is a 404 and a wrong slug redirects", async () => {
  await expect(html("999")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html("21-wrong")).rejects.toThrow("REDIRECT /database/factions/21-booty-bay");
  expect((await meta("999")).robots).toMatchObject({ index: false, follow: true });
});
