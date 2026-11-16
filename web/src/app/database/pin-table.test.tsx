import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { PinTable, type Pin } from "./entity";

// The link with its attributes, since the label is what the test reads.
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

interface NamedPin extends Pin { who: string }

// Elwynn Forest (UiMap 1429) is on the world map; 999999 is not.
const pins: NamedPin[] = [
  { who: "first", mapId: 1429, x: 40, y: 60, reporters: 3 },
  { who: "second", mapId: 999999, x: 10, y: 20, reporters: 4 },
];
const html = (lead?: Parameters<typeof PinTable<NamedPin>>[0]["lead"]) =>
  renderToStaticMarkup(<PinTable caption="Where it stands" rows={pins} rowKey={(p) => p.who} lead={lead} />);
// Each header's text, without the dense table's layout span around it.
const cells = (row: string) => [...row.matchAll(/<th[^>]*><span[^>]*>(.*?)<\/span><\/th>/g)].map((m) => m[1]);

test("the columns are the zone, the position, the installs and the map link, in that order", () => {
  const out = html();
  const head = out.split("<thead>")[1].split("</thead>")[0];
  expect(cells(head)).toEqual(["Map", "Position", "Installs", '<span class="sr-only">Map link</span>']);
  expect(out).toContain('<span title="UiMap 1429">Elwynn Forest</span>');
  expect(out).toContain("40, 60");
  expect(out).toContain('aria-label="Show Elwynn Forest at 40, 60 on the map"');
  expect(out).toContain(">3</td>");
});

test("a pin on a map the world map does not draw keeps its row and has no link", () => {
  const out = html();
  expect(out).toContain('<span title="UiMap 999999">Map 999999</span>');
  expect(out).toContain("10, 20");
  expect(out.match(/Show on the map/g)).toHaveLength(1);
});

test("a page's own columns go before the shared ones", () => {
  const out = html([{ key: "who", header: "Who", cell: (p) => p.who }]);
  const head = out.split("<thead>")[1].split("</thead>")[0];
  expect(cells(head)[0]).toBe("Who");
  expect(cells(head)).toHaveLength(5);
  expect(out).toContain(">first<");
});
