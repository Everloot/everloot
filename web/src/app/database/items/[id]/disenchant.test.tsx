import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

import { CLIENT_DISENCHANT } from "@/data/game-data/client-disenchant";
import { bandYield, disenchantTablesFromRecords, placer } from "@kb/disenchant";
import { DisenchantPanel, showsDisenchant } from "./disenchant";

let n = 0;
const de = (installId: string, sourceItemId: number, itemId: number, count: number) => ({
  installId, eventId: `e${n++}`, capturedAt: "2026-11-16T10:00:00Z", kind: "loot", lootType: "disenchant", sourceEvidence: "loot-api",
  sourceItemId, items: [{ itemId, count }],
});
const sort = placer(CLIENT_DISENCHANT);
const render = (itemId: number, records: unknown[]) => {
  const tables = disenchantTablesFromRecords(records, CLIENT_DISENCHANT);
  const placement = sort.place(itemId);
  const band = placement.kind === "band" ? bandYield(tables, placement.band) : null;
  return renderToStaticMarkup(<DisenchantPanel placement={placement} band={band} own={tables.items.get(itemId)} title="Test Gloves" item={(id) => <span>{`Item ${id}`}</span>} />);
};

test("a rated band: its materials with the denominator, the item's own count and the tool link", () => {
  const html = render(763, [de("a", 763, 10940, 1), de("b", 1270, 10940, 2), de("c", 1270, 10938, 1)]);
  expect(html).toContain("Uncommon armor, item level 5 to 15");
  expect(html).toContain("Item 10940");
  expect(html).toContain("67%");
  expect(html).toContain("2 of 3");
  expect(html).toContain("Out of 3 disenchants in the band from 3 installs, dated 2026-11-16");
  expect(html).toContain("1 disenchant of this item itself recorded, from 1 install.");
  expect(html).toContain('href="/tools/disenchanting"');
});

test("a band short of 3 installs says what is missing and shows no materials", () => {
  const html = render(763, [de("a", 763, 10940, 1)]);
  expect(html).toContain("1 disenchant in this band from 1 install.");
  expect(html).toContain("1 more".replace("1", "2"));
  expect(html).not.toContain("Item 10940");
});

test("an item the files mark as not disenchantable says so; an item with no band shows no tab", () => {
  const blocked = CLIENT_DISENCHANT.noDisenchant[0]!;
  expect(render(blocked, [])).toContain("cannot be disenchanted");
  expect(showsDisenchant(sort.place(blocked))).toBe(true);
  expect(showsDisenchant(sort.place(10940))).toBe(false);
});
