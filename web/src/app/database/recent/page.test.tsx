import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const read = vi.hoisted(() => vi.fn());
const noStore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/database-activity-store", () => ({ loadDatabaseActivity: read }));
vi.mock("next/cache", () => ({ unstable_noStore: noStore }));
// The page names, as home-live reads them for the home panels (its own tests cover the reading): here two stand-ins.
vi.mock("@/lib/home-live", () => ({ withPageNames: async (entries: { name: string }[]) => entries.map((e) => ({ ...e, name: ({ "NPC #2376": "Hogger", "Item #249881": "Linen Cloth" } as Record<string, string>)[e.name] ?? e.name })) }));
import Page from "./page";
test("shows the fact, date, agreement count and entity link", async () => {
  read.mockResolvedValue({ generatedAt: "2026-11-10T12:34:56Z", entries: [{ kind: "npc", id: 7, name: "Test Guard", path: "/database/npcs/7", installs: 4, publicAt: "2026-11-09T00:00:00Z" }] });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Test Guard");
  expect(html).toContain('dateTime="2026-11-10T12:34:56Z"');
  expect(html).toContain('href="/database/npcs/7"');
  expect(html).toContain("2026-11-09");
  expect(html).toContain(">4</td>");
});
test("distinguishes empty data from unreadable data with degraded marker and no-store", async () => {
  read.mockResolvedValue({ generatedAt: "2026-11-10T12:34:56Z", entries: [] });
  expect(renderToStaticMarkup(await Page())).toContain("No new public facts");
  read.mockResolvedValue(null);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("temporarily unavailable");
  expect(html).toContain('name="everloot-degraded"');
  expect(html).not.toContain("No new public facts");
  expect(noStore).toHaveBeenCalled();
});

test("facts the activity file names only by id take their page names, kinds read as words, and the build time is short", async () => {
  read.mockResolvedValue({ generatedAt: "2026-11-27T11:01:42.276Z", entries: [
    { kind: "npc", id: 2376, name: "NPC #2376", path: "/database/npcs/2376", installs: 3, publicAt: "2026-11-27T00:00:00Z" },
    { kind: "item", id: 249881, name: "Item #249881", path: "/database/items/249881", installs: 3, publicAt: "2026-11-27T00:00:00Z" },
    { kind: "object", id: 660624, name: "Object #660624", path: "/database/objects/660624", installs: 3, publicAt: "2026-11-27T00:00:00Z" },
  ] });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain(">Hogger</a>");
  expect(html).toContain(">Linen Cloth</a>");
  // A fact no page names either keeps the fallback.
  expect(html).toContain(">Object #660624</a>");
  for (const kind of ["NPC", "Item", "Object"]) expect(html).toContain(`<td>${kind}</td>`);
  expect(html).not.toMatch(/<td>(npc|item|object)<\/td>/);
  expect(html).toMatch(/Built <time dateTime="2026-11-27T11:01:42.276Z">27 Nov, 11:01 UTC<\/time>/);
  expect(html).not.toContain(">2026-11-27T11:01:42.276Z<");
});
