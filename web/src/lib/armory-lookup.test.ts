import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ForeverApi, type Region } from "../../../kb/src/armory/api";
import { armoryLookupOn, browserLookup, LOOKUP_BUDGET_MS, lookupCharacter, lookupSlug, type LookupDeps } from "./armory-lookup";
import { createMemoryArmoryStore, type MemoryArmoryStore } from "./armory-store";
import { PEOPLE_PAGE_TIMEOUT_MS } from "@/app/search/PeopleResults";

// Invented characters and guild; no game names.
const profile = (region: Region) => ({
  id: region === "us" ? 901 : 904, slug: "volvik-morningstar", name: "Volvik", surname: "Morningstar", level: region === "us" ? 31 : 60,
  ruleset: { id: 1, name: "PvP" }, race: { id: 1, name: "Human" }, character_class: { id: 1, name: "Warrior" }, faction: { name: "Alliance" },
  guild: { id: 77, name: "Dawn Watch", key: { href: `https://${region}.api.blizzard.com/data/wow/guild/dawn-watch?namespace=profile-forever-${region}` } },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Blizzard in memory: the slugs each region knows, every call it was asked, and an optional hang. */
function blizzard(known: Partial<Record<Region, boolean>>, opts: { hang?: boolean; slowDetailsMs?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "oauth.battle.net") return json({ access_token: "test-token", expires_in: 86_400 });
    const region = url.host.split(".")[0] as Region;
    calls.push(`${region} ${url.pathname}`);
    if (opts.hang) return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    if (!known[region]) return new Response(null, { status: 404 });
    const details = url.pathname.endsWith("/equipment") || url.pathname.endsWith("/pvp-summary");
    if (details && opts.slowDetailsMs) await new Promise((resolve) => setTimeout(resolve, opts.slowDetailsMs));
    if (url.pathname.endsWith("/equipment")) return json({ equipped_items: [] });
    if (url.pathname.endsWith("/pvp-summary")) return json({ honorable_kills: 12, pvp_rank: 0 });
    return json(profile(region));
  });
  const api = (region: Region) => new ForeverApi({ clientId: "test-id", clientSecret: "test-secret", region, fetchImpl: fetchImpl as typeof fetch });
  return { calls, fetchImpl, api };
}

let store: MemoryArmoryStore;
let admitted: number;
const deps = (b: ReturnType<typeof blizzard>, extra: Partial<LookupDeps> = {}): LookupDeps => ({
  store, admit: async () => { admitted += 1; return true; }, api: b.api, ...extra,
});

