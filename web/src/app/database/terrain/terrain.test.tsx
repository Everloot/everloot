import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: async () => ({ uploads: 0, records: [], dataAsOf: null }) },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

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
  expect(speed).toContain("Anywhere");
  expect(metadata.alternates?.canonical).toBe("/database/terrain");
});
