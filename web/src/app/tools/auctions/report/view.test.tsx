import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { AuctionReport } from "@/lib/auction-report";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import { ReportView } from "./view";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: Document } } };
const text = (html: string) => new JSDOM(html).window.document.body.textContent ?? "";

// A made-up frozen report, as an older cron stored it: its headline in the old wording.
const good = { itemId: 765, name: "Silverleaf", realm: "CAMWOW US1 Realm 4 PvP", house: "Horde", region: "us", ruleset: "pvp", copper: 100, change: null, thin: false };
const report: AuctionReport = {
  date: "2026-11-20", publishedAt: "2026-11-21T00:10:28.310Z", headline: "Other: 55 of 81 comparable item-house prices fell from the day before.",
  houses: ["US · CAMWOW US1 Realm 4 PvP · Horde · PvP"], goods: 6748, scannedThrough: "2026-11-20T04:21:05.000Z", includesOwnScans: true,
  risers: [], fallers: [], mostListed: [{ ...good, listings: 1199 }],
  categories: [{ name: "Other", up: 20, down: 55, total: 81 }, { name: "Cooking", up: 20, down: 38, total: 1062 }], spreads: [],
};

test("the report reads plain: the lede, UTC times, thousands separators", () => {
  const t = text(renderToStaticMarkup(<ReportView report={report} />));
  expect(t).toContain("Prices fell for 55 of 81 items compared with the day before.");
  expect(t).not.toContain("comparable item-house prices fell");
  expect(t).toContain("Data time: 20 Nov, 04:21 UTC. Scan coverage as received by 21 Nov, 00:10 UTC.");
  expect(t).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(t).toContain("6,748");
  expect(t).toContain("1,199 listed auctions");
  expect(t).toContain("Cooking: 38 fell, 20 rose, 1,004 unchanged (1,062 compared).");
});

test("the latest report says when no newer one exists because nothing was scanned since", () => {
  const old = text(renderToStaticMarkup(<ReportView report={report} dates={["2026-11-20"]} now={new Date("2026-11-27T09:00:00Z")} />));
  expect(old).toContain("No newer report: no scans since 20 Nov.");
  // Yesterday's report is the newest there can be.
  const current = text(renderToStaticMarkup(<ReportView report={report} dates={["2026-11-20"]} now={new Date("2026-11-21T09:00:00Z")} />));
  expect(current).not.toContain("No newer report");
  // An archive page (no `now`) never says it.
  expect(text(renderToStaticMarkup(<ReportView report={report} />))).not.toContain("No newer report");
});
