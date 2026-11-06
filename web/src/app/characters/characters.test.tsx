import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const players = vi.hoisted(() => ({ store: null as PlayerStore | null }));
vi.mock("@/lib/player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/player-store")>()), playerStore: () => players.store }));

import { createMemoryPlayerStore, type PlayerStore } from "@/lib/player-store";
import { FOOTER_LINE } from "@/lib/character-showcase";
import { PLAYER_SIGHTING_LINE } from "@/app/players/player-view";
import * as pageModule from "./[ruleset]/[realm]/[name]/page";
import Page, { dynamic, generateMetadata } from "./[ruleset]/[realm]/[name]/page";
import { GET as wideCard } from "./[ruleset]/[realm]/[name]/card.png/route";
import { GET as squareCard } from "./[ruleset]/[realm]/[name]/card-square.png/route";

const PARAMS = { ruleset: "forever", realm: "forever-pioneer", name: "thrallina" };
const props = (p = PARAMS) => ({ params: Promise.resolve(p) });
const card = (get: typeof wideCard, p = PARAMS) => get(new Request("https://everloot.app/x"), props(p));
const render = async (p = PARAMS) => renderToStaticMarkup(await Page(props(p)));

const USER_ID = "11111111-2222-4333-8444-555555555555";
/** What public_character returns, plus what it must never send; the page keeps only the identity columns. */
const ROW = {
  name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", faction: "Horde", level: 24,
  linked_at: "2026-10-21T18:00:00+00:00", last_upload_at: "2026-10-30T18:00:00+00:00",
  show_gear: false, show_collections: false, show_gold: false, show_guild: false, indexable: true,
  user_id: USER_ID, link_key: "a".repeat(64), completion_ref: "b".repeat(64), handle: "thrall-fan", battletag: "Thrall#1234", api_key: `evl_${"c".repeat(64)}`,
};

async function pngSize(res: Response): Promise<{ width: number; height: number }> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

