import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ links: vi.fn(), facts: vi.fn() }));
vi.mock("./armory-links", () => ({ ownArmoryLinks: store.links }));
vi.mock("./private-sync-store", () => ({ ownCharacterFacts: store.facts }));

import { ownGold } from "./own-gold";

const USER = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
  store.links.mockReset().mockResolvedValue(new Map([["a", "/armory/us/thrall-doomhammer"], ["b", "/armory/us/jaina-proudmoore"]]));
  store.facts.mockReset().mockImplementation(async (_user: string, linkId: string) => [
    { category: "gold", consented: linkId === "a", fact: { category: "gold", capturedAt: "2026-11-20T00:00:00Z", data: { stats: { 328: 100, 334: 50 } } } },
  ]);
});
afterEach(() => { vi.unstubAllEnvs(); });

test("only the account's own links with gold sync consented, keyed by the armory path", async () => {
  expect(await ownGold(USER)).toEqual(new Map([["/armory/us/thrall-doomhammer", { 328: 100, 334: 50 }]]));
  expect(store.links).toHaveBeenCalledWith(USER);
  expect(store.facts.mock.calls.every(([user]) => user === USER)).toBe(true);
});

test("null with private sync off (nothing read) or when a read fails", async () => {
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "0");
  expect(await ownGold(USER)).toBeNull();
  expect(store.links).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
  store.links.mockRejectedValue(new Error("down"));
  expect(await ownGold(USER)).toBeNull();
});
