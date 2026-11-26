import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "./armory-store";
import { createMemoryPlayerStore, type PlayerStore } from "./player-store";

const held = vi.hoisted(() => ({ players: null as PlayerStore | null, armory: null as ArmoryStore | null }));
vi.mock("./player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./player-store")>()), playerStore: () => held.players }));
vi.mock("./armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./armory-store")>()), armoryStore: () => held.armory }));

import { armoryCharacter } from "./armory.fixture";
import { addonSighting, armoryMatch } from "./character-match";
import type { Player } from "./player-pages";

// Invented characters only.
const SEEN = { name: "Velkara", realm: "EU1 Realm 2 Normal", race: "Troll", class: "HUNTER", level: 58, guild: "Ember Wardens", seen: "2026-11-12" };
let mem: MemoryArmoryStore;
let sighting: Player;

beforeEach(async () => {
  vi.stubEnv("EVERLOOT_ARMORY", "1");
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  held.players = createMemoryPlayerStore();
  await held.players.upsert([SEEN]);
  sighting = (await held.players.get("forever", "eu1-realm-2-normal", "velkara"))!;
  mem = createMemoryArmoryStore();
  mem.putCharacter(armoryCharacter());
  held.armory = mem;
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("the armory character a sighting is", () => {
  test("one first name in one region, guilds agreeing, one of each: that character", async () => {
    expect(await armoryMatch(sighting)).toMatchObject({ region: "eu", slug: "velkara-duskmantle" });
  });

  test("anything less than certain is no match", async () => {
    // A second Velkara in the region: which one the addon saw is not known.
    mem.putCharacter(armoryCharacter({ slug: "velkara-stone", surname: "Stone" }));
    expect(await armoryMatch(sighting)).toBeNull();
  });

  test("a guild the armory reads differently is no match", async () => {
    mem.putCharacter(armoryCharacter({ guildName: "Night Watch", guildSlug: "night-watch" }));
    expect(await armoryMatch(sighting)).toBeNull();
  });

  test("another region, a hidden armory character, or the armory off is no match", async () => {
    await held.players!.upsert([{ ...SEEN, realm: "CAMWOW US1 Realm 4 PvP" }]);
    const us = (await held.players!.get("forever", "camwow-us1-realm-4-pvp", "velkara"))!;
    // The US sighting is another character; the EU one still is the EU armory character.
    expect(await armoryMatch(us)).toBeNull();
    expect(await armoryMatch(sighting)).not.toBeNull();
    // A second EU sighting of the name: neither is certain.
    await held.players!.upsert([{ ...SEEN, realm: "EU1 Realm 3 PvP" }]);
    expect(await armoryMatch(sighting)).toBeNull();
    await held.players!.suppress("EU1 Realm 3 PvP", "Velkara");
    expect(await armoryMatch(sighting)).not.toBeNull();
    await mem.hide("eu", "velkara-duskmantle");
    expect(await armoryMatch(sighting)).toBeNull();
    vi.stubEnv("EVERLOOT_ARMORY", "0");
    expect(await armoryMatch(sighting)).toBeNull();
  });

  test("an answer that reached the armory search's cap may have left a namesake out, so it decides nothing", async () => {
    const hit = { region: "eu", slug: "velkara-duskmantle", name: "Velkara", surname: "Duskmantle", level: 60, class: "Hunter", race: "Troll", ruleset: "Normal", guildName: "Ember Wardens" };
    held.armory = { search: async (_p: string, limit: number) => [hit, ...Array.from({ length: limit - 1 }, (_, i) => ({ ...hit, slug: `velkaran-x${i}`, name: "Velkaran" }))] } as unknown as ArmoryStore;
    expect(await armoryMatch(sighting)).toBeNull();
  });

  test("storage out of reach is no match, never a throw", async () => {
    held.armory = { search: async () => { throw new Error("down"); } } as unknown as ArmoryStore;
    expect(await armoryMatch(sighting)).toBeNull();
  });
});

describe("the sighting an armory character is", () => {
  test("the same rule read from the other side", async () => {
    expect(await addonSighting(armoryCharacter())).toMatchObject({ realm: "EU1 Realm 2 Normal", guild: "Ember Wardens", lastSeen: "2026-11-12" });
    mem.putCharacter(armoryCharacter({ slug: "velkara-stone", surname: "Stone" }));
    expect(await addonSighting(armoryCharacter())).toBeNull();
  });

  test("a hidden sighting, or the player pages off, is none", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "0");
    expect(await addonSighting(armoryCharacter())).toBeNull();
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    await held.players!.suppress("EU1 Realm 2 Normal", "Velkara");
    expect(await addonSighting(armoryCharacter())).toBeNull();
  });
});
