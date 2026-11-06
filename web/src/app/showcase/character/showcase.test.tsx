import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import ShowcaseSections, { ShowcaseHeader } from "@/components/showcase/ShowcaseSections";
import { sampleShowcase } from "@/data/showcase";
import {
  buildShowcase, EMPTY_LINE, freshnessLabel, GEAR_SLOTS, NOT_RECORDED_LINE, PRIVATE_LINE, STALE_LINE, UNSUPPORTED_LINE, type CollectionsData, type ShowcaseInput,
} from "@/lib/character-showcase";
import { renderCharacterCard } from "@/lib/og-card";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

afterEach(() => { vi.unstubAllEnvs(); });

const on = () => vi.stubEnv("EVERLOOT_SHOWCASE", "1");
const NOW = new Date("2026-11-01T12:00:00Z");

/** A PNG's width and height, from its IHDR chunk. */
async function pngSize(res: Response): Promise<{ width: number; height: number }> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** One section's markup, from its opening tag to its close. */
function section(html: string, key: string): string {
  const at = html.indexOf(`data-section="${key}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</section>", at));
}

test("with the switch off the page, its metadata and both cards are 404s", async () => {
  vi.stubEnv("EVERLOOT_SHOWCASE", "");
  const { default: Page, generateMetadata } = await import("./page");
  await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  expect(generateMetadata()).toMatchObject({ robots: { index: false } });
  const { GET: wide } = await import("./card.png/route");
  const { GET: square } = await import("./card-square.png/route");
  expect((await wide()).status).toBe(404);
  expect((await square()).status).toBe(404);
});

test("the sample page carries the banner, the header band, every section and noindex, and never says verified", async () => {
  on();
  const { default: Page, generateMetadata } = await import("./page");
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Sample data. Everything on this page is made up");
  expect(html).toContain("Examplechar");
  expect(html).toContain("Level 60 Orc Shaman");
  expect(html).toContain("&lt;Sampleguild&gt;");
  for (const key of ["identity", "gear", "stats", "talents", "raids", "collections", "reputations", "professions"]) expect(html).toContain(`data-section="${key}"`);
  expect(html).toMatch(/From the player&#x27;s own addon upload, \d{4}-\d{2}-\d{2} \(1 day ago\)/);
  expect(html).toContain('href="/database/items/1282"');
  expect(html).toContain("Item 1282");
  expect(html).toContain('href="/tools/talents/shaman"');
  // The rail lists every section and the sample's upload date.
  expect(html).toContain('href="#showcase-stats"');
  expect(html).toContain("Sample upload");
  expect(html).toContain(UNSUPPORTED_LINE);
  expect(html).toContain(STALE_LINE);
  expect(html).toContain("Not checked against Blizzard");
  expect(html).not.toMatch(/verified|owner|proven|✓/i);
  const meta = generateMetadata();
  expect(meta.robots).toEqual({ index: false, follow: false });
  expect(JSON.stringify(meta.openGraph)).toContain("/showcase/character/card.png");
  expect(JSON.stringify(meta.twitter)).toContain("/showcase/character/card.png");
});

const base = sampleShowcase(NOW);
const view = (input: ShowcaseInput = base) => buildShowcase(input, NOW);
const render = (input: ShowcaseInput, preview: boolean) => renderToStaticMarkup(<ShowcaseSections showcase={view(input)} preview={preview} />);
const header = (input: ShowcaseInput = base) => renderToStaticMarkup(<ShowcaseHeader showcase={view(input)} trail={[{ name: "Home", path: "/" }]} />);

describe("header band", () => {
  test("name in its class colour, the title, the line, guild, realm, faction, freshness and the headline numbers", () => {
    const html = header();
    expect(html).toContain('<span class="text-class-shaman">Examplechar</span>');
    expect(html).toContain("Sample Title");
    expect(html).toContain(">Level 60 Orc Shaman<");
    expect(html).toContain("&lt;Sampleguild&gt;");
    expect(html).toContain(">Showcase<");
    expect(html).toContain('data-faction="true">Horde<');
    expect(html).toContain("data-freshness");
    const headlines = html.slice(html.indexOf("data-headlines"));
    expect(headlines).toContain("Item level");
    expect(headlines).toContain(">57<");
    expect(headlines).toContain("Achievement points");
    expect(headlines).toContain(">400<");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  test("a headline shows only with its section shown; no guild, title or side is left as an empty slot", () => {
    const html = header({ ...base, title: null, guild: null, faction: null, gear: { state: "private" }, collections: { state: "unsupported" } });
    expect(html).not.toContain("data-headlines");
    expect(html).not.toContain("Item level");
    expect(html).not.toContain("data-title");
    expect(html).not.toContain("data-guild");
    expect(html).not.toContain("data-faction");
    expect(html).not.toMatch(/>0</);
  });

  test("a guild with a public page is a link", () => {
    expect(header({ ...base, guild: { name: "Sampleguild", path: "/guilds/x/y" } })).toContain('href="/guilds/x/y"');
  });
});

describe("sections", () => {
  test("each state draws its own line, and unsupported never prints a zero", () => {
    const html = render({ ...base, gear: { state: "private" }, professions: { state: "unsupported" }, raids: { state: "empty" }, stats: { state: "unsupported" } }, true);
    expect(html).toContain('data-section="gear" data-state="private"');
    expect(html).toContain(PRIVATE_LINE);
    expect(section(html, "raids")).toContain(EMPTY_LINE);
    const professions = section(html, "professions");
    expect(professions).toContain('data-state="unsupported"');
    expect(professions).toContain(UNSUPPORTED_LINE);
    expect(professions).not.toMatch(/>0</);
    // The game shows its stats; the line says the addon does not record them, never a zero.
    const stats = section(html, "stats");
    expect(stats).toContain(NOT_RECORDED_LINE);
    expect(stats).not.toMatch(/>0</);
  });

  test("the sections come in page order: the sheet, then what the character did, then standing and trades", () => {
    const html = render(base, true);
    const order = ["gear", "stats", "talents", "raids", "collections", "reputations", "professions"].map((k) => html.indexOf(`data-section="${k}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("the public page leaves out what has nothing synced or is switched off", () => {
    const html = render({ ...base, gear: { state: "private" }, raids: { state: "empty" }, professions: { state: "unsupported" } }, false);
    expect(html).not.toContain('data-section="gear"');
    expect(html).not.toContain('data-section="raids"');
    expect(html).toContain('data-section="professions" data-state="unsupported"');
    expect(html).not.toContain(EMPTY_LINE);
  });

  test("a section older than two weeks says it may be out of date", () => {
    const html = render(base, true);
    expect(section(html, "talents")).toContain(STALE_LINE);
    expect(section(html, "gear")).not.toContain(STALE_LINE);
  });
});

