import { beforeEach, expect, test, vi } from "vitest";
import type { WikiPage } from "@/lib/wiki";

// The sources a page's tokens are named from, each up or down per test.
const src = vi.hoisted(() => ({ namesDown: false, worldDown: false, questsDown: false }));
const UNREACHABLE = vi.hoisted(() => Symbol("private bucket unreachable"));
vi.mock("@/lib/shown-item-names", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shown-item-names")>()),
  loadShownNames: async () => ({ facts: { unreachable: src.namesDown, rates: [] }, agreed: new Map([[2589, "Linen Cloth"]]), matched: null, degraded: src.namesDown }),
}));
vi.mock("@/lib/rollup-compute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rollup-compute")>()),
  loadWorldFacts: async () => ({ unreachable: src.worldDown, npcs: [], quests: [] }),
}));
vi.mock("@/lib/game-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game-assets")>()),
  PRIVATE_UNREACHABLE: UNREACHABLE,
  readQuestNames: async () => (src.questsDown ? UNREACHABLE : null),
}));

import { readTokens, resolveTokens } from "./wiki-names";

beforeEach(() => { src.namesDown = false; src.worldDown = false; src.questsDown = false; });

const page = (...tokens: ["item" | "npc" | "quest" | "zone", number][]): Pick<WikiPage, "blocks"> => ({
  blocks: [{ type: "paragraph", line: 1, inline: tokens.map(([entity, id]) => ({ kind: "entity", entity, id })) }],
});

test("tokens whose sources answered are not degraded, and resolveTokens is readTokens' names", async () => {
  const read = await readTokens(page(["item", 2589], ["npc", 1], ["quest", 7]));
  expect(read.degraded).toBe(false);
  expect(read.tokens.get("item:2589")?.name).toBe("Linen Cloth");
  expect(await resolveTokens(page(["item", 2589]))).toEqual((await readTokens(page(["item", 2589]))).tokens);
});

test.each([
  ["item names", () => { src.namesDown = true; }, page(["item", 2589])],
  ["world facts", () => { src.worldDown = true; }, page(["npc", 1])],
  ["quest titles", () => { src.questsDown = true; }, page(["quest", 7])],
] as const)("a token whose %s could not be read makes the page degraded", async (_, fail, p) => {
  fail();
  expect((await readTokens(p)).degraded).toBe(true);
});

test("a source a page has no token for is never read, so its outage does not degrade the page", async () => {
  src.namesDown = true;
  src.questsDown = true;
  expect((await readTokens(page(["zone", 1519]))).degraded).toBe(false);
});
