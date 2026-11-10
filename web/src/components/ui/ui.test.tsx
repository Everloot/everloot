import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import AgreementMeter, { agreementLabel, clampAgreement } from "./AgreementMeter";
import Badge from "./Badge";
import Card from "./Card";
import Container from "./Container";
import DataTable, { filledColumns, type Column, type SparseColumn } from "./DataTable";
import EmptyState from "./EmptyState";
import { pageWindow } from "./Pager";
import PageHeader from "./PageHeader";
import ReadingLayout, { RailFacts } from "./ReadingLayout";
import SectionHeading from "./SectionHeading";
import TooltipFrame from "./TooltipFrame";
import { qualityOf, QUALITY_TEXT } from "./quality";

const render = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("Container", () => {
  test("has two widths, wide by default", () => {
    expect(render(<Container>x</Container>)).toContain("max-w-wide");
    expect(render(<Container width="reading">x</Container>)).toContain("max-w-reading");
  });
});

describe("ReadingLayout", () => {
  const items = [{ id: "a", label: "First" }, { id: "b", label: "Second" }];

  test("is a plain reading column without a rail when it has no meta and no contents", () => {
    const html = render(<ReadingLayout>x</ReadingLayout>);
    expect(html).toContain("max-w-reading");
    expect(html).not.toContain("<aside");
  });

  test("puts the meta and a contents list of anchors in the rail", () => {
    const html = render(<ReadingLayout items={items} meta={<RailFacts items={[{ label: "Published", value: "today" }]} />}>body</ReadingLayout>);
    expect(html).toContain("data-reading-layout");
    expect(html).toContain('href="#a"');
    expect(html).toContain('href="#b"');
    expect(text(html)).toContain("Published today");
    // The text comes first, so a phone opens on the title and a screen reader reaches the h1 before the rail.
    expect(html.indexOf("body")).toBeLessThan(html.indexOf("<aside"));
  });
});

describe("PageHeader", () => {
  const trail = [{ name: "Home", path: "/" }, { name: "Database", path: "/database" }, { name: "Linen Cloth", path: "/database/items/2589" }];

  test("draws one h1, the lede, meta and actions", () => {
    const html = render(<PageHeader title="Linen Cloth" lede="A trade good." meta={<span>Item 2589</span>} actions={<a href="/x">Copy link</a>} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text(html)).toContain("Linen Cloth A trade good. Item 2589 Copy link");
  });

  test("one compact title size on every page", () => {
    const html = render(<PageHeader title="T" />);
    expect(html).toMatch(/<h1 class="[^"]*text-title-sm[^"]*sm:text-title(?:\s|")/);
  });

  test("nothing above the title: no eyebrow and no visible breadcrumb", () => {
    // A route the layout knows, so the header emits no JSON-LD and all of its text is visible text.
    const html = render(<PageHeader title="Talent calculator" trail={[{ name: "Home", path: "/" }, { name: "Talent calculator", path: "/tools/talents" }]} />);
    expect(html).not.toContain("BreadcrumbList");
    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(text(html)).toBe("Talent calculator");
  });

  test("an entity page's trail is not drawn but still gets its BreadcrumbList", () => {
    const html = render(<PageHeader title="Linen Cloth" trail={trail} />);
    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(html).toContain("BreadcrumbList");
    expect(html).toContain('"name":"Database"');
  });

  test("a route the layout already knows does not get a second BreadcrumbList", () => {
    const html = render(<PageHeader title="Census" trail={[{ name: "Home", path: "/" }, { name: "Census", path: "/census" }]} />);
    expect(html).not.toContain("BreadcrumbList");
  });

  test("colours the title by quality", () => {
    expect(render(<PageHeader title="Truesilver Champion" quality="rare" />)).toMatch(/<h1 class="[^"]*text-q-rare/);
  });
});

describe("SectionHeading", () => {
  test("one style, h2 by default, h3 on request", () => {
    const h2 = render(<SectionHeading>Used in</SectionHeading>);
    const h3 = render(<SectionHeading as="h3">Used in</SectionHeading>);
    expect(h2).toMatch(/<h2 class="scroll-mt-24 text-xl font-semibold tracking-tight text-fg">Used in<\/h2>/);
    expect(h3).toMatch(/<h3 class="scroll-mt-24 text-xl font-semibold tracking-tight text-fg">Used in<\/h3>/);
  });
});

describe("Card", () => {
  test("one radius, panel fill, hairline edge", () => {
    const html = render(<Card>x</Card>);
    expect(html).toContain("rounded-card");
    expect(html).toContain("border-line");
    expect(html).toContain("bg-panel");
  });

  test("an unconfirmed card has the dashed edge", () => {
    expect(render(<Card unconfirmed>x</Card>)).toContain("border-dashed");
  });

  test("a link card is one link", () => {
    const html = render(<Card href="/tools/talents">Talents</Card>);
    expect(html).toMatch(/^<a href="\/tools\/talents"/);
  });
});

