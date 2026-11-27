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
import { isDevelopmentAchievement } from "@/lib/completion-lists";

const html = async (search: Record<string, string> = {}) => renderToStaticMarkup(await AchievementList({ searchParams: Promise.resolve(search) }));
/** The listed (non-statistic) achievements the files file under `name` or a category beneath it, and their points. */
function totals(name: string) {
  const rows = Object.entries(CLIENT_ACHIEVEMENTS.achievements).filter(([id, a]) => !a.statistic && !isDevelopmentAchievement(Number(id), a.title) && categoryPath(a.category).some((s) => s.name === name)).map(([, a]) => a)
    // A twin the files carry twice (same name, text, category and criteria) is one row of the list.
    .filter((a, i, all) => all.findIndex((b) => JSON.stringify([b.title, b.description ?? "", b.category ?? null, b.criteria.map((c) => c.text)]) === JSON.stringify([a.title, a.description ?? "", a.category ?? null, a.criteria.map((c) => c.text)])) === i);
  return { achievements: rows.length, points: rows.reduce((n, a) => n + a.points, 0) };
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A category's totals line: its points only when it has some (most of the files' achievements carry none). */
const line = (t: { achievements: number; points: number }) => `${plural(t.achievements, "achievement")}${t.points ? ` · ${plural(t.points, "point")}` : ""}`;

test("the list opens with the categories grouped as the files nest them, each with its achievements and points", async () => {
  const out = await html();
  const section = out.split('aria-labelledby="by-category"')[1]?.split("</section>")[0] ?? "";
  expect(section).toMatch(/<h2 id="by-category"[^>]*>By category<\/h2>/);
  // Adventure holds Eastern Kingdoms: the group's total counts both, the child its own.
  const adventure = totals("Adventure");
  const eastern = totals("Eastern Kingdoms");
  expect(adventure.achievements).toBeGreaterThan(eastern.achievements);
  expect(section).toMatch(new RegExp(`href="/database/achievements\\?category=Adventure">Adventure</a>(?:<[^>]*>)*\\s*${line(adventure)}<`));
  expect(section).toMatch(new RegExp(`href="/database/achievements\\?category=Eastern\\+Kingdoms">Eastern Kingdoms</a>(?:<[^>]*>)*\\s*${line(eastern)}<`));
  // Raids carry the files' only points.
  expect(totals("Raids").points).toBeGreaterThan(0);
  expect(section).toMatch(new RegExp(`>Raids</a>(?:<[^>]*>)*\\s*${line(totals("Raids"))}<`));
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

test("the files' Do Not Display category and the [DNT], UNUSED and <Hidden> rows stay out of the list and its overview", async () => {
  // The overview and the Category menu name no such category, and searches and the category's filter find none of them.
  expect(await html()).not.toContain("Do Not Display");
  for (const q of ["DNT", "UNUSED", "Adventure Awaits - Hit 60", "Self-Found Soul", "Rune Learned"]) expect(await html({ q })).toContain("No achievements match these filters.");
  expect(await html({ category: "Do Not Display" })).not.toContain("The Immortal");
});

test("on a phone the overview folds behind a disclosure; rows say 1 point, not 1 points", async () => {
  const out = await html();
  const section = out.split('aria-labelledby="by-category"')[1]?.split("</section>")[0] ?? "";
  expect(section).toMatch(/<details class="[^"]*sm:hidden[^"]*"><summary[^>]*>By category/);
  expect(out).not.toMatch(/(?<!\d)1 points\b/);
});

test("a page whose achievements have no points leaves the Points column out, and says \"0 points\" nowhere", async () => {
  const out = await html({ category: "Eastern Kingdoms" });
  expect(out).toContain("Explore Dun Morogh");
  expect(out).not.toMatch(/(?<!\d)0 points?\b/);
  expect(out).not.toMatch(/<th[^>]*>(?:<[^>]*>)*Points</);
  expect(out).not.toMatch(/<td class="dt-td dt-num dt-fold"><span class="text-muted">—<\/span><\/td>/);
});
