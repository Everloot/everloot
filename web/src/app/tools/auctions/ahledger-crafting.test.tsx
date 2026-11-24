import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { AhledgerCraft } from "@/lib/ahledger";
import AhledgerCrafting, { craftingHref, craftingQuery, craftingRows, type CraftingRead } from "./AhledgerCrafting";

vi.mock("next/link", () => ({ default: ({ href, rel, children }: { href: string; rel?: string; children: ReactNode }) => <a href={href} rel={rel}>{children}</a> }));

const credit = { text: "Prices from AHledger", url: "https://ahledger.com/test-credit" };
const craft = (spellId: number, over: Partial<AhledgerCraft> = {}): AhledgerCraft => ({
  spellId, name: `Test recipe ${spellId}`, skill: 100, cost: 10, netValue: 20, margin: 10, salesPerDay: 1, profitPerDay: 10, ...over,
});
const recipes = [
  craft(1, { name: "Test alpha", skill: 50, cost: 30, netValue: 40, margin: 10, salesPerDay: 2, profitPerDay: 20 }),
  craft(2, { name: "Test beta", skill: 160, cost: 10, netValue: 60, margin: 50, salesPerDay: 1, profitPerDay: 50 }),
  craft(3, { name: "Test gamma", skill: null, cost: null, netValue: 60, margin: null, salesPerDay: null, profitPerDay: null }),
];
const ready = (rows = recipes, asOf: string | null = "2026-11-24T05:45:44.000Z"): CraftingRead => ({ ok: true, recipes: rows, asOf, credit });
const path = "/tools/professions/enchanting";
const draw = (search: Record<string, string> = {}, read: CraftingRead | null = ready(), market: string | null = "forever.normal.alliance.us", profession = "Enchanting") =>
  renderToStaticMarkup(<AhledgerCrafting profession={profession} market={market} read={read} path={path} search={search} spellIcon={(id) => `https://icons.test/spell-${id}.jpg`} picker={<nav data-test-picker />} none="AH Ledger has no market for this realm." />);
const order = (search: Record<string, string>) => craftingRows(recipes, craftingQuery(search)).map((r) => r.name);
const rowNames = (html: string) => [...html.matchAll(/<a href="\/database\/spells\/\d+">([^<]+)<\/a>/g)].map((m) => m[1]);

test("the margins are drawn on the server: profit per day first, with the recipe icon, skill, coins, the prices' time and the credit", () => {
  const html = draw();
  expect(html).toContain('data-ahledger="ready"');
  expect(rowNames(html)).toEqual(["Test beta", "Test alpha", "Test gamma"]);
  expect(html).toContain('src="https://icons.test/spell-2.jpg"');
  expect(html).toContain(">160<");
  expect(html).toContain("unpriced");
  expect(html).toContain("upper bound");
  expect(html).toContain('dateTime="2026-11-24T05:45:44.000Z"');
  expect(html.replace(/<[^>]*>/g, "")).toContain("Prices as of 2026-11-24 05:45 UTC · AH Ledger");
  expect(html).toContain('href="https://ahledger.com/test-credit"');
  expect(html).toContain("data-test-picker");
  expect(html).toContain("AH Ledger market: PvE Alliance");
  // No client sort or filter box: every control is a link.
  expect(html).not.toContain("<select");
  // Without a time from AH Ledger the line is left out rather than guessed.
  expect(draw({}, ready(recipes, null))).not.toContain("Prices as of");
});

test("every money column sorts both ways from ?sort=, unknown values last, and an unknown sort is the default", () => {
  for (const [sort, expected] of [
    ["profit", ["Test alpha", "Test beta", "Test gamma"]],
    ["-margin", ["Test beta", "Test alpha", "Test gamma"]],
    ["margin", ["Test alpha", "Test beta", "Test gamma"]],
    ["cost", ["Test beta", "Test alpha", "Test gamma"]],
    ["-cost", ["Test alpha", "Test beta", "Test gamma"]],
    ["-net", ["Test beta", "Test gamma", "Test alpha"]],
    ["net", ["Test alpha", "Test beta", "Test gamma"]],
    ["-sales", ["Test alpha", "Test beta", "Test gamma"]],
    ["sales", ["Test beta", "Test alpha", "Test gamma"]],
    ["-name", ["Test beta", "Test alpha", "Test gamma"]],
  ] as const) expect(order({ sort }), sort).toEqual(expected);
});

