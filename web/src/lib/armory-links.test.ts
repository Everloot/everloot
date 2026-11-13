import { afterEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), facts: vi.fn() }));
vi.mock("./supabase/server", () => ({ authQuery: mock.query }));
vi.mock("./private-sync-store", () => ({ publicCharacterFacts: mock.facts }));
import { publicArmoryLink } from "./armory-links";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
test("public acknowledgment is absent without a consent-checked association", async () => {
  vi.stubEnv("EVERLOOT_SHOWCASE", "");
  expect(await publicArmoryLink("us", "ember-vale")).toBeNull();
  expect(mock.query).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_SHOWCASE", "1"); mock.query.mockResolvedValue([]);
  expect(await publicArmoryLink("us", "ember-vale")).toBeNull();
  expect(mock.facts).not.toHaveBeenCalled();
});
test("only consented published facts earn the shared-data label, not mere link creation", async () => {
  vi.stubEnv("EVERLOOT_SHOWCASE", "1"); vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1"); vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  mock.query.mockResolvedValue([{ ruleset: "forever", realm: "US1 Realm 4 PvP", name: "Ember", last_seen: "2026-11-12" }]);
  mock.facts.mockResolvedValue([]);
  expect(await publicArmoryLink("us", "ember-vale")).toMatchObject({ sharesData: false, path: "/characters/forever/us1-realm-4-pvp/ember" });
  mock.facts.mockResolvedValue([{ category: "gear" }]);
  expect(await publicArmoryLink("us", "ember-vale")).toMatchObject({ sharesData: true });
  mock.facts.mockRejectedValue(new Error("down"));
  expect(await publicArmoryLink("us", "ember-vale")).toMatchObject({ sharesData: false });
});