describe("gear as a paper doll", () => {
  const gear = () => section(render(base, true), "gear");

  test("every slot in the game's order, the left column, the right column, then the weapons; empty slots say so", () => {
    const html = gear();
    const slots = [...html.matchAll(/data-slot="(\w+)"/g)].map((m) => m[1]);
    expect(slots).toEqual(Object.keys(GEAR_SLOTS));
    for (const empty of ["shirt", "tabard", "ranged"]) {
      const at = html.indexOf(`data-slot="${empty}"`);
      expect(html.slice(at, html.indexOf("</li>", at))).toContain("Empty");
    }
    expect(html).toContain('aria-label="Armour, left column"');
    expect(html).toContain('aria-label="Weapons"');
  });

  test("each item in its quality colour, linked to its page, with its item level; no icon without the asset files", () => {
    const html = gear();
    const at = html.indexOf('data-slot="mainHand"');
    const slot = html.slice(at, html.indexOf("</li>", at));
    expect(slot).toContain('href="/database/items/864"');
    expect(slot).toContain("text-q-uncommon");
    expect(slot).toContain("Item 864");
    expect(slot).toContain(">60<");
    expect(html).not.toContain("data-game-icon");
    expect(html).toContain("Average item level");
  });

  test("an icon the page filled is drawn beside the name, decorative", () => {
    const rows = (base.gear as Extract<ShowcaseInput["gear"], { state: "shown" }>).data.map((r) => (r.slot === "head" ? { ...r, icon: "https://assets.example/icons/1.webp" } : r));
    const html = section(render({ ...base, gear: { state: "shown", asOf: "2026-10-31", data: rows } }, true), "gear");
    expect(html.match(/data-game-icon/g)).toHaveLength(1);
    expect(html).toContain('alt=""');
  });

  test("the same rows sit in a table a screen reader can follow", () => {
    const html = gear();
    expect(html).toContain("The same gear as a table");
    expect(html).toContain("Equipped gear");
  });
});

