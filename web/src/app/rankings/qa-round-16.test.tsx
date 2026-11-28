import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { RankRow, RankingWeek } from "@/lib/rankings";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import { RankTable, StackedWeeks, WeeklyChart } from "./parts";

const week = (start: string, current = false) => ({ start, current, window: { collecting: false } } as RankingWeek);
const weeks = [week("2026-11-09"), week("2026-11-16"), week("2026-11-23", true)];
/** The first column's header of each table in the markup. */
const firstHeaders = (html: string) => [...html.matchAll(/<thead><tr><th[^>]*>(?:<[^>]*>)*([^<]+)</g)].map((m) => m[1]);

test("QA round 16: the share tables' first column is named for what the rows are, not Name", () => {
  const classes = renderToStaticMarkup(
    <StackedWeeks noun="Class" title="Share of each week's characters by class" weeks={weeks} series={[{ key: "mage", label: "Mage", classToken: "MAGE", points: [0.5, 0.4, 0.45] }]} />,
  );
  expect(firstHeaders(classes)).toEqual(["Class"]);
  const races = renderToStaticMarkup(
    <WeeklyChart noun="Race" title="Races: share of each week's characters" weeks={weeks} series={[{ key: "orc", label: "Orc", points: [0.5, 0.4, 0.45] }]} />,
  );
  expect(firstHeaders(races)).toEqual(["Race"]);
});

test("QA round 16: the ranked table's first column is named Class, Race or Faction", () => {
  const row = { key: "horde", rank: 1, label: "Horde", faction: "Horde", count: 10, share: 0.6, change: null } as unknown as RankRow;
  const html = renderToStaticMarkup(<RankTable noun="Faction" rows={[row]} caption="Factions" showChange={false} asOf="2026-11-23" />);
  expect(firstHeaders(html)).toEqual(["Faction"]);
});
