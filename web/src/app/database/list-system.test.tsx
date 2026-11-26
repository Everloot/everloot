import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, className, style, prefetch }: { href: string; children: ReactNode; className?: string; style?: object; prefetch?: boolean }) =>
  <a href={href} className={className} style={style} data-prefetch={String(prefetch)}>{children}</a> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import { ResultStrip } from "@/components/ui";
import { categoryQuery, itemsHref } from "@/lib/items";
import { ConfirmedCell, ListNote, listHref, listQuery, NameCell, paged, pageParams, PER_PAGE } from "./list-parts";

const html = (el: ReactNode) => renderToStaticMarkup(<>{el}</>);

test("a list reads ?per= as one of the page sizes; the default size is no parameter, anything else is a 404", () => {
  expect(listQuery({ per: "100" }, ["id"])).toEqual({ page: 1, per: 100 });
  expect(listQuery({ per: "25", page: "3" }, ["id"])).toEqual({ page: 3, per: 25 });
  expect(listQuery({ per: String(PER_PAGE) }, ["id"])).toEqual({ page: 1 });
  expect(listQuery({ per: "7" }, ["id"])).toBeNull();
  expect(listQuery({ per: "abc" }, ["id"])).toBeNull();
  // The item lists read it the same way.
  expect(categoryQuery({ per: "100" })?.per).toBe(100);
  expect(categoryQuery({ per: "50" })?.per).toBeUndefined();
  expect(categoryQuery({ per: "13" })).toBeNull();
  expect(itemsHref(undefined, undefined, { sort: { key: "id", desc: true }, per: 25, page: 2 })).toBe("/database/items?sort=-id&per=25&page=2");
});

test("pageParams puts the sort, the size and the page last in one order; paged slices by the size and 404s past the end", () => {
  expect(listHref("/database/npcs", [["q", "hog"], ...pageParams({ sort: { key: "level", desc: true }, per: 100, page: 2 })])).toBe("/database/npcs?q=hog&sort=-level&per=100&page=2");
  expect(listHref("/database/npcs", pageParams({ page: 1 }))).toBe("/database/npcs");
  const rows = Array.from({ length: 60 }, (_, i) => i);
  expect(paged(rows, { page: 1 })).toMatchObject({ pages: 2, per: 50, shown: rows.slice(0, 50) });
  expect(paged(rows, { page: 3, per: 25 })).toMatchObject({ pages: 3, per: 25, shown: rows.slice(50) });
  expect(paged([], { page: 1 })).toMatchObject({ pages: 1, shown: [] });
  expect(() => paged(rows, { page: 2, per: 100 })).toThrow("NEXT_NOT_FOUND");
});

test("the result strip offers the page sizes as links, the current one marked, once the list is longer than the smallest", () => {
  const strip = (total: number, perPage = 50) => html(<ResultStrip total={total} noun="items" page={1} perPage={perPage} href={(p) => `/l?page=${p}`} sizeHref={(n) => `/l?per=${n}`} />);
  const long = strip(120);
  expect(long).toContain("data-page-sizes");
  expect(long).toContain('href="/l?per=25"');
  expect(long).toContain('href="/l?per=100"');
  expect(long).toMatch(/aria-current="true"[^>]*>50</);
  expect(strip(120, 100)).toMatch(/aria-current="true"[^>]*>100</);
  // A list that fits the smallest page has nothing to choose.
  expect(strip(20)).not.toContain("data-page-sizes");
  // Without sizeHref the strip is as before.
  expect(html(<ResultStrip total={120} noun="items" page={1} perPage={50} href={(p) => `/l?page=${p}`} />)).not.toContain("data-page-sizes");
});

test("a name cell: the icon when the art exists, the name as a link in its colour, never prefetched, and the unconfirmed mark", () => {
  const plain = html(<NameCell href="/database/npcs/448">Hogger</NameCell>);
  expect(plain).toContain('href="/database/npcs/448"');
  expect(plain).toContain('data-prefetch="false"');
  expect(plain).toContain("text-fg");
  expect(plain).not.toContain("data-game-icon");
  expect(plain).not.toContain('data-badge="files"');
  const item = html(<NameCell href="/database/items/1" icon="https://a.test/i.webp" quality="epic" tone="text-q-epic" files>Thunderfury</NameCell>);
  expect(item).toContain('src="https://a.test/i.webp"');
  expect(item).toContain("text-q-epic");
  expect(item).toContain('data-badge="files"');
});

test("the Confirmed column: confirmed in words, unconfirmed with the hollow diamond, unrecorded muted", () => {
  expect(html(<ConfirmedCell entry={{ confirmed: true }} confirmations />)).toMatch(/>Confirmed</);
  const unconfirmed = html(<ConfirmedCell entry={{ confirmed: false }} confirmations />);
  expect(unconfirmed).toContain('data-badge="files"');
  expect(unconfirmed).toContain("Unconfirmed");
  const unrecorded = html(<ConfirmedCell entry={{ confirmed: false }} confirmations={false} />);
  expect(unrecorded).toContain("Unrecorded");
  expect(unrecorded).not.toContain('data-badge="files"');
});

test("a list note is one style, and a list of game-file entries leads with the unconfirmed mark", () => {
  const files = html(<ListNote files>Every mount the game files list.</ListNote>);
  expect(files).toContain("data-list-note");
  expect(files).toContain('data-badge="files"');
  expect(html(<ListNote>A vendor is listed once 3 installs agree.</ListNote>)).not.toContain('data-badge="files"');
});