test("the headers are sort links that keep the page's other parameters, start at page 1 and mark the sorted column", () => {
  const html = draw({ market: "forever.pvp.horde.eu", from: "1", craft_page: "2", sort: "-net" });
  expect(html).toContain('aria-sort="descending"');
  // Net value is sorted high to low, so its link turns it around; the others start high to low.
  expect(html).toContain('href="/tools/professions/enchanting?market=forever.pvp.horde.eu&amp;from=1&amp;sort=net#ahledger-margins"');
  expect(html).toContain('href="/tools/professions/enchanting?market=forever.pvp.horde.eu&amp;from=1&amp;sort=-cost#ahledger-margins"');
  // The default order leaves no parameter.
  expect(craftingHref(path, { sort: "cost", x: "1" }, craftingQuery({ sort: "cost" }), { sort: { key: "profit", desc: true } })).toBe(`${path}?x=1#ahledger-margins`);
});

test("skill range, minimum sales per day and only-priced filter on the server", () => {
  expect(order({ skill_min: "1", skill_max: "75" })).toEqual(["Test alpha"]);
  expect(order({ skill_min: "151", skill_max: "225" })).toEqual(["Test beta"]);
  expect(order({ min_sales: "2" })).toEqual(["Test alpha"]);
  expect(order({ min_sales: "0.5" })).toEqual(["Test beta", "Test alpha"]);
  expect(order({ priced: "1" })).toEqual(["Test beta", "Test alpha"]);
  expect(order({ min_sales: "lots", skill_min: "x" })).toEqual(["Test beta", "Test alpha", "Test gamma"]);
  const html = draw({ min_sales: "5" });
  expect(html).toContain("No recipes match these filters.");
  expect(html).toContain('href="/tools/professions/enchanting?min_sales=5&amp;priced=1#ahledger-margins"');
  expect(html).toContain('href="/tools/professions/enchanting?skill_min=76&amp;skill_max=150&amp;min_sales=5#ahledger-margins"');
  expect(html).toContain('href="/tools/professions/enchanting#ahledger-margins"');
});

test("the table is paged on the server: 50 rows by default, 25 to 200 a page, a page past the end shows the last", () => {
  const many = Array.from({ length: 230 }, (_, i) => craft(i + 1, { profitPerDay: 1000 - i }));
  expect(rowNames(draw({}, ready(many)))).toHaveLength(50);
  expect(rowNames(draw({ craft_size: "25" }, ready(many)))).toHaveLength(25);
  expect(rowNames(draw({ craft_size: "100" }, ready(many)))).toHaveLength(100);
  expect(rowNames(draw({ craft_size: "5000" }, ready(many)))).toHaveLength(200);
  const last = draw({ craft_page: "99" }, ready(many));
  expect(rowNames(last)).toEqual(["Test recipe 201", ...Array.from({ length: 29 }, (_, i) => `Test recipe ${202 + i}`)]);
  expect(draw({}, ready(many))).toContain('href="/tools/professions/enchanting?craft_page=2#ahledger-margins"');
});

test("a failed read says so and keeps the credit; no market says why; a profession AH Ledger lacks draws nothing", () => {
  const failed = draw({}, { ok: false });
  expect(failed).toContain('data-ahledger="failed"');
  expect(failed).toContain("could not be read");
  expect(failed).toContain('href="https://ahledger.com"');
  expect(failed).not.toContain("<table");
  const none = draw({}, null, null);
  expect(none).toContain('data-ahledger="none"');
  expect(none).toContain("AH Ledger has no market for this realm.");
  expect(draw({}, ready(), "forever.normal.alliance.us", "Fishing")).toBe("");
  expect(draw({}, ready([]))).toContain("No crafting margins on this market yet.");
});

test("every sort, filter and page link is nofollow, so a crawler does not walk the variants; the recipe and credit links are not", () => {
  const many = Array.from({ length: 120 }, (_, i) => craft(i + 1, { profitPerDay: 1000 - i }));
  const html = draw({ min_sales: "1" }, ready(many));
  const links = [...html.matchAll(/<a href="([^"]*)"([^>]*)>/g)];
  const own = links.filter(([, href]) => href.startsWith(path));
  // Sort headers, filter options, the toggle, Clear filters and the pager, top and bottom.
  expect(own.length).toBeGreaterThan(15);
  for (const [tag, , attrs] of own) expect(attrs, tag).toMatch(/rel="[^"]*nofollow[^"]*"/);
  expect(html).toMatch(/rel="next nofollow"/);
  for (const [tag, , attrs] of links.filter(([, href]) => !href.startsWith(path))) expect(attrs, tag).not.toContain("nofollow");
});

test("each money value is drawn once: no phone line repeats the columns", () => {
  const html = draw();
  // Three rows; the non-null amounts are cost 2, net 3, margin 2, profit 2 = 9 coin amounts.
  expect(html.match(/class="whitespace-nowrap tabular-nums"/g)).toHaveLength(9);
  expect(html).not.toContain("Sales/day:");
});
