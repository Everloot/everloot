import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: {
    loadCorpus: async () => ({ uploads: 3, dataAsOf: "2026-11-10T00:00:00Z", records: ["one", "two", "three"].flatMap((installId) => [
      { kind: "npc_sighting", installId, npcId: 721, name: "Rabbit", mapId: 1426, x: 50, y: 50, positionKind: "npc" },
      { kind: "npc_sighting", installId, npcId: 3934, name: "Innkeeper Boorand Plainswind", mapId: 1413, x: 50, y: 50, positionKind: "npc" },
      { kind: "vendor", installId, vendorNpcId: 3934, items: [{ itemId: 117, priceCopper: 25 }] },
      { kind: "quest", installId, questId: 363, title: "Rude Awakening", level: 1 },
      { kind: "object_sighting", installId, objectId: 1731, name: "Copper Vein", mapId: 1426, x: 50, y: 50 },
    ]) }),
    loadCompletion: async () => ({ state: null, dataAsOf: null, unreachable: true }),
  },
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => null,
  loadQuestNames: async () => null,
  loadSpellNames: async () => ({ version: "1.60.1.70862", names: new Map([[10, "Blizzard"]]) }),
}));
vi.mock("@/lib/release", () => ({ getRelease: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  useRouter: () => ({ push: () => {} }),
}));

import Item from "./items/[id]/page";
import Npc from "./npcs/[id]/page";
import Quest from "./quests/[id]/page";
import Vendor from "./vendors/[id]/page";
import ObjectPage from "./objects/[id]/page";
import Spell from "./spells/[id]/page";
import Achievement from "./achievements/[id]/page";
import Faction from "./factions/[id]/page";
import Title from "./titles/[id]/page";
import Chain from "./quest-chains/[id]/page";
import Zone from "./zones/[zone]/page";
import Instance from "./instances/[instance]/page";

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const cases = [
  { kind: "item", id: 117, path: "/database/items/117", page: () => Item(props("117")) },
  { kind: "npc", id: 721, path: "/database/npcs/721", page: () => Npc(props("721")) },
  { kind: "quest", id: 363, path: "/database/quests/363", page: () => Quest(props("363")) },
  { kind: "vendor", id: 3934, path: "/database/vendors/3934", page: () => Vendor(props("3934")) },
  { kind: "object", id: 1731, path: "/database/objects/1731", page: () => ObjectPage(props("1731")) },
  { kind: "spell", id: 10, path: "/database/spells/10", page: () => Spell(props("10")) },
  { kind: "achievement", id: 627, path: "/database/achievements/627-explore-dun-morogh", page: () => Achievement(props("627-explore-dun-morogh")) },
  { kind: "faction", id: 21, path: "/database/factions/21-booty-bay", page: () => Faction(props("21-booty-bay")) },
  { kind: "title", id: 144, path: "/database/titles/144-bloodsail-admiral", page: () => Title(props("144-bloodsail-admiral")) },
  { kind: "quest_chain", id: 5963, path: "/database/quest-chains/5963-to-have-loved-and-lost", page: () => Chain(props("5963-to-have-loved-and-lost")) },
  { kind: "zone", id: 1436, path: "/database/zones/1436-westfall", page: () => Zone({ params: Promise.resolve({ zone: "1436-westfall" }) }) },
  { kind: "instance", id: 36, path: "/database/instances/36-deadmines", page: () => Instance({ params: Promise.resolve({ instance: "36-deadmines" }) }) },
];

test.each(cases)("$kind page identifies its visible entity at its canonical URL", async ({ kind, id, path, page }) => {
  const html = renderToStaticMarkup(await page());
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => m[1]!);
  const entities = scripts.map((s) => JSON.parse(s)).filter((data) => data["@type"] === "WebPage");
  expect(entities).toHaveLength(1);
  const data = entities[0];
  const url = `https://everloot.app${path}`;
  expect(data).toEqual({
    "@context": "https://schema.org", "@type": "WebPage", name: expect.any(String), url,
    isPartOf: { "@id": "https://everloot.app/#website" },
    mainEntity: { "@type": "Thing", name: data.name, identifier: `${kind}:${id}`, url },
  });
  // Use React's text escaping to compare with the H1, including titles' visible <Name> slot.
  expect(html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1]).toBe(renderToStaticMarkup(<>{data.name}</>));
  for (const script of scripts) expect(script).not.toContain("<");
  if (kind === "title") {
    expect(data.name).toContain("<Name>");
    expect(scripts.join("")).toContain("\\u003cName>");
  }
});

test.each(cases)("$kind page opens with the shared entity header, and lists its facts in the one layout", async ({ page }) => {
  const html = renderToStaticMarkup(await page());
  // One title row, EntityHeader's: the h1 and its type line inside it, no list-page title row beside it.
  const headers = [...html.matchAll(/<header[^>]*data-page-header[^>]*>/g)].map((m) => m[0]);
  expect(headers).toHaveLength(1);
  expect(headers[0]).toContain("data-entity-header");
  const header = /<header[^>]*data-entity-header[^>]*>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? "";
  expect(header).toMatch(/<h1[^>]*>/);
  expect(header).toContain("data-entity-meta");
  // Quick facts, where the page has them, are the label-left, value-right list: never the card or the grid.
  for (const m of html.matchAll(/data-facts="(\w+)"/g)) expect(m[1]).toBe("list");
});


test.each(cases.filter(({ kind }) => ["item", "npc", "quest", "object", "spell", "zone"].includes(kind)))("$kind wide layout reuses the existing summary and data controls exactly once", async ({ page }) => {
  const html = renderToStaticMarkup(await page());
  expect(html.match(/data-entity-sidebar/g)).toHaveLength(1);
  expect(html.match(/aria-label="In short"/g)).toHaveLength(1);
  expect(html.match(/>Copy for AI</g)).toHaveLength(1);
});