describe("the other sections", () => {
  test("stats in the game's groups", () => {
    const html = section(render(base, true), "stats");
    const groups = [...html.matchAll(/data-stat-group="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(["Attributes", "Melee", "Ranged", "Spell", "Defense"]);
    expect(html).toContain("Attack power");
  });

  test("talents: the main tree, points per tree with bars, and the calculator link", () => {
    const html = section(render(base, true), "talents");
    expect(html).toContain("Enhancement");
    expect(html).toContain("0 / 30 / 21");
    expect(html.match(/role="progressbar"/g)).toHaveLength(3);
    expect(html).toContain('href="/tools/talents/shaman"');
  });

  test("raids: this week's lockout with a boss strip and the reset day; the guild's kills labelled as the guild's", () => {
    const html = section(render(base, true), "raids");
    expect(html).toContain("Molten Core");
    expect(html).toContain('aria-label="Bosses"');
    expect(html).toContain("Lucifron: killed");
    expect(html).toContain("Ragnaros: not yet");
    expect(html).toMatch(/Resets \w+day, \d{4}-\d{2}-\d{2}/);
    expect(html).toContain("The guild&#x27;s kills, not this character&#x27;s attendance");
    expect(html).toContain("Onyxia&#x27;s Lair");
  });

  test("progress: counts, recent achievements, category bars, titles; mounts and pets a line each", () => {
    const html = section(render(base, true), "collections");
    expect(html).toContain(">Progress<");
    for (const text of ["Achievements", "Achievement points", "Quests completed", "500", "Sample Achievement One", "Achievements by category", "Exploration", "10 of 40", "Sample Second Title"]) expect(html).toContain(text);
    expect(html.match(new RegExp(UNSUPPORTED_LINE.replace(".", "\\."), "g"))).toHaveLength(2);
  });

  test("progress with no quest count says so instead of a zero", () => {
    const data = (base.collections as { data: CollectionsData }).data;
    const html = section(render({ ...base, collections: { state: "shown", asOf: "2026-10-31", data: { ...data, quests: null, recent: [], categories: [] } } }, true), "collections");
    expect(html).toContain(NOT_RECORDED_LINE);
    expect(html).not.toContain("Recent achievements");
    expect(html).not.toMatch(/>0</);
  });

  test("reputations grouped by standing, best first, renown last", () => {
    const html = section(render(base, true), "reputations");
    const groups = [...html.matchAll(/data-standing="([^"]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(["Exalted", "Revered", "Honored", "Friendly", "Renown"]);
    expect(html).toContain("6,000 / 12,000");
  });

  test("professions as rank bars", () => {
    const html = section(render(base, true), "professions");
    expect(html).toContain("280 / 300");
    expect(html.match(/role="progressbar"/g)).toHaveLength(3);
  });
});

test("the freshness line names the upload and its age, never verification", () => {
  expect(freshnessLabel("2026-10-31", NOW)).toBe("From the player's own addon upload, 2026-10-31 (1 day ago)");
  expect(freshnessLabel("2026-11-01", NOW)).toBe("From the player's own addon upload, 2026-11-01 (today)");
});

describe("share card", () => {
  test("the routes draw the sample at 1200x630 and 1080x1080, noindex", async () => {
    on();
    const { GET: wide } = await import("./card.png/route");
    const { GET: square } = await import("./card-square.png/route");
    const w = await wide();
    expect(w.headers.get("content-type")).toBe("image/png");
    expect(w.headers.get("x-robots-tag")).toBe("noindex");
    expect(await pngSize(w)).toEqual({ width: 1200, height: 630 });
    expect(await pngSize(await square())).toEqual({ width: 1080, height: 1080 });
  });

  test("the card blocks come only from shown sections, and a card with none still draws", async () => {
    expect(view().blocks).toEqual([
      { label: "Average item level", value: "57" },
      { label: "Raid this week", value: "6/10 Molten Core" },
      { label: "Professions", value: "Mining 300 · Blacksmithing 280" },
    ]);
    const bare = buildShowcase({ ...base, name: "Examplechar", realm: "A realm name far longer than any card line can hold", gear: { state: "private" }, raids: { state: "empty" }, professions: { state: "empty" } }, NOW);
    expect(bare.blocks).toEqual([]);
    expect(await pngSize(await renderCharacterCard(bare, "wide"))).toEqual({ width: 1200, height: 630 });
  });
});