beforeEach(() => {
  players.store = createMemoryPlayerStore();
  vi.stubEnv("EVERLOOT_SHOWCASE", "1");
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  vi.stubEnv("SUPABASE_URL", "");
  auth.getUser.mockReset();
  auth.authQuery.mockReset().mockResolvedValue([ROW]);
  vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z"), toFake: ["Date"] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

test("with the switch off (anything but exactly 1) the page, its metadata and both cards are 404s, and nothing is read", async () => {
  for (const value of ["", "0", "true"]) {
    vi.stubEnv("EVERLOOT_SHOWCASE", value);
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(props())).toMatchObject({ robots: { index: false } });
    expect((await card(wideCard)).status).toBe(404);
    expect((await card(squareCard)).status).toBe(404);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

describe("a public character", () => {
  test("the page shows the identity from the link row and its upload date, and never says verified or owner", async () => {
    const html = await render();
    expect(auth.authQuery).toHaveBeenCalledWith("rpc/public_character", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(auth.authQuery.mock.calls[0][1].body)).toEqual({ p_ruleset: "forever", p_realm_slug: "forever-pioneer", p_name: "thrallina" });
    expect(html).toContain("Thrallina");
    expect(html).toContain("Level 24 Orc Shaman · Forever Pioneer");
    expect(html).toContain('data-section="identity"');
    expect(html).toContain("From the player&#x27;s own addon upload, 2026-10-30 (2 days ago)");
    expect(html).toContain("Not checked against Blizzard");
    // Identity only: no other section, and no sample banner.
    for (const key of ["gear", "talents", "professions", "reputations", "raids", "collections"]) expect(html).not.toContain(`data-section="${key}"`);
    expect(html).not.toContain("data-sample");
    expect(html).not.toMatch(/verified|owner|proven|✓/i);
    // Someone whose character this really is can hide it without an account.
    expect(html).toContain('href="/players/opt-out?realm=Forever%20Pioneer&amp;name=Thrallina"');
  });

  test("no account id, handle, BattleTag, key or hash reaches the HTML or the metadata", async () => {
    const html = await render();
    const meta = JSON.stringify(await generateMetadata(props()));
    for (const secret of [USER_ID, "thrall-fan", "Thrall#1234", "a".repeat(64), "b".repeat(64), "evl_", "link_key", "completion_ref"]) {
      expect(html).not.toContain(secret);
      expect(meta).not.toContain(secret);
    }
  });

  test("every page is noindex, even with the link's indexable switch on, and points its card at the canonical address", async () => {
    const meta = await generateMetadata(props({ ruleset: "forever", realm: "Forever-Pioneer", name: "THRALLINA" }));
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBe("/characters/forever/forever-pioneer/thrallina");
    expect(JSON.stringify(meta.openGraph)).toContain("/characters/forever/forever-pioneer/thrallina/card.png");
  });

  test("both cards draw at their sizes, uncached and noindex", async () => {
    const wide = await card(wideCard);
    expect(wide.status).toBe(200);
    expect(wide.headers.get("content-type")).toBe("image/png");
    expect(wide.headers.get("cache-control")).toBe("no-store");
    expect(wide.headers.get("x-robots-tag")).toBe("noindex");
    expect(await pngSize(wide)).toEqual({ width: 1200, height: 630 });
    expect(await pngSize(await card(squareCard))).toEqual({ width: 1080, height: 1080 });
  });
});

describe("no public row", () => {
  // public_character answers no row alike for a page switched off, a frozen link, a hidden character and an unlinked
  // one (supabase/tests/character_links.sql checks each); the page and both cards are then 404s.
  test("the page and both cards are 404s, uncached", async () => {
    auth.authQuery.mockResolvedValue([]);
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(props())).toEqual({ title: "Page not found", robots: { index: false, follow: false } });
    for (const get of [wideCard, squareCard]) {
      const res = await card(get);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("an address that cannot be a character is a 404 without a request", async () => {
    for (const p of [{ ...PARAMS, ruleset: "Forever!" }, { ...PARAMS, realm: "a" }, { ...PARAMS, realm: "has%20space" }, { ...PARAMS, name: "x" }, { ...PARAMS, name: "%E0%A4%A" }]) {
      await expect(Page(props(p))).rejects.toThrow("NEXT_NOT_FOUND");
      expect((await card(wideCard, p)).status).toBe(404);
    }
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("storage failing says so on the page and is a 503 for the card, never a page with nothing in it", async () => {
    auth.authQuery.mockRejectedValue(new Error("down"));
    const html = await render();
    expect(html).toContain("unreachable right now");
    expect((await generateMetadata(props())).robots).toEqual({ index: false, follow: false });
    expect((await card(squareCard)).status).toBe(503);
  });
});

describe("planned builds (S4)", () => {
  /** What public_character_builds returns, plus fields it never sends, which must not reach the page anyway. */
  const BUILDS = [
    { name: "Levelling enh", slug: "Shared02", updated_at: "2026-10-31T09:00:00+00:00", notes: "my private note", code: "EL1-shaman-0-1.60.1.70450-MTE6NQ" },
    { name: "Raid resto", slug: "Shared01", updated_at: "2026-10-29T09:00:00+00:00" },
  ];
  const BUILDS_RPC = "rpc/public_character_builds";
  const answer = (builds: unknown) => auth.authQuery.mockImplementation(async (path: string) => {
    if (path === "rpc/public_character") return [ROW];
    if (path === BUILDS_RPC) {
      if (builds instanceof Error) throw builds;
      return builds;
    }
    throw new Error(`unexpected ${path}`);
  });
  const askedForBuilds = () => auth.authQuery.mock.calls.some(([path]) => path === BUILDS_RPC);
  const on = () => { vi.stubEnv("EVERLOOT_SHOWCASE_BUILDS", "1"); vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1"); };

  test("with the switch off, or saved builds off, nothing asks for builds and the page has no talents section", async () => {
    answer(BUILDS);
    for (const [builds, saved] of [["", "1"], ["0", "1"], ["true", "1"], ["1", ""], ["1", "0"]]) {
      vi.stubEnv("EVERLOOT_SHOWCASE_BUILDS", builds);
      vi.stubEnv("EVERLOOT_SAVED_BUILDS", saved);
      const html = await render();
      expect(html).toContain("Thrallina");
      expect(html).not.toContain('data-section="talents"');
      expect(html).not.toContain("/b/");
    }
    expect(askedForBuilds()).toBe(false);
  });

  test("with the showcase off, the builds switch alone shows nothing and reads nothing", async () => {
    on();
    vi.stubEnv("EVERLOOT_SHOWCASE", "0");
    answer(BUILDS);
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("on, the page lists the attached label's shared builds as a plan, with links and nothing else about them", async () => {
    on();
    answer(BUILDS);
    const html = await render();
    expect(JSON.parse(auth.authQuery.mock.calls.find(([path]) => path === BUILDS_RPC)![1].body))
      .toEqual({ p_ruleset: "forever", p_realm_slug: "Forever Pioneer", p_name: "Thrallina" });
    expect(html).toContain('data-section="talents"');
    expect(html).toContain("Planned builds");
    expect(html).toContain("A plan, not a record of play.");
    expect(html).toContain('href="/b/Shared02"');
    expect(html).toContain('href="/b/Shared01"');
    expect(html.indexOf("Levelling enh")).toBeLessThan(html.indexOf("Raid resto"));
    // Dated by the newest build; no in-game tree table or calculator link, since nothing was synced from the game.
    expect(html).toContain("2026-10-31");
    expect(html).not.toContain("Points per tree");
    // The talents section opens no build; the class links further down are the plain calculator, the same for anyone.
    const talents = html.slice(html.indexOf('data-section="talents"'), html.indexOf("</section>", html.indexOf('data-section="talents"')));
    expect(talents).not.toContain("/tools/talents/");
    for (const secret of ["my private note", "EL1-", USER_ID, "Thrall#1234"]) expect(html).not.toContain(secret);
    expect(html).not.toMatch(/verified|owner|proven|✓/i);
  });

  test("a hidden, opted-out, frozen or private character is a 404 and its builds are never asked for", async () => {
    on();
    // public_character answers no row for each of these (supabase/tests/character_links.sql), and
    // public_character_builds none either (supabase/tests/build_label_links.sql).
    auth.authQuery.mockImplementation(async (path: string) => (path === BUILDS_RPC ? BUILDS : []));
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(askedForBuilds()).toBe(false);
  });

  test("no builds, a malformed row or a failed read leave the talents section out and keep the page", async () => {
    on();
    for (const builds of [[], [{ name: "Bad", slug: "../x", updated_at: "2026-10-31" }, { name: "No date", slug: "Shared03" }], new Error("down")]) {
      answer(builds);
      const html = await render();
      expect(html).toContain("Thrallina");
      expect(html).not.toContain('data-section="talents"');
      expect(html).not.toContain("/b/");
    }
  });

  test("the cards never ask for builds", async () => {
    on();
    answer(BUILDS);
    expect((await card(wideCard)).status).toBe(200);
    expect((await card(squareCard)).status).toBe(200);
    expect(askedForBuilds()).toBe(false);
  });
});

describe("one page for a character: the owner's showcase and what the addon saw", () => {
  /** A sighting another player's addon sent: a different race and level than the link row, so the sources can be told apart. */
  const SEEN = { name: "Thrallina", realm: "Forever Pioneer", race: "Scourge", class: "SHAMAN", level: 22, guild: "Night Watch", seen: "2026-10-20" };
  const seen = () => players.store!.upsert([SEEN]);
  const text = async (p = PARAMS) => (await render(p)).replace(/&#x27;/g, "'");

  test("the page is drawn on every request: force-dynamic, with no revalidate window", () => {
    expect(dynamic).toBe("force-dynamic");
    expect("revalidate" in pageModule).toBe(false);
  });

  test("a sighting alone is a page: the row's facts, where they came from, the hide link and the policy", async () => {
    vi.stubEnv("EVERLOOT_SHOWCASE", "");
    await seen();
    const out = await text();
    expect(auth.authQuery).not.toHaveBeenCalled();
    expect(out).toContain('data-part="sighting"');
    expect(out).not.toContain('data-part="showcase"');
    expect(out).toContain("Level 22 Undead Shaman · Forever Pioneer");
    expect(out).toMatch(/text-class-shaman">Shaman</);
    expect(out).toContain("Night Watch");
    expect(out).toContain('Last seen <span class="font-mono">2026-10-20</span>');
    expect(out).toContain(PLAYER_SIGHTING_LINE);
    expect(out).not.toContain(FOOTER_LINE);
    expect(out).toContain('href="/players/opt-out?realm=Forever%20Pioneer&amp;name=Thrallina"');
    expect(out).toContain('href="/privacy#player-pages"');
    expect(out).not.toMatch(/\b\d{2}:\d{2}\b/);
    // Breadcrumb: Home, Characters (the search), the character.
    expect(out).toMatch(/"name":"Characters","item":"[^"]*\/players"/);
    expect(out).toMatch(/"name":"Thrallina","item":"[^"]*\/characters\/forever\/forever-pioneer\/thrallina"/);
  });

  test("a showcase alone is a page with its own source line and no sighting part", async () => {
    const out = await text();
    expect(out).toContain('data-part="showcase"');
    expect(out).not.toContain('data-part="sighting"');
    expect(out).toContain(FOOTER_LINE);
    expect(out).toContain("From the player's own addon upload, 2026-10-30 (2 days ago)");
    expect(out).not.toContain(PLAYER_SIGHTING_LINE);
  });

  test("with both, the owner's part comes first, each says where it came from, and neither borrows from the other", async () => {
    await seen();
    const out = await text();
    const owner = out.indexOf('data-part="showcase"'), sighting = out.indexOf('data-part="sighting"');
    expect(owner).toBeGreaterThan(-1);
    expect(sighting).toBeGreaterThan(owner);
    // The header and the owner's part are the link row's (Orc, level 24); the sighting's facts stay in its own part.
    expect(out).toContain("Level 24 Orc Shaman · Forever Pioneer");
    expect(out.slice(0, sighting)).not.toMatch(/Undead|Night Watch|2026-10-20/);
    expect(out.slice(sighting)).toContain("Undead");
    expect(out.slice(sighting)).not.toContain(">Orc<");
    expect(out.indexOf(FOOTER_LINE)).toBeGreaterThan(owner);
    expect(out.indexOf(FOOTER_LINE)).toBeLessThan(sighting);
    expect(out.indexOf(PLAYER_SIGHTING_LINE)).toBeGreaterThan(sighting);
    expect(out.match(/Hide this character/g)).toHaveLength(1);
  });

  test("neither is a 404 with noindex", async () => {
    auth.authQuery.mockResolvedValue([]);
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(props())).toEqual({ title: "Page not found", robots: { index: false, follow: false } });
  });

  test("with both switches off it is a 404 and neither store is asked, whatever rows exist", async () => {
    await seen();
    const get = vi.spyOn(players.store!, "get");
    vi.stubEnv("EVERLOOT_SHOWCASE", "0");
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "");
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(props())).toEqual({ title: "Page not found", robots: { index: false, follow: false } });
    expect(get).not.toHaveBeenCalled();
    expect(auth.authQuery).not.toHaveBeenCalled();
  });

  test("with the player pages off, a sighting is never read or shown, and there is no hide link", async () => {
    await seen();
    const get = vi.spyOn(players.store!, "get");
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "0");
    const out = await render();
    expect(out).toContain('data-part="showcase"');
    expect(out).not.toContain('data-part="sighting"');
    expect(out).not.toContain("Hide this character");
    auth.authQuery.mockResolvedValue([]);
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(get).not.toHaveBeenCalled();
  });

  test("a hidden character's sighting is gone at once: a 404 alone, and left out beside a showcase", async () => {
    await seen();
    await players.store!.suppress("Forever Pioneer", "Thrallina");
    expect(await render()).not.toContain('data-part="sighting"');
    auth.authQuery.mockResolvedValue([]);
    await expect(Page(props())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("always noindex, nofollow: the player pages' index switch does not reach this page", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES_INDEX", "1");
    vi.stubEnv("EVERLOOT_SHOWCASE", "");
    await seen();
    const meta = await generateMetadata(props({ ruleset: "forever", realm: "Forever-Pioneer", name: "THRALLINA" }));
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBe("/characters/forever/forever-pioneer/thrallina");
    expect(String(meta.title)).toContain("Level 22 Undead Shaman");
  });

  test("player storage failing says so in its place and keeps the owner's part", async () => {
    vi.spyOn(players.store!, "get").mockRejectedValue(new Error("Player storage unavailable (500)"));
    const out = await render();
    expect(out).toContain('data-part="showcase"');
    expect(out).toContain("Player storage is unreachable right now");
    vi.stubEnv("EVERLOOT_SHOWCASE", "");
    const alone = await render();
    expect(alone).toContain("Player storage is unreachable right now");
    expect(alone).not.toContain("Thrallina");
    expect((await generateMetadata(props())).robots).toEqual({ index: false, follow: false });
  });

  test("an address that cannot be a character never reaches the player store", async () => {
    vi.stubEnv("EVERLOOT_SHOWCASE", "");
    const get = vi.spyOn(players.store!, "get");
    for (const p of [{ ...PARAMS, name: "y" }, { ...PARAMS, name: "thrall1" }, { ...PARAMS, realm: "x" }, { ...PARAMS, realm: "forever%20pioneer" }, { ...PARAMS, ruleset: "for.ever" }, { ...PARAMS, name: "%E0%A4%A" }]) {
      await expect(Page(props(p))).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(get).not.toHaveBeenCalled();
  });
});
