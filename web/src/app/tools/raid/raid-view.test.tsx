import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

// The page with a banner: the art credit must not sit between the title and the lede, where a screen reader reads it
// as the page's first line.
vi.mock("@/lib/game-assets", async (orig) => {
  const real = await orig<typeof import("@/lib/game-assets")>();
  const art = { mapId: 1, name: "Raid", kind: "raid" as const, heldBack: false, url: "https://a.test/l.webp", width: 1920, small: null };
  return { ...real, loadSiteAssets: async () => ({}) as never, raidArt: () => null, loadingArt: () => art };
});
vi.mock("./RaidBuilder", () => ({ default: () => <div data-raid-builder /> }));
vi.mock("@/components/AdSlot", () => ({ default: () => null }));

test("the art credit comes at the end of the page, after the lede and the questions", async () => {
  const { default: RaidView } = await import("./RaidView");
  const html = renderToStaticMarkup(await RaidView());
  const credit = html.indexOf("Art © Blizzard Entertainment");
  expect(credit).toBeGreaterThan(-1);
  expect(credit).toBeGreaterThan(html.indexOf("Fill a 10, 20 or 40 player"));
  expect(credit).toBeGreaterThan(html.indexOf("Can the addon fill in my raid?"));
});

test("the banner is not inside the page's column, so its full-width art lines up with the window", async () => {
  // The banner's art is centred on its parent and as wide as the window: that only fills the window when the parent is
  // <main>, not the left-aligned column, which left a black strip on the right of a wide screen.
  const { default: RaidView } = await import("./RaidView");
  const html = renderToStaticMarkup(await RaidView());
  const banner = html.indexOf("data-banner=");
  expect(banner).toBeGreaterThan(-1);
  expect(html.indexOf("data-container=")).toBeGreaterThan(banner);
});

test("the planner's banner is the short one, so the planner starts above the fold", async () => {
  const { default: RaidView } = await import("./RaidView");
  const html = renderToStaticMarkup(await RaidView());
  const banner = /<div data-banner[=\s][^>]*>/.exec(html)![0];
  expect(banner).toContain("data-banner-short");
  expect(banner).not.toContain("min-h-64");
});
