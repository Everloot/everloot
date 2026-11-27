import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { armoryCharacter } from "@/lib/armory.fixture";
import type { ArmoryBoardRow } from "@/lib/armory-store";
import type { RankingWeek } from "@/lib/rankings";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import { WeeklyTotals } from "./parts";
import { BestOfClass } from "./leaderboards";
import { RegionBoard } from "../armory/board-parts";

const week = (start: string, current = false) => ({ start, current } as RankingWeek);
const row = (over: Partial<ArmoryBoardRow> = {}): ArmoryBoardRow => {
  const c = armoryCharacter();
  return { rank: 1, value: 64.2, region: c.region, slug: c.slug, name: c.name, surname: c.surname, class: "Mage", faction: "Alliance", ruleset: c.ruleset, guild: null, fetchedAt: c.fetchedAt, ...over } as ArmoryBoardRow;
};

test("QA round 8: the weekly totals axis steps in round numbers, as the census chart does, never 13,575", () => {
  const page = renderToStaticMarkup(<WeeklyTotals points={[{ week: week("2026-11-09"), count: 27_150 }, { week: week("2026-11-16", true), count: 20_000 }]} />);
  const ticks = [...page.matchAll(/<text x="42"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  expect(ticks).toEqual(["0", "15,000", "30,000"]);
});

test("QA round 8: on a phone each best-of-class row's Gear Score sits at the right edge, so the numbers line up", () => {
  const page = renderToStaticMarkup(<BestOfClass rows={[row()]} />);
  const meta = page.match(/<div class="dt-meta">([\s\S]*?)<\/div>/)![1];
  expect(meta).toMatch(/<span class="ml-auto"><span class="inline-flex min-w-16/);
});

test("QA round 8: a board's footer link is inset like its cells, not flush with the card edge", () => {
  const page = renderToStaticMarkup(<RegionBoard metric="item-level" region="us" rows={[row()]} footer={<a href="/x">Top 100 US by item level</a>} />);
  expect(page).toMatch(/<div class="[^"]*\bpx-3\b[^"]*"><a href="\/x">Top 100 US by item level<\/a><\/div>/);
});

test("QA round 8: an empty board keeps its own height and offers no full-list link", () => {
  const page = renderToStaticMarkup(<RegionBoard metric="honorable-kills" region="us" rows={[]} footer={<a href="/x">US only, with level, race and realm</a>} />);
  expect(page).toContain("No characters with honorable kills read on US realms yet.");
  expect(page).not.toContain("US only, with level, race and realm");
  expect(page).toMatch(/<section class="[^"]*\bself-start\b/);
  const full = renderToStaticMarkup(<RegionBoard metric="honorable-kills" region="us" rows={[row({ value: 5 })]} footer={<a href="/x">US only, with level, race and realm</a>} />);
  expect(full).toContain("US only, with level, race and realm");
  expect(full).not.toMatch(/<section class="[^"]*\bself-start\b/);
});
