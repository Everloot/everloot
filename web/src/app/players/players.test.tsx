import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const holder = vi.hoisted(() => ({ store: null as PlayerStore | null }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => holder.store }));

const player = { name: "Thrallina", realm: "Forever Pioneer", race: "Scourge", class: "SHAMAN", level: 24, guild: "Night Watch", seen: "2026-10-20" };

beforeEach(async () => {
  holder.store = createMemoryPlayerStore();
  await holder.store.upsert([player]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const on = () => vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");

test("with the switch off the search and the hide form are 404s and the store is never asked", async () => {
  const spy = vi.spyOn(holder.store!, "search");
  const { default: Search } = await import("./page");
  const { default: OptOut } = await import("./opt-out/page");
  await expect(Search({ searchParams: Promise.resolve({ q: "thr" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(OptOut({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(spy).not.toHaveBeenCalled();
});

describe("the old character address", () => {
  const go = async (path: string, method: "GET" | "HEAD" = "GET") => {
    const route = await import("./[ruleset]/[realm]/[name]/route");
    return route[method](new Request(`https://everloot.app${path}`, { method }));
  };

  test("answers a temporary 307, kept an hour at most, with the character's one page, switch on or off, and reads nothing", async () => {
    const get = vi.spyOn(holder.store!, "get");
    for (const value of ["1", ""]) {
      vi.stubEnv("EVERLOOT_PLAYER_PAGES", value);
      const res = await go("/players/forever/forever-pioneer/thrallina");
      expect(res.status).toBe(307);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(res.headers.get("location")).toBe("https://everloot.app/characters/forever/forever-pioneer/thrallina");
    }
    const head = await go("/players/forever/forever-pioneer/thrallina", "HEAD");
    expect(head.status).toBe(307);
    expect(head.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(get).not.toHaveBeenCalled();
  });

  test("keeps the encoded segments exactly as they were sent, and the query", async () => {
    for (const path of [
      "/players/forever/mal'ganis/thrallina",
      "/players/forever/%C3%A9b%C3%A8ne%2Ftwo/%C3%B8rn",
      "/players/forever/Forever-Pioneer/THRALLINA",
      "/players/forever/forever%20pioneer/thrallina",
    ]) {
      const location = (await go(path)).headers.get("location");
      expect(location).toBe(`https://everloot.app${path.replace("/players/", "/characters/")}`);
    }
    expect((await go("/players/forever/forever-pioneer/thrallina?utm_source=x")).headers.get("location"))
      .toBe("https://everloot.app/characters/forever/forever-pioneer/thrallina?utm_source=x");
  });
});

test("a search result page always stays out of search engines; the bare search page follows the index switch", async () => {
  on();
  const { generateMetadata: searchMetadata } = await import("./page");
  expect(await searchMetadata({ searchParams: Promise.resolve({}) })).toMatchObject({ robots: { index: false } });
  vi.stubEnv("EVERLOOT_PLAYER_PAGES_INDEX", "1");
  expect(await searchMetadata({ searchParams: Promise.resolve({ q: "thr" }) })).toMatchObject({ robots: { index: false } });
  expect(await searchMetadata({ searchParams: Promise.resolve({}) })).toMatchObject({ robots: { index: true } });
});

test("search finds a name prefix, links each result and offers to hide it", async () => {
  on();
  const { default: Search } = await import("./page");
  const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q: "thr" }) }));
  expect(html).toContain('href="/characters/forever/forever-pioneer/thrallina"');
  expect(html).toContain("Level 24 Undead Shaman");
  expect(html).toContain("/players/opt-out?realm=Forever%20Pioneer");
  expect(html).toContain('action="/players"');
  expect(html).toContain('role="search"');
  expect(html).toMatch(/text-class-shaman">Shaman</);
  expect(html).toContain("Night Watch");
});

test("a one-letter or malformed search never reaches the store", async () => {
  on();
  const search = vi.spyOn(holder.store!, "search");
  const { default: Search } = await import("./page");
  for (const q of ["t", "th%", "a b", "x1"]) {
    const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q }) }));
    expect(html).toContain("Type 2 to 12 letters");
  }
  expect(search).not.toHaveBeenCalled();
});

test("the hide form posts without JavaScript and fills in the character from the link", async () => {
  on();
  const { default: OptOut } = await import("./opt-out/page");
  const html = renderToStaticMarkup(await OptOut({ searchParams: Promise.resolve({ name: "Thrallina", realm: "Forever Pioneer" }) }));
  expect(html).toContain('action="/api/players/opt-out"');
  expect(html).toContain('method="post"');
  expect(html).toContain('value="Thrallina"');
  expect(html).toContain("do not need an account");
});
