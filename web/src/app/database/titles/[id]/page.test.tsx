import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCompletion: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCompletion: store.loadCompletion },
}));
// The game files' titles: the one three installs reported, and one no player has.
const game = vi.hoisted(() => ({ titles: [] as { id: number; name: string }[] }));
vi.mock("@/data/game-data/client-titles", () => ({ get CLIENT_TITLES() { return { titles: game.titles }; } }));
vi.mock("@/data/game-data/client-factions", () => ({ get CLIENT_FACTIONS() { return { factions: [] }; } }));
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

import TitlePage, { generateMetadata } from "./page";
import { emptyCompletion, foldCompletion } from "../../../../../../kb/src/completion-rollup";

const at = "2026-11-08T00:00:00Z";
let seq = 0;
const title = (installId: string, id: number, name: string) => ({ kind: "title_catalog", installId, eventId: `e:${++seq}`, capturedAt: at, titleId: id, name });
/** The same title from three installs: public. */
const agreed = (id: number, name: string) => ["one", "two", "three"].map((i) => title(`reporter-${i}`, id, name));

const html = async (id: string) => renderToStaticMarkup(await TitlePage({ params: Promise.resolve({ id }) }));
const meta = (id: string) => generateMetadata({ params: Promise.resolve({ id }) });
const factOf = (out: string, label: string) => new RegExp(`>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(out)?.[1] ?? "";

beforeEach(() => {
  seq = 0;
  game.titles = [{ id: 144, name: "Bloodsail Admiral %s" }, { id: 8, name: "%s, Champion" }];
  const state = foldCompletion(emptyCompletion(), [{ records: agreed(144, "Bloodsail Admiral %s"), grants: [] }]);
  store.loadCompletion.mockResolvedValue({ state, dataAsOf: at });
});

test("a confirmed title page has the header meta, the facts, In short, Open data, a Track this link and a relation tab", async () => {
  const out = await html("144-bloodsail-admiral-s");
  expect(out).toMatch(/data-entity-meta[^>]*>.*Title.*ID 144/);
  expect(factOf(out, "Player reports")).toBe("3 of 3 installs agree");
  expect(factOf(out, "Track this")).toContain('href="/tools/collections"');
  expect(factOf(out, "ID")).toBe("144");
  // In short: what it is, who reported it, what the files say, what is still missing and where the name came from.
  expect(out).toContain("In short");
  expect(out).toContain("A character title in WoW: Forever.");
  expect(out).toContain("Players reported holding it, three installs agreeing.");
  expect(out).toContain("The game files list it.");
  expect(out).toContain("No achievement is linked to it yet.");
  expect(out).toContain("Players agree on the name.");
  expect(out).toContain('href="/database#reading"');
  // Open data: the copy button and the record's own lines; no Raw JSON since no tooltip route serves a title.
  expect(out).toContain("Copy for AI");
  const text = /<pre data-open-data="true">([\s\S]*?)<\/pre>/.exec(out)?.[1] ?? "";
  expect(text.split("\n")).toEqual([
    "Bloodsail Admiral %s (title 144)",
    "A character title in WoW: Forever.",
    "Players reported holding it, three installs agreeing.",
    "The game files list it.",
    "No achievement is linked to it yet.",
    "Players agree on the name.",
    "Source: https://everloot.app/database/titles/144-bloodsail-admiral-s",
  ]);
  expect(out).not.toContain("Raw JSON");
  // The relation tab is there, empty, and names the 3-install rule without sending anyone to the addon for a fact it cannot change.
  expect(out).toContain("Earned by");
  expect(out).toContain("data-empty-state");
  expect(out).toContain("No achievement is linked to this title yet. The game files read so far name no title rewards");
  expect(out).toContain("3 installs agreeing");
  expect(out).not.toContain("Get the addon");
  expect(out).not.toContain("Not reported");
});

test("a title only the game files know keeps an empty meter for player reports and says so in short", async () => {
  const out = await html("8-s-champion");
  expect(factOf(out, "Player reports")).toContain('data-agreement="0"');
  expect(out).not.toContain("3 of 3 installs agree");
  expect(out).toContain("No player has reported holding it yet.");
  expect(out).toContain("The game files list it.");
  expect(out).toContain("It has no agreed name yet: that needs three installs reporting the same one.");
  expect(out).toContain("found in game files, unconfirmed");
  expect(out).toContain("Earned by");
  expect((await meta("8-s-champion")).description).toContain("Found in game files, unconfirmed");
});

test("a title three installs reported that the files do not list says so", async () => {
  game.titles = [];
  const out = await html("144-bloodsail-admiral-s");
  expect(out).toContain("No game file read so far lists it.");
  expect(out).toContain("Players reported holding it, three installs agreeing.");
});

test("an id nothing lists is a 404 and a wrong slug redirects", async () => {
  await expect(html("999")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(html("144")).rejects.toThrow("REDIRECT /database/titles/144-bloodsail-admiral-s");
  expect((await meta("999")).robots).toMatchObject({ index: false, follow: true });
});
