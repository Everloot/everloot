import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";

const held = vi.hoisted(() => ({ store: null as PlayerStore | null }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => held.store }));
vi.mock("@/lib/names", () => ({ loadNames: async () => ({ items: new Map(), npcs: new Map(), quests: new Map(), objects: new Map() }) }));
vi.mock("@/lib/shown-search-names", () => ({ loadShownSearchNames: async () => ({ items: new Map(), npcs: new Map(), quests: new Map(), objects: new Map() }) }));
vi.mock("@/lib/shown-item-names", () => ({ loadShownNames: async () => ({}) }));
vi.mock("@/lib/item-icons", () => ({ shownItemIcons: async () => new Map() }));
vi.mock("@/lib/objects", () => ({ loadObjectFacts: async () => ({ rates: [], measuredZeros: [], names: [], unreachable: false }) }));

import { GET } from "./route";
import { GET as suggestGET } from "../suggest/route";

beforeEach(async () => {
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  held.store = createMemoryPlayerStore();
  await held.store.upsert([{ name: "Zuljinna", realm: "Forever Pioneer", race: "Troll", class: "HUNTER", level: 12, seen: "2026-10-20" }]);
});
afterEach(() => { vi.unstubAllEnvs(); });

const ask = (q: string) => GET(new Request(`https://everloot.app/search/people?q=${encodeURIComponent(q)}`));

test("characters are never stored outside the server, and never indexed", async () => {
  const res = await ask("zulj");
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
  const body = await res.json();
  expect(body.characters.results).toEqual([
    { type: "character", label: "Zuljinna", href: "/players/forever/forever-pioneer/zuljinna", meta: "Level 12 Hunter · Forever Pioneer", exact: false },
  ]);
});

test("a hidden character is gone from the very next answer", async () => {
  await held.store!.suppress("Forever Pioneer", "Zuljinna");
  expect((await (await ask("zulj")).json()).characters.results).toEqual([]);
});

test("the publicly cached type-ahead route never carries a character", async () => {
  const res = await suggestGET(new Request("https://everloot.app/search/suggest?q=zuljinna"));
  expect(res.headers.get("cache-control")).toContain("public");
  expect(JSON.stringify(await res.json())).not.toContain("Zuljinna");
});

test("an empty or overlong text asks nothing", async () => {
  const search = vi.spyOn(held.store!, "search");
  const none = { results: [], total: 0, capped: false };
  expect(await (await ask("")).json()).toEqual({ q: "", characters: none, guilds: none });
  expect((await ask("z".repeat(500))).status).toBe(400);
  expect(search).not.toHaveBeenCalled();
});
