import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: async () => ({ uploads: 0, records: [], dataAsOf: null }) },
}));
const links = vi.hoisted(() => [] as { href: string; prefetch?: boolean }[]);
vi.mock("next/link", () => ({ default: ({ href, children, prefetch }: { href: string; children: ReactNode; prefetch?: boolean }) => { links.push({ href, prefetch }); return <a href={href}>{children}</a>; } }));

import TerrainPage, { metadata } from "./page";
import { terrainTypes } from "@/lib/terrain";

test("the terrain page has a section per terrain type with its zones, then the speed gear", async () => {
  const page = renderToStaticMarkup(await TerrainPage());
  expect(page.match(/<h1[ >]/g)).toHaveLength(1);
  for (const t of terrainTypes()) expect(page, t.name).toContain(`data-terrain="${t.slug}"`);
  const desert = page.slice(page.indexOf('data-terrain="desert"'), page.indexOf("</section>", page.indexOf('data-terrain="desert"')));
  expect(desert).toContain('href="/database/zones/1446-tanaris"');
  // The Desert Rose: +7% mount speed in Desert areas.
  expect(desert).toContain('href="/database/items/274648"');
  expect(desert).toContain("+7% mount speed");
  // Strongholds and Cities covers towns inside zones, named as parts.
  const cities = page.slice(page.indexOf('data-terrain="strongholds-and-cities"'));
  expect(cities).toContain("Booty Bay in <a href=\"/database/zones/1434-stranglethorn-vale\"");
  const speed = page.slice(page.indexOf('data-terrain="speed"'));
  expect(speed).toContain("+40% run speed");
  expect(speed).toContain("No area limit in the files");
  // Gaps the speed list closed: an enchant applied by an item (Mithril Spurs), a triggered sprint (Transformative
  // Cocoon), and a set bonus bound to the Plaguelands (Rider of the Plaguelands' pieces).
  expect(speed).toContain('href="/database/items/7969"');
  expect(speed).toContain('href="/database/items/276895"');
  expect(speed).toContain('href="/database/items/284102"');
  expect(speed).toContain("Set bonus (2 pieces)");
  expect(metadata.alternates?.canonical).toBe("/database/terrain");
});

test("the terrain page's hundreds of links navigate on click without prefetching", async () => {
  // Prefetching every visible row sent a burst of RSC requests that the edge answered with 429s and a challenge.
  links.length = 0;
  renderToStaticMarkup(await TerrainPage());
  expect(links.length).toBeGreaterThan(100);
  expect(links.filter((l) => l.prefetch !== false).map((l) => l.href)).toEqual([]);
});
