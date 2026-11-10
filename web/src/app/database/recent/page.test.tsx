import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const read = vi.hoisted(() => vi.fn());
const noStore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/database-activity-store", () => ({ loadDatabaseActivity: read }));
vi.mock("next/cache", () => ({ unstable_noStore: noStore }));
import Page from "./page";
test("shows the fact, date, agreement count and entity link", async () => {
  read.mockResolvedValue({ entries: [{ kind: "npc", id: 7, name: "Test Guard", path: "/database/npcs/7", installs: 4, publicAt: "2026-11-09T00:00:00Z" }] });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Test Guard");
  expect(html).toContain('href="/database/npcs/7"');
  expect(html).toContain("2026-11-09");
  expect(html).toContain(">4</td>");
});
test("distinguishes empty data from unreadable data with degraded marker and no-store", async () => {
  read.mockResolvedValue({ entries: [] });
  expect(renderToStaticMarkup(await Page())).toContain("No new public facts");
  read.mockResolvedValue(null);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("temporarily unavailable");
  expect(html).toContain('name="everloot-degraded"');
  expect(html).not.toContain("No new public facts");
  expect(noStore).toHaveBeenCalled();
});
