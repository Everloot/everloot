import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import ShowcaseSections from "@/components/showcase/ShowcaseSections";
import { sampleShowcase } from "@/data/showcase";
import { buildShowcase, EMPTY_LINE, freshnessLabel, PRIVATE_LINE, STALE_LINE, UNSUPPORTED_LINE, type ShowcaseInput } from "@/lib/character-showcase";
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

test("with the switch off the page, its metadata and both cards are 404s", async () => {
  vi.stubEnv("EVERLOOT_SHOWCASE", "");
  const { default: Page, generateMetadata } = await import("./page");
  expect(() => Page()).toThrow("NEXT_NOT_FOUND");
  expect(generateMetadata()).toMatchObject({ robots: { index: false } });
  const { GET: wide } = await import("./card.png/route");
  const { GET: square } = await import("./card-square.png/route");
  expect((await wide()).status).toBe(404);
  expect((await square()).status).toBe(404);
});

test("the sample page carries the banner, every section, its states and noindex, and never says verified", async () => {
  on();
  const { default: Page, generateMetadata } = await import("./page");
  const html = renderToStaticMarkup(Page());
  expect(html).toContain("Sample data. Everything on this page is made up");
  expect(html).toContain("Examplechar");
  expect(html).toContain("Level 60 Orc Shaman");
  expect(html).toContain("Sampleguild");
  for (const key of ["identity", "gear", "talents", "professions", "reputations", "raids", "collections"]) expect(html).toContain(`data-section="${key}"`);
  expect(html).toMatch(/From the player&#x27;s own addon upload, \d{4}-\d{2}-\d{2} \(1 day ago\)/);
  expect(html).toContain('href="/database/items/1282"');
  expect(html).toContain("Item 1282");
  expect(html).toContain('href="/tools/talents/shaman"');
  expect(html).toContain('data-section="raids" data-state="empty"');
  expect(html).toContain(EMPTY_LINE);
  expect(html).toContain(UNSUPPORTED_LINE);
  expect(html).toContain(STALE_LINE);
  expect(html).toContain("Not checked against Blizzard");
  expect(html).not.toMatch(/verified/i);
  const meta = generateMetadata();
  expect(meta.robots).toEqual({ index: false, follow: false });
  expect(JSON.stringify(meta.openGraph)).toContain("/showcase/character/card.png");
  expect(JSON.stringify(meta.twitter)).toContain("/showcase/character/card.png");
});

describe("sections", () => {
  const base = sampleShowcase(NOW);
  const render = (input: ShowcaseInput, preview: boolean) => renderToStaticMarkup(<ShowcaseSections showcase={buildShowcase(input, NOW)} preview={preview} />);

  test("each state draws its own line, and unsupported never prints a zero", () => {
    const html = render({ ...base, gear: { state: "private" }, professions: { state: "unsupported" }, raids: { state: "empty" } }, true);
    expect(html).toContain('data-section="gear" data-state="private"');
    expect(html).toContain(PRIVATE_LINE);
    expect(html).toContain('data-section="professions" data-state="unsupported"');
    const professions = html.slice(html.indexOf('data-section="professions"'), html.indexOf('data-section="reputations"'));
    expect(professions).toContain(UNSUPPORTED_LINE);
    expect(professions).not.toMatch(/>0</);
  });

  test("the public page leaves out what has nothing synced or is switched off", () => {
    const html = render({ ...base, gear: { state: "private" }, professions: { state: "unsupported" } }, false);
    expect(html).not.toContain('data-section="gear"');
    expect(html).not.toContain('data-section="raids"');
    expect(html).toContain('data-section="professions" data-state="unsupported"');
    expect(html).not.toContain(EMPTY_LINE);
  });

  test("a section older than two weeks says it may be out of date", () => {
    const html = render(base, true);
    const talents = html.slice(html.indexOf('data-section="talents"'), html.indexOf('data-section="professions"'));
    expect(talents).toContain(STALE_LINE);
    const gear = html.slice(html.indexOf('data-section="gear"'), html.indexOf('data-section="talents"'));
    expect(gear).not.toContain(STALE_LINE);
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
    const view = buildShowcase(sampleShowcase(NOW), NOW);
    expect(view.blocks.map((b) => b.label)).toEqual(["Average item level", "Professions"]);
    const bare = buildShowcase({ ...sampleShowcase(NOW), name: "Examplechar", realm: "A realm name far longer than any card line can hold", gear: { state: "private" }, professions: { state: "empty" } }, NOW);
    expect(bare.blocks).toEqual([]);
    expect(await pngSize(await renderCharacterCard(bare, "wide"))).toEqual({ width: 1200, height: 630 });
  });
});
