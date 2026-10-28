import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
const params = { ruleset: "forever", realm: "forever-pioneer", name: "thrallina" };

test("with the switch off every page is a 404 and the store is never asked", async () => {
  const spy = vi.spyOn(holder.store!, "search");
  const get = vi.spyOn(holder.store!, "get");
  const { default: Search } = await import("./page");
  const { default: Player, generateMetadata } = await import("./[ruleset]/[realm]/[name]/page");
  const { default: OptOut } = await import("./opt-out/page");
  await expect(Search({ searchParams: Promise.resolve({ q: "thr" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(Player({ params: Promise.resolve(params) })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(OptOut({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(await generateMetadata({ params: Promise.resolve(params) })).toMatchObject({ robots: { index: false } });
  expect(spy).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

test("a character page shows what the row holds, a hide link and nothing else about the player", async () => {
  on();
  const { default: Player } = await import("./[ruleset]/[realm]/[name]/page");
  const html = renderToStaticMarkup(await Player({ params: Promise.resolve(params) }));
  expect(html).toContain("Thrallina");
  expect(html).toContain("Level 24 Undead Shaman");
  expect(html).toContain("Night Watch");
  expect(html).toContain("2026-10-20");
  expect(html).toContain('href="/players/opt-out?realm=Forever%20Pioneer&amp;name=Thrallina"');
  expect(html).not.toMatch(/\b\d{2}:\d{2}\b/);
});

test("a character that is not stored, or was hidden, is a 404", async () => {
  on();
  const { default: Player } = await import("./[ruleset]/[realm]/[name]/page");
  await expect(Player({ params: Promise.resolve({ ...params, name: "nobody" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  await holder.store!.suppress("Forever Pioneer", "Thrallina");
  await expect(Player({ params: Promise.resolve(params) })).rejects.toThrow("NEXT_NOT_FOUND");
});

test("a malformed name, realm or ruleset is a 404 and the store is never asked", async () => {
  on();
  const get = vi.spyOn(holder.store!, "get");
  const { default: Player, generateMetadata } = await import("./[ruleset]/[realm]/[name]/page");
  for (const bad of [{ ...params, name: "y" }, { ...params, name: "thrall1" }, { ...params, realm: "x" }, { ...params, realm: "forever%20pioneer" }, { ...params, ruleset: "for.ever" }, { ...params, name: "%E0%A4%A" }]) {
    await expect(Player({ params: Promise.resolve(bad) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata({ params: Promise.resolve(bad) })).toMatchObject({ title: "Page not found", robots: { index: false } });
  }
  expect(get).not.toHaveBeenCalled();
});

test("a store that cannot answer renders the unavailable sentence, not a crash, and the page stays out of search engines", async () => {
  on();
  vi.spyOn(holder.store!, "get").mockRejectedValue(new Error("Player storage unavailable (500)"));
  const { default: Player, generateMetadata } = await import("./[ruleset]/[realm]/[name]/page");
  const html = renderToStaticMarkup(await Player({ params: Promise.resolve(params) }));
  expect(html).toContain("Player storage is unreachable right now");
  expect(html).not.toContain("Thrallina");
  expect(await generateMetadata({ params: Promise.resolve(params) })).toMatchObject({ robots: { index: false } });
});

test("the character page is a profile card: class in its colour, each fact labelled, the realm in the trail", async () => {
  on();
  const { default: Player } = await import("./[ruleset]/[realm]/[name]/page");
  const html = renderToStaticMarkup(await Player({ params: Promise.resolve(params) }));
  expect(html).toContain('data-facts="grid"');
  expect(html).toMatch(/text-class-shaman">Shaman</);
  expect(html).toContain("Last seen 2026-10-20");
  expect(html).toContain("Forever Pioneer");
});

test("pages stay out of search engines until the second switch is set, and a search result page always does", async () => {
  on();
  const { generateMetadata } = await import("./[ruleset]/[realm]/[name]/page");
  const { generateMetadata: searchMetadata } = await import("./page");
  expect(await generateMetadata({ params: Promise.resolve(params) })).toMatchObject({ robots: { index: false, follow: false } });
  vi.stubEnv("EVERLOOT_PLAYER_PAGES_INDEX", "1");
  expect(await generateMetadata({ params: Promise.resolve(params) })).toMatchObject({ robots: { index: true } });
  expect(await searchMetadata({ searchParams: Promise.resolve({ q: "thr" }) })).toMatchObject({ robots: { index: false } });
  expect(await searchMetadata({ searchParams: Promise.resolve({}) })).toMatchObject({ robots: { index: true } });
});

test("search finds a name prefix, links each result and offers to hide it", async () => {
  on();
  const { default: Search } = await import("./page");
  const html = renderToStaticMarkup(await Search({ searchParams: Promise.resolve({ q: "thr" }) }));
  expect(html).toContain('href="/players/forever/forever-pioneer/thrallina"');
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
