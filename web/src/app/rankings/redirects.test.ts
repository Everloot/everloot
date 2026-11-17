import { expect, test, vi } from "vitest";

const nav = vi.hoisted(() => ({ permanentRedirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT 308 ${to}`); }) }));
vi.mock("next/navigation", () => nav);

import ItemLevel, { dynamic as itemLevelDynamic } from "./item-level/page";
import GearScore, { dynamic as gearScoreDynamic } from "./gear-score/page";

test("the synced gear boards' addresses redirect (308) to the matching armory board, on every request", () => {
  expect(() => ItemLevel()).toThrow("NEXT_REDIRECT 308 /armory/rankings/item-level");
  expect(() => GearScore()).toThrow("NEXT_REDIRECT 308 /armory/rankings/gear-score");
  expect(nav.permanentRedirect.mock.calls).toEqual([["/armory/rankings/item-level"], ["/armory/rankings/gear-score"]]);
  expect([itemLevelDynamic, gearScoreDynamic]).toEqual(["force-dynamic", "force-dynamic"]);
});
