import { afterEach, expect, test, vi } from "vitest";

const release = vi.hoisted(() => ({ db: { all: vi.fn() } }));
vi.mock("./release", () => ({ getRelease: async () => release }));
vi.mock("./rollup-compute", () => ({
  loadItemFacts: async () => ({ unreachable: false }),
  loadWorldFacts: async () => ({ unreachable: false }),
}));
vi.mock("./names", () => ({
  loadNames: async () => ({ npcs: new Map([[448, "Hogger"]]), items: new Map(), quests: new Map() }),
  idForName: () => 448,
}));

import { lorePaths } from "./lore-forever";

afterEach(() => vi.restoreAllMocks());

test("a release query that fails after the release opens gives null, so the lore sitemaps answer 503", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  release.db.all.mockRejectedValue(new Error("D1_ERROR: network"));
  await expect(lorePaths()).resolves.toBeNull();
});
