import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

/** The zone pages' Places tab, and the achievement list's categories, both from the game files. */

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-store")>()),
  uploadStore: { loadCorpus: store.loadCorpus, loadCompletion: async () => ({ state: null, dataAsOf: null }) },
}));
vi.mock("@/lib/zone-lore", () => ({ zoneLore: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/components/ui/OpenData", () => ({ default: ({ text }: { text: string }) => <pre data-open-data>{text}</pre> }));

import ZonePage from "./zones/[zone]/page";
import AchievementList from "./achievements/page";
import { zonePlaces } from "@/lib/places";

const html = async (el: Promise<ReactNode>) => renderToStaticMarkup(await el);

beforeEach(() => store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-11-25T00:00:00.000Z" }));

test("a zone's places: its subzones, and the points of interest its own areas hold, at their spot", () => {
  const elwynn = zonePlaces(1429)!;
  expect(elwynn.subzones.map((s) => s.name)).toEqual(expect.arrayContaining(["Goldshire", "Northshire Valley", "Crystal Lake"]));
  // Maclure Vineyards' area leads to Elwynn: it sits in the zone's south, on the map.
  const vineyards = elwynn.pois.find((p) => p.name === "Maclure Vineyards")!;
  expect(vineyards.x).toBeGreaterThan(0);
  expect(vineyards.y).toBeGreaterThan(50);
  // A point with no area is left out, not guessed from overlapping rectangles: Darkshire is in no zone's list.
  expect([1429, 1430, 1431].some((z) => zonePlaces(z)!.pois.some((p) => p.name === "Darkshire"))).toBe(false);
});

test("a zone page has a Places tab, labelled from the game files, that stays when storage is down", async () => {
  const out = await html(ZonePage({ params: Promise.resolve({ zone: "1429-elwynn-forest" }) }));
  expect(out).toContain(">Places");
  expect(out).toContain("The places the game files name in Elwynn Forest");
  expect(out).toContain("Found in game files, unconfirmed");
  expect(out).toMatch(/Subzones \(\d+\)/);
  expect(out).toMatch(/href="\/map[^"]*"[^>]*>Show on the map/);
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  expect(await html(ZonePage({ params: Promise.resolve({ zone: "1429-elwynn-forest" }) }))).toContain("The places the game files name in Elwynn Forest");
});

test("achievements the files list carry the files' category, so the list filters by it", async () => {
  const out = await html(AchievementList({ searchParams: Promise.resolve({ category: "Eastern Kingdoms" }) }));
  expect(out).toContain("Explore Dun Morogh");
  expect(out).not.toContain("No achievements match these filters.");
});
