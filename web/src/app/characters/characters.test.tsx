import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import Page, { generateMetadata } from "./[ruleset]/[realm]/[name]/page";
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
    expect(html).not.toContain("/tools/talents/");
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
