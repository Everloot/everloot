import { afterEach, expect, test, vi } from "vitest";

const release = vi.hoisted(() => ({ db: { all: vi.fn(), get: vi.fn() } }));
vi.mock("./release", () => ({ getRelease: async () => release }));
vi.mock("./rollup-compute", () => ({
  loadItemFacts: async () => ({ unreachable: false }),
  loadWorldFacts: async () => ({ unreachable: false }),
}));
vi.mock("./names", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./names")>()),
  npcNames: () => new Map([[448, "Hogger"]]),
  itemNames: () => new Map(),
  objectNames: () => new Map(),
  questTitles: () => new Map(),
}));

import { lorePaths } from "./lore-forever";
import { loreFor } from "./lore-links";
import { loreForEntity } from "./lore";
import { zoneLore } from "./zone-lore";

afterEach(() => vi.restoreAllMocks());

test("a release query that fails after the release opens gives null, so the lore sitemaps answer 503", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  release.db.all.mockRejectedValue(new Error("D1_ERROR: network"));
  await expect(lorePaths()).resolves.toBeNull();
});

test("a lore lookup that fails after the release opens is unavailable (no link, the page still renders), and is asked again next time", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  release.db.all.mockReset().mockRejectedValue(new Error("D1_ERROR: network"));
  await expect(loreForEntity("npc", "Hogger")).resolves.toBe("unavailable");
  await expect(loreFor("npc", 448, "Hogger")).resolves.toBe("unavailable");
  await expect(zoneLore(1436, "Westfall")).resolves.toBe("unavailable");
  // The failure was not kept: once the release answers, the same name links.
  const body = `Hogger is a gnoll. ${"He raids farms. ".repeat(30)}`;
  release.db.all.mockReset().mockResolvedValue([{ extId: "310", name: "Hogger", body, sourceId: "warcraft-wiki-2023" }]);
  await expect(loreForEntity("npc", "Hogger")).resolves.toMatchObject({ extId: "310" });
  await expect(loreFor("npc", 448, "Hogger")).resolves.toMatchObject({ extId: "310" });
});

test("a lore page whose archive lookup fails has no standing (unavailable), not a 'no link, noindex' one; it recovers", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Fresh modules: the test above left Hogger's answer in the lookup cache.
  vi.resetModules();
  const { loreStandingFor } = await import("./lore-links");
  const body = `Hogger is a gnoll. ${"He raids farms. ".repeat(30)}`;
  const page = { extId: "310", sourceId: "warcraft-wiki-2023", type: "npc" as const, name: "Hogger", body };
  release.db.all.mockReset().mockRejectedValue(new Error("D1_ERROR: network"));
  await expect(loreStandingFor(page)).resolves.toBe("unavailable");
  release.db.all.mockReset().mockResolvedValue([{ extId: "310", name: "Hogger", body, sourceId: "warcraft-wiki-2023" }]);
  await expect(loreStandingFor(page)).resolves.toEqual({ link: { kind: "npc", id: 448, name: "Hogger" }, index: true });
});
