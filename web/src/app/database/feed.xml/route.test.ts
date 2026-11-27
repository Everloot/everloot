// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/database-activity-store", () => ({ loadDatabaseActivity: read }));
vi.mock("@/lib/home-live", () => ({ withPageNames: async (entries: { name: string }[]) => entries.map((e) => (e.name === "NPC #2376" ? { ...e, name: "Hogger" } : e)) }));
import { GET } from "./route";
test("valid RSS carries public entity, agreement count, date and escaped name without private fields", async () => {
  read.mockResolvedValue({ generatedAt: "2026-11-10T12:00:00Z", entries: [{ kind: "item", id: 42, name: "Cloth & <Thread>", path: "/database/items/42", installs: 3, publicAt: "2026-11-09T00:00:00Z", installId: "private-install", reporter: "Private Player" }] });
  const res = await GET();
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, "text/xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  expect(doc.querySelector("item title")?.textContent).toBe("Item: Cloth & <Thread>");
  expect(doc.querySelector("item link")?.textContent).toBe("https://everloot.app/database/items/42");
  expect(doc.querySelector("pubDate")?.textContent).toBe("Mon, 09 Nov 2026 00:00:00 GMT");
  expect(text).toContain("3 installs agree");
  expect(text).not.toMatch(/private-install|Private Player|reporter|installId/);
  expect(res.headers.get("CDN-Cache-Control")).toContain("max-age=600");
});
test("empty is valid RSS; unreadable is 503 and never cached as success", async () => {
  read.mockResolvedValue({ generatedAt: "2026-11-10T12:00:00Z", entries: [] });
  expect(await (await GET()).text()).toContain("<channel>");
  read.mockResolvedValue(null);
  const res = await GET();
  expect(res.status).toBe(503);
  expect(res.headers.get("CDN-Cache-Control")).toBe("no-store");
});

test("a fact the activity file names only by id takes its page name in the feed, as on the page", async () => {
  read.mockResolvedValue({ generatedAt: "2026-11-10T12:00:00Z", entries: [{ kind: "npc", id: 2376, name: "NPC #2376", path: "/database/npcs/2376", installs: 3, publicAt: "2026-11-09T00:00:00Z" }] });
  const doc = new DOMParser().parseFromString(await (await GET()).text(), "text/xml");
  expect(doc.querySelector("item title")?.textContent).toBe("NPC: Hogger");
  expect(doc.querySelector("item category")?.textContent).toBe("npc");
});
