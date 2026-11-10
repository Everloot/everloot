import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: vi.fn().mockResolvedValue({ unreachable: true }) },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadQuestNames: async () => null,
  loadSpellNames: async () => ({ version: "1.60.1.70862", names: new Map([[10, "Blizzard"]]) }),
}));
vi.mock("@/lib/release", () => ({ getRelease: () => null }));
// The copy button keeps its text in a click handler, which static markup does not carry: shown here as a block instead.
vi.mock("@/components/ui/OpenData", () => ({
  default: ({ text }: { text: string }) => <pre data-open-data>{text}</pre>,
}));

import DatabasePage from "./(hub)/page";
import Item from "./items/[id]/page";
import Npc from "./npcs/[id]/page";
import Quest from "./quests/[id]/page";
import ObjectPage from "./objects/[id]/page";
import Spell from "./spells/[id]/page";

beforeEach(() => store.loadCorpus.mockReset());

test("the database index carries the key to reading its numbers", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-10-10T00:00:00.000Z", records: [] });
  const page = renderToStaticMarkup(await DatabasePage());
  expect(page).toContain('id="reading"');
  expect(page).toContain("How to read these numbers");
  // The four tiers, in the site's own words.
  expect(page).toContain("3 of 3 installs agree");
  expect(page).toContain("Not recorded");
  expect(page).toContain("Measured zero");
  expect(page).toContain("methodology page");
  expect(page).toContain('href="/methodology"');
});

// The Copy for AI text on the five kinds the database indexes first: the name and kind first, the page's own address
// last, whatever the page puts between them.
const props = (id: string) => ({ params: Promise.resolve({ id }) });
const copied = (html: string) => (/<pre data-open-data="true">([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? "").split("\n");
const kinds = [
  { kind: "npc", head: "Rabbit (npc 721)", path: "/database/npcs/721", page: () => Npc(props("721")) },
  { kind: "object", head: "Copper Vein (object 1731)", path: "/database/objects/1731", page: () => ObjectPage(props("1731")) },
  { kind: "quest", head: "Rude Awakening (quest 363)", path: "/database/quests/363", page: () => Quest(props("363")) },
  { kind: "spell", head: "Blizzard (spell 10)", path: "/database/spells/10", page: () => Spell(props("10")) },
  { kind: "item", head: "Item 117 (item 117)", path: "/database/items/117", page: () => Item(props("117")) },
];

test.each(kinds)("the $kind page's copy text starts with its name and ends with its source address", async ({ head, path, page }) => {
  store.loadCorpus.mockResolvedValue({ uploads: 3, dataAsOf: "2026-11-10T00:00:00Z", records: ["one", "two", "three"].flatMap((installId) => [
    { kind: "npc_sighting", installId, npcId: 721, name: "Rabbit", mapId: 1426, x: 50, y: 50, positionKind: "npc" },
    { kind: "quest", installId, questId: 363, title: "Rude Awakening", level: 1 },
    { kind: "object_sighting", installId, objectId: 1731, name: "Copper Vein", mapId: 1426, x: 50, y: 50 },
  ]) });
  const lines = copied(renderToStaticMarkup(await page()));
  expect(lines[0]).toBe(head);
  expect(lines.at(-1)).toBe(`Source: https://everloot.app${path}`);
  // Something sits between the two: the page's own In short lines.
  expect(lines.length).toBeGreaterThan(2);
});