describe("Badge", () => {
  test("the files badge is a quiet hollow diamond, not a pill or a dotted ring: a tooltip and a screen-reader label", () => {
    const html = render(<Badge tone="files" />);
    expect(html).toContain("rotate-45");
    expect(html).not.toContain("border-dashed");
    expect(html).not.toContain("rounded-full");
    expect(html).not.toContain("rounded-full border px-2.5");
    expect(html).toContain('title="From the game files, not yet confirmed by players"');
    expect(html).toMatch(/<span class="sr-only">unconfirmed<\/span>/);
  });

  test("a quality badge is in its quality colour", () => {
    const html = render(<Badge tone="quality" quality="epic" />);
    expect(html).toContain("text-q-epic");
    expect(text(html)).toBe("Epic");
  });
});

describe("AgreementMeter", () => {
  test.each([0, 1, 2, 3])("%i of 3 has an accessible label and that many filled diamonds", (n) => {
    const html = render(<AgreementMeter count={n} />);
    expect(html).toContain(`role="img" aria-label="${n} of 3 installs agree"`);
    expect(html.match(/bg-accent/g)?.length ?? 0).toBe(n);
  });

  test("clamps what it cannot draw", () => {
    expect(clampAgreement(-1)).toBe(0);
    expect(clampAgreement(7)).toBe(3);
    expect(clampAgreement(2.6)).toBe(2);
    expect(clampAgreement(Number.NaN)).toBe(0);
    expect(agreementLabel(9)).toBe("3 of 3 installs agree");
  });
});

describe("EmptyState", () => {
  test("the meter at 0, one sentence and Get the addon", () => {
    const html = render(<EmptyState message="Nobody has looted this in Forever yet." />);
    expect(html).toContain('aria-label="0 of 3 installs agree"');
    expect(text(html)).toBe("Nobody has looted this in Forever yet. Get the addon");
    expect(html).toContain('href="/addon"');
    // An outline pill: the header's Get the addon, or the page's own form, is the one filled button in view.
    expect(html).toContain('class="btn shrink-0"');
    expect(html).not.toContain("btn-primary");
  });

  test("fills its action only when asked, for a page where it is the one thing to do", () => {
    expect(render(<EmptyState message="No uploads this week." primary />)).toContain("btn shrink-0 btn-primary");
  });

  test("takes a better action when the page has one", () => {
    const html = render(<EmptyState message="No uploads this week." action={{ href: "/upload", label: "Upload a save file" }} />);
    expect(html).toContain('href="/upload"');
    expect(html).not.toContain('href="/addon"');
  });
});

describe("TooltipFrame", () => {
  test("dark frame, name in its quality colour, foot line", () => {
    const html = render(<TooltipFrame name="Linen Cloth" quality="common" foot="Build 1.60.1.70450 · unconfirmed"><p>Trade Goods</p></TooltipFrame>);
    expect(html).toContain("bg-tooltip");
    expect(html).toContain("border-tooltip-border");
    expect(html).toContain("text-q-common");
    expect(text(html)).toBe("Linen Cloth Trade Goods Build 1.60.1.70450 · unconfirmed");
  });
});