beforeEach(() => { store = createMemoryArmoryStore(); admitted = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("a US hit is read in three calls, stored as the crawler stores it, and its guild queued", async () => {
  const b = blizzard({ us: true, eu: true });
  const hit = await lookupCharacter("Volvik Morningstar", deps(b));
  expect(hit).toEqual({ region: "us", slug: "volvik-morningstar", name: "Volvik", surname: "Morningstar", level: 31, class: "Warrior", race: "Human", ruleset: "PvP", guildName: "Dawn Watch" });
  expect(b.calls.sort()).toEqual(["us /profile/wow/character/volvik-morningstar", "us /profile/wow/character/volvik-morningstar/equipment", "us /profile/wow/character/volvik-morningstar/pvp-summary"]);
  expect((await store.character("us", "volvik-morningstar"))?.honorableKills).toBe(12);
  expect(await store.character("eu", "volvik-morningstar")).toBeNull();
  expect(store.queued()).toEqual([{ region: "us", kind: "guild", slug: "dawn-watch", source: "character" }]);
  expect(admitted).toBe(1);
});

test("a US miss then an EU hit is four calls, and the EU character is the one stored", async () => {
  const b = blizzard({ eu: true });
  const hit = await lookupCharacter("  volvik   MORNINGSTAR ", deps(b));
  expect(hit).toMatchObject({ region: "eu", slug: "volvik-morningstar", level: 60 });
  expect(b.calls).toHaveLength(4);
  expect(b.calls[0]).toBe("us /profile/wow/character/volvik-morningstar");
  expect(b.calls.slice(1).every((c) => c.startsWith("eu "))).toBe(true);
  expect(await store.character("eu", "volvik-morningstar")).not.toBeNull();
  expect(await store.character("us", "volvik-morningstar")).toBeNull();
});

test("a name neither region knows is kept as a miss and not asked for again", async () => {
  const b = blizzard({});
  expect(await lookupCharacter("Volvik Morningstar", deps(b))).toBeNull();
  expect(b.calls).toEqual(["us /profile/wow/character/volvik-morningstar", "eu /profile/wow/character/volvik-morningstar"]);
  expect(await lookupCharacter("Volvik Morningstar", deps(b))).toBeNull();
  expect(b.calls).toHaveLength(2);
  expect(admitted).toBe(1);
});

test("the miss runs out after six hours", async () => {
  let now = Date.parse("2026-11-17T12:00:00Z");
  store = createMemoryArmoryStore(() => new Date(now));
  await store.lookupMiss("volvik-morningstar");
  expect(await store.lookupRegions("volvik-morningstar")).toEqual([]);
  now += 6 * 3_600_000 + 1;
  expect(await store.lookupRegions("volvik-morningstar")).toEqual(["us", "eu"]);
});

test("a hidden slug is never asked for in its region, and with both hidden nothing is asked or stored", async () => {
  const b = blizzard({ us: true, eu: true });
  await store.hide("us", "volvik-morningstar");
  expect(await lookupCharacter("Volvik Morningstar", deps(b))).toMatchObject({ region: "eu" });
  expect(b.calls.some((c) => c.startsWith("us "))).toBe(false);

  store = createMemoryArmoryStore();
  admitted = 0;
  await store.hide("us", "volvik-morningstar");
  await store.hide("eu", "volvik-morningstar");
  const none = blizzard({ us: true, eu: true });
  expect(await lookupCharacter("Volvik Morningstar", deps(none))).toBeNull();
  expect(none.fetchImpl).not.toHaveBeenCalled();
  expect(admitted).toBe(0);
  expect(await store.character("us", "volvik-morningstar")).toBeNull();
});

test("a character hidden while the lookup ran is not stored or shown", async () => {
  const b = blizzard({ us: true });
  const racing = { ...store, storeLookup: async (region: string, row: Parameters<MemoryArmoryStore["storeLookup"]>[1]) => { await store.hide(region, row.slug); return store.storeLookup(region, row); } };
  expect(await lookupCharacter("Volvik Morningstar", deps(b, { store: racing }))).toBeNull();
  expect(await store.character("us", "volvik-morningstar")).toBeNull();
});

test("a used-up quota asks Blizzard nothing and keeps no miss", async () => {
  const b = blizzard({ us: true });
  expect(await lookupCharacter("Volvik Morningstar", deps(b, { admit: async () => false }))).toBeNull();
  expect(b.fetchImpl).not.toHaveBeenCalled();
  expect(await store.lookupRegions("volvik-morningstar")).toEqual(["us", "eu"]);
});

test("a quota that cannot be read counts as used up", async () => {
  const b = blizzard({ us: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await lookupCharacter("Volvik Morningstar", deps(b, { admit: async () => { throw new Error("down"); } }))).toBeNull();
  expect(b.fetchImpl).not.toHaveBeenCalled();
});

test("only a full first name and surname under the form's rules is looked up", async () => {
  const b = blizzard({ us: true });
  for (const text of ["Volvik", "Volvik M", "Volvik Morningstar Third", "Vo1vik Morningstar", "Volvikvolvikv Morningstar", "", "volvik-morningstar"]) {
    expect(lookupSlug(text)).toBeNull();
    expect(await lookupCharacter(text, deps(b))).toBeNull();
  }
  expect(b.fetchImpl).not.toHaveBeenCalled();
  expect(lookupSlug("Ølvir Stål")).toBe("ølvir-stål");
});

test("a slow Blizzard answers null within the budget, keeps no miss, and stores nothing", async () => {
  const b = blizzard({ us: true }, { hang: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const started = Date.now();
  expect(await lookupCharacter("Volvik Morningstar", deps(b, { budgetMs: 50 }))).toBeNull();
  expect(Date.now() - started).toBeLessThan(1000);
  expect(await store.lookupRegions("volvik-morningstar")).toEqual(["us", "eu"]);
  expect(await store.character("us", "volvik-morningstar")).toBeNull();
  // The answer's wait stays inside what the /search page waits for it.
  expect(LOOKUP_BUDGET_MS).toBeLessThan(PEOPLE_PAGE_TIMEOUT_MS);
});

test("a character found after the deadline is still stored after the answer, and the next search lists it", async () => {
  const b = blizzard({ us: true, eu: true }, { slowDetailsMs: 80 });
  const later: Promise<unknown>[] = [];
  const hit = await lookupCharacter("Volvik Morningstar", deps(b, { budgetMs: 30, background: (work) => later.push(work) }));
  expect(hit).toBeNull();
  expect(later).toHaveLength(1);
  await Promise.all(later);
  expect(await store.character("us", "volvik-morningstar")).not.toBeNull();
  // The EU was never asked and no miss was kept: the found character ends the lookup.
  expect(b.calls.some((c) => c.startsWith("eu "))).toBe(false);
  expect(await store.lookupRegions("volvik-morningstar")).toEqual(["eu"]);
  expect(admitted).toBe(1);
});

test("a name no region knows that answers after the deadline keeps no miss and asks no further region", async () => {
  const b = blizzard({});
  const later: Promise<unknown>[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const api = (region: Region) => {
    const real = b.api(region);
    return { get: async (path: string, ns: "profile") => { await gate; return real.get(path, ns); } };
  };
  expect(await lookupCharacter("Volvik Morningstar", deps(b, { api, budgetMs: 20, background: (work) => later.push(work) }))).toBeNull();
  release();
  await Promise.all(later);
  expect(b.calls).toEqual(["us /profile/wow/character/volvik-morningstar"]);
  expect(await store.lookupRegions("volvik-morningstar")).toEqual(["us", "eu"]);
});

test("a Blizzard error is not kept as a miss", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).includes("oauth") ? json({ access_token: "t", expires_in: 86_400 }) : new Response(null, { status: 503 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const api = (region: Region) => new ForeverApi({ clientId: "a", clientSecret: "b", region, fetchImpl: fetchImpl as typeof fetch });
  expect(await lookupCharacter("Volvik Morningstar", { store, admit: async () => true, api })).toBeNull();
  expect(await store.lookupRegions("volvik-morningstar")).toEqual(["us", "eu"]);
});

test("a refused token makes the next lookup build a fresh client", async () => {
  const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const forgetApi = vi.fn();
  const api = (region: Region) => new ForeverApi({ clientId: "a", clientSecret: "b", region, fetchImpl: fetchImpl as typeof fetch });
  expect(await lookupCharacter("Volvik Morningstar", { store, admit: async () => true, api, forgetApi })).toBeNull();
  expect(forgetApi).toHaveBeenCalledOnce();
});

test("the switch is off by default and needs the armory on", () => {
  expect(armoryLookupOn({})).toBe(false);
  expect(armoryLookupOn({ EVERLOOT_ARMORY_LOOKUP: "1" })).toBe(false);
  expect(armoryLookupOn({ EVERLOOT_ARMORY: "1" })).toBe(false);
  expect(armoryLookupOn({ EVERLOOT_ARMORY: "1", EVERLOOT_ARMORY_LOOKUP: "1" })).toBe(true);
});

test("only a browser's own fetch may look up; crawlers, scripts and page loads may not", () => {
  const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36";
  const req = (headers: Record<string, string>) => new Request("https://everloot.app/search/people?q=a&lookup=1", { headers });
  const own = { "user-agent": browser, "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" };
  expect(browserLookup(req(own))).toBe(true);
  expect(browserLookup(req({ ...own, "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }))).toBe(false);
  expect(browserLookup(req({ ...own, "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)" }))).toBe(false);
  expect(browserLookup(req({ ...own, "user-agent": "Mozilla/5.0 HeadlessChrome/142.0" }))).toBe(false);
  expect(browserLookup(req({ ...own, "user-agent": "curl/8.9.1" }))).toBe(false);
  expect(browserLookup(req({ ...own, "sec-fetch-site": "cross-site" }))).toBe(false);
  expect(browserLookup(req({ ...own, "sec-fetch-dest": "document" }))).toBe(false);
  expect(browserLookup(req({ "user-agent": browser }))).toBe(false);
});
