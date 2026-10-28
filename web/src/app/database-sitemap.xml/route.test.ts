import type { Metadata } from "next";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus },
}));
// Source-backed item names; none unless a test sets them.
const names = vi.hoisted(() => ({ matched: null as unknown }));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadItemNames: async () => names.matched,
  loadQuestNames: async () => null,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, permanentRedirect: () => {} }));

import { GET as index } from "./route";
import { GET as chunk } from "../database-sitemap/[n]/route";
import { DATABASE_CHUNK } from "@/lib/database-sitemap";

const matched = (ids: number[]) => ({
  version: "1.60.1.70450",
  wiki: { name: "Warcraft Wiki", url: "https://warcraft.wiki.gg" },
  names: new Map(ids.map((id) => [id, { name: `Wiki name ${id}`, color: "#ffffff", wikiPage: `https://warcraft.wiki.gg/wiki/W${id}` }])),
});

// Three installs agree on: item 9's name and its drop (with item 10) from NPC 77, NPC 77's name and spot,
// quest 5, vendor 99's price for item 9, and a loot window from object 1731. Two installs only report item 11's
// name and NPC 78: not enough for either page.
const three = ["install-a", "install-b", "install-c"];
const records = [
  ...three.flatMap((installId, i) => {
    const base = { installId, capturedAt: "2026-10-09T00:00:00.000Z", sourceEvidence: "loot-api" };
    return [
      ...[0, 1, 2, 3].map((k) => ({ ...base, kind: "loot", eventId: `${installId}:77:${k}`, sourceNpcId: 77, items: k === 0 ? [{ itemId: 9, count: 1 }, { itemId: 10, count: 1 }] : [] })),
      { ...base, kind: "loot", eventId: `${installId}:1731`, sourceObjectId: 1731, items: [{ itemId: 2770, count: 1 }] },
      { ...base, eventId: `name-${i}`, kind: "item_seen", itemId: 9, name: "Warchief's Blade" },
      { ...base, eventId: `npc-${i}`, kind: "npc_sighting", npcId: 77, name: "Thrall", mapId: 1411, x: 50 + i, y: 50, positionKind: "npc" },
      { ...base, eventId: `quest-${i}`, kind: "quest", questId: 5, title: "Return to Sender", level: 10, giverNpcId: 77, turnInNpcId: 77, rewardItemIds: [9] },
      { ...base, eventId: `vendor-${i}`, kind: "vendor", vendorNpcId: 99, items: [{ itemId: 9, priceCopper: 25 }] },
    ];
  }),
  ...["install-a", "install-b"].flatMap((installId, i) => [
    { installId, capturedAt: "2026-10-09T00:00:00.000Z", eventId: `two-${i}`, kind: "item_seen", itemId: 11, name: "Two Votes" },
    { installId, capturedAt: "2026-10-09T00:00:00.000Z", eventId: `npc78-${i}`, kind: "npc_sighting", npcId: 78, name: "Half Known", mapId: 1411, x: 10, y: 10, positionKind: "npc" },
  ]),
];

beforeEach(() => { store.loadCorpus.mockReset().mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-10-09T00:00:00.000Z" }); });
afterEach(() => { names.matched = null; });

const urls = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
const chunkAt = (n: string) => chunk(new Request("https://everloot.app/"), { params: Promise.resolve({ n }) });

test("the database sitemap lists every detail page that asks to be indexed, by type and id, and nothing else", async () => {
  names.matched = matched([2589]);
  const res = await index();
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/xml");
  expect(urls(await res.text())).toEqual(["https://everloot.app/database-sitemap/0.xml"]);
  const listed = urls(await (await chunkAt("0.xml")).text()).map((u) => new URL(u).pathname);
  expect(listed).toEqual([
    "/database/items/9", "/database/items/10", "/database/items/2589", "/database/items/2770",
    "/database/npcs/77", "/database/quests/5", "/database/objects/1731", "/database/vendors/99",
  ]);
});

test("each listed page's own robots metadata says index, and the left-out ones say noindex", async () => {
  names.matched = matched([2589]);
  const listed = urls(await (await chunkAt("0.xml")).text()).map((u) => new URL(u).pathname);
  const pages = {
    items: () => import("../database/items/[id]/page"),
    npcs: () => import("../database/npcs/[id]/page"),
    quests: () => import("../database/quests/[id]/page"),
    objects: () => import("../database/objects/[id]/page"),
    vendors: () => import("../database/vendors/[id]/page"),
  } as const;
  const robots = async (path: string) => {
    const [, , kind, id] = path.split("/") as [string, string, keyof typeof pages, string];
    const { generateMetadata } = await pages[kind]();
    const meta: Metadata = await generateMetadata({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    return meta.robots;
  };
  for (const path of listed) expect(await robots(path), path).toMatchObject({ index: true });
  for (const path of ["/database/items/11", "/database/npcs/78", "/database/items/118"]) expect(await robots(path), path).toMatchObject({ index: false });
});

test("past 40,000 pages the index points at a second chunk; a chunk past the end is a 404", async () => {
  names.matched = matched(Array.from({ length: DATABASE_CHUNK + 1 }, (_, i) => i + 20_000));
  const files = urls(await (await index()).text());
  expect(files).toEqual(["https://everloot.app/database-sitemap/0.xml", "https://everloot.app/database-sitemap/1.xml"]);
  expect(urls(await (await chunkAt("0.xml")).text())).toHaveLength(DATABASE_CHUNK);
  // 3 reported items and 40,001 named ones: the last 4 items, then the NPC, quest, object and vendor.
  expect(urls(await (await chunkAt("1.xml")).text())).toHaveLength(8);
  expect((await chunkAt("2.xml")).status).toBe(404);
  expect((await chunkAt("x.xml")).status).toBe(404);
});

test("a current-build item named only in the files is listed and its page asks to be indexed", async () => {
  names.matched = {
    ...matched([]),
    names: new Map([[25, { name: "Worn Shortsword", color: "#ffffff", wikiPage: null, source: "files" }]]),
  };
  const listed = urls(await (await chunkAt("0.xml")).text()).map((u) => new URL(u).pathname);
  const { generateMetadata } = await import("../database/items/[id]/page");
  const meta = await generateMetadata({ params: Promise.resolve({ id: "25" }), searchParams: Promise.resolve({}) });
  expect({ listed: listed.includes("/database/items/25"), robots: meta.robots }).toMatchObject({ listed: true, robots: { index: true } });
  expect(listed).not.toContain("/database/items/118");
});

test("a file-named item stays indexable during an upload outage while the sitemap answers 503", async () => {
  names.matched = {
    ...matched([]),
    names: new Map([[25, { name: "Worn Shortsword", color: "#ffffff", wikiPage: null, source: "files" }]]),
  };
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const { generateMetadata } = await import("../database/items/[id]/page");
  const meta = await generateMetadata({ params: Promise.resolve({ id: "25" }), searchParams: Promise.resolve({}) });
  expect(meta.robots).toMatchObject({ index: true });
  expect((await chunkAt("0.xml")).status).toBe(503);
});

test("unreadable upload storage is a 503, not a short list", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  for (const res of [await index(), await chunkAt("0.xml")]) {
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
});
