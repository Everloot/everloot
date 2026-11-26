import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

/** The achievement list from the committed game files: grouped by category with totals, and each row's icon. */

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCompletion: async () => ({ state: null, dataAsOf: null }) },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
// The asset manifest lists Explore Dun Morogh's icon (achievement 627).
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  loadSiteAssets: async () => ({ achievementIcons: new Map([[627, "https://a.test/icons/236755.webp"]]) }),
}));

import AchievementList from "./page";
import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { categoryPath } from "./categories";

const html = async (search: Record<string, string> = {}) => renderToStaticMarkup(await AchievementList({ searchParams: Promise.resolve(search) }));
/** The listed (non-statistic) achievements the files file under `name` or a category beneath it, and their points. */
function totals(name: string) {
  const rows = Object.values(CLIENT_ACHIEVEMENTS.achievements).filter((a) => !a.statistic && categoryPath(a.category).some((s) => s.name === name));
  return { achievements: rows.length, points: rows.reduce((n, a) => n + a.points, 0) };
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

test("the list opens with the categories grouped as the files nest them, each with its achievements and points", async () => {
  const out = await html();
  const section = out.split('aria-labelledby="by-category"')[1]?.split("</section>")[0] ?? "";
  expect(section).toMatch(/<h2 id="by-category"[^>]*>By category<\/h2>/);
  // Adventure holds Eastern Kingdoms: the group's total counts both, the child its own.
  const adventure = totals("Adventure");
  const eastern = totals("Eastern Kingdoms");
  expect(adventure.achievements).toBeGreaterThan(eastern.achievements);
  expect(section).toMatch(new RegExp(`href="/database/achievements\\?category=Adventure">Adventure</a>(?:<[^>]*>)*\\s*${plural(adventure.achievements, "achievement")} · ${plural(adventure.points, "point")}`));
  expect(section).toMatch(new RegExp(`href="/database/achievements\\?category=Eastern\\+Kingdoms">Eastern Kingdoms</a>(?:<[^>]*>)*\\s*${plural(eastern.achievements, "achievement")} · ${plural(eastern.points, "point")}`));
  // Raids carry the files' only points.
  expect(totals("Raids").points).toBeGreaterThan(0);
  expect(section).toMatch(new RegExp(`>Raids</a>(?:<[^>]*>)*\\s*${plural(totals("Raids").achievements, "achievement")} · ${plural(totals("Raids").points, "point")}`));
});

test("a parent category filters to everything under it; a filtered list drops the overview", async () => {
  const out = await html({ category: "Adventure" });
  expect(out).toContain("Explore Dun Morogh");
  expect(out).toContain("Explore Durotar");
  expect(out).not.toContain('aria-labelledby="by-category"');
});

test("each row carries the achievement's icon where the asset manifest lists one", async () => {
  const out = await html({ category: "Eastern Kingdoms" });
  expect(out).toMatch(/<img[^>]*src="https:\/\/a\.test\/icons\/236755\.webp"[^>]*>(?:<[^>]*>)*\s*<a href="\/database\/achievements\/627-explore-dun-morogh">/);
});