describe("DataTable", () => {
  type Row = { id: number; name: string; quality: number; count: number };
  const rows: Row[] = [{ id: 2589, name: "Linen Cloth", quality: 1, count: 12 }, { id: 7960, name: "Truesilver Champion", quality: 3, count: 0 }];
  const columns: Column<Row>[] = [
    { key: "name", header: "Item", cell: (r) => <span className={QUALITY_TEXT[qualityOf(r.quality)]}>{r.name}</span>, sortable: true },
    { key: "count", header: "Seen", numeric: true, cell: (r) => r.count, sortable: true },
  ];

  test("headers, rows, quality-coloured names and tabular numbers", () => {
    const html = render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => String(r.id)} />);
    expect(html).toContain('<caption class="sr-only">Items</caption>');
    expect(html.match(/<th scope="col"/g)).toHaveLength(2);
    expect(html).toContain('class="text-q-rare">Truesilver Champion');
    expect(html).toMatch(/<td class="[^"]*text-right font-mono tabular-nums[^"]*">12<\/td>/);
  });

  test("a wide table scrolls inside its frame, and the frame can be scrolled from the keyboard", () => {
    const html = render(<DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => String(r.id)} />);
    expect(html).toMatch(/role="region" aria-label="Items" tabindex="0" class="[^"]*overflow-x-auto/);
    expect(html).toMatch(/^<div data-table="true" class="[^"]*min-w-0 overflow-hidden/);
  });

  test("sorting is ready: aria-sort on the sorted column, headers link to the other direction", () => {
    const html = render(
      <DataTable caption="Items" columns={columns} rows={rows} rowKey={(r) => String(r.id)} sort={{ key: "count", direction: "desc" }} sortHref={(key, dir) => `?sort=${key}&dir=${dir}`} />,
    );
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('href="?sort=count&amp;dir=asc"');
    expect(html).toContain('href="?sort=name&amp;dir=desc"');
  });

  test("dense: no card frame, sans 32 px headers that stick under the site header, 36 px rows, sort arrows and aria-sort", () => {
    const html = render(
      <DataTable dense caption="Items" columns={columns} rows={rows} rowKey={(r) => String(r.id)} sort={{ key: "name", direction: "asc" }} sortHref={(key, dir) => `?sort=${dir === "desc" ? "-" : ""}${key}`} />,
    );
    expect(html).not.toContain("rounded-card");
    expect(html).toMatch(/<th scope="col" aria-sort="ascending" class="[^"]*h-th sm:sticky sm:top-header[^"]*text-th/);
    // Not sticky on a phone, where a sideways-scrolling table would push its header down onto the rows.
    expect(html).not.toMatch(/[\s"]sticky[\s"]/);
    expect(html).not.toContain("font-mono text-xs");
    expect(html).toMatch(/<td class="[^"]*sm:h-row/);
    expect(html).toContain("▲");
    // The sorted column turns around; an unsorted text column starts A to Z, a number column high to low.
    expect(html).toContain('href="?sort=-name"');
    expect(html).toContain('href="?sort=-count"');
  });

  test("dense with a phone line: only the first column shows below 640 px, the rest folds into its second line", () => {
    const html = render(<DataTable dense caption="Items" columns={columns} rows={rows} rowKey={(r) => String(r.id)} meta={(r) => `Seen ${r.count}`} />);
    expect(html.match(/hidden sm:table-cell/g)).toHaveLength(1 + rows.length);
    expect(html).toContain('<div class="text-cell-2 text-muted sm:hidden">Seen 12</div>');
    expect(html).not.toContain("overflow-x-auto");
  });

  test("filledColumns leaves out a column blank on every row; one value anywhere keeps it", () => {
    const withSource: SparseColumn<Row>[] = [...columns, { key: "src", header: "Source", cell: (r) => (r.count ? "Drop" : "—"), blank: (r) => !r.count }];
    const keys = (rs: Row[]) => filledColumns(withSource, rs).map((c) => c.key);
    expect(keys([rows[1]])).toEqual(["name", "count"]);
    expect(keys(rows)).toEqual(["name", "count", "src"]);
    // With no rows the headers stay as given.
    expect(keys([])).toEqual(["name", "count", "src"]);
    expect(render(<DataTable dense caption="Items" columns={filledColumns(withSource, [rows[1]])} rows={[rows[1]]} rowKey={(r) => String(r.id)} />)).not.toContain("Source");
  });

  test("the numbered pager keeps the first, the last and the neighbours of the current page", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 77)).toEqual([1, 2, null, 77]);
    expect(pageWindow(40, 77)).toEqual([1, null, 39, 40, 41, null, 77]);
    expect(pageWindow(3, 4)).toEqual([1, 2, 3, 4]);
  });

  test("with no rows it keeps the headers and shows the empty state", () => {
    const html = render(
      <DataTable caption="Drops" columns={columns} rows={[]} rowKey={(r) => String(r.id)} empty={<EmptyState framed={false} message="Nobody has looted this yet." />} />,
    );
    expect(html.match(/<th /g)).toHaveLength(2);
    expect(html).toContain('colSpan="2"');
    expect(html).toContain("data-empty-state");
  });
});

// The components hold to the system: the spacing scale, one card radius, no default palette.
describe("the ui folder keeps to the tokens", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
  const sources = files.map((f) => ({ f, s: readFileSync(join(dir, f), "utf8") }));

  test("the scan sees the components", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  test("spacing stays on the scale (4 8 12 16 24 32 48 72 px)", () => {
    // Half steps are allowed for optical nudges inside a control (0.5, 1.5, 2.5, 3.5).
    const off = /(?:^|[\s"'`:])-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-y|space-x)-(5|7|9|10|11|14|16|20|24)(?=[\s"'`]|$)/;
    for (const { f, s } of sources) expect(s.split(/\r?\n/).filter((line) => off.test(line)), f).toEqual([]);
  });

  test("cards and frames use the card radius, never rounded-lg, -xl or -2xl", () => {
    for (const { f, s } of sources) expect(s, f).not.toMatch(/rounded-(?:lg|xl|2xl|md)\b/);
  });
});
