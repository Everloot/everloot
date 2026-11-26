import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { armoryGuild } from "./armory.fixture";
import { createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "./armory-store";
import { playerStore } from "./player-store";

const holder = vi.hoisted(() => ({ store: null as ArmoryStore | null }));
vi.mock("./armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./armory-store")>()), armoryStore: () => holder.store }));

const held = globalThis as typeof globalThis & { __everlootPlayers?: unknown };
let mem: MemoryArmoryStore;
beforeEach(() => {
  held.__everlootPlayers = undefined;
  mem = createMemoryArmoryStore(() => new Date("2026-11-10T00:00:00Z"));
  // Fatal is on US Normal, as the live armory has it; Glizzy Gang is on both EU and US, a different guild in each.
  mem.putGuild(armoryGuild({ region: "us", slug: "fatal", name: "Fatal", rulesetId: 2, ruleset: "Normal" }), []);
  mem.putGuild(armoryGuild({ region: "eu", slug: "glizzy-gang", name: "Glizzy Gang", rulesetId: 2, ruleset: "Normal" }), []);
  mem.putGuild(armoryGuild({ region: "us", slug: "frères-de-sang", name: "Frères de Sang", rulesetId: 2, ruleset: "Normal" }), []);
  holder.store = mem;
  vi.stubEnv("EVERLOOT_ARMORY", "1");
});
afterEach(() => { vi.unstubAllEnvs(); held.__everlootPlayers = undefined; });

describe("the armory guild an addon guild is", () => {
  test("reads the region from the realm's name and the ruleset from its ending, and slugs the name as the armory does", async () => {
    const { armoryKeyOf } = await import("./guild-merge");
    expect(armoryKeyOf("CAMWOW US1 Realm 3 PvE", "Fatal")).toEqual({ region: "us", slug: "fatal", rulesetId: 2 });
    expect(armoryKeyOf("CAMWOW US1 Realm 4 PvP", "Je me Souviens")).toEqual({ region: "us", slug: "je-me-souviens", rulesetId: 1 });
    expect(armoryKeyOf("CAMWOW EU2 Realm 9 RPPVP", "Glizzy Gang")).toEqual({ region: "eu", slug: "glizzy-gang", rulesetId: 15 });
    expect(armoryKeyOf("camwow-eu1-realm-2-rp", "Ash Pact")).toEqual({ region: "eu", slug: "ash-pact", rulesetId: 3 });
    // Accents stay: the armory's slug is the name in lower case, where the addon address drops them.
    expect(armoryKeyOf("CAMWOW US1 Realm 3 PvE", "Frères de Sang")).toEqual({ region: "us", slug: "frères-de-sang", rulesetId: 2 });
    // A realm whose name does not say its ending matches on region and name alone.
    expect(armoryKeyOf("CAMWOW US1 Realm 7", "Fatal")).toEqual({ region: "us", slug: "fatal", rulesetId: null });
  });

  test("is no guild when the realm names no armory region, or the ruleset has no armory id", async () => {
    const { armoryKeyOf } = await import("./guild-merge");
    expect(armoryKeyOf("Olympus", "Fatal")).toBeNull();
    expect(armoryKeyOf("Busy KR1 Realm", "Fatal")).toBeNull();
    expect(armoryKeyOf("CAMWOW US1 Realm 5 Hardcore", "Fatal")).toBeNull();
    expect(armoryKeyOf("CAMWOW US1 Realm 3 PvE", "!!")).toBeNull();
  });

  test("matches a stored armory guild on region, slug and ruleset", async () => {
    const { armoryGuildOf } = await import("./guild-merge");
    expect(await armoryGuildOf("CAMWOW US1 Realm 3 PvE", "Fatal")).toMatchObject({ region: "us", slug: "fatal" });
    expect(await armoryGuildOf("CAMWOW US1 Realm 3 PvE", "Frères de Sang")).toMatchObject({ region: "us", slug: "frères-de-sang" });
    // Same name, other region: the EU Glizzy Gang is not the US one.
    expect(await armoryGuildOf("CAMWOW US1 Realm 3 PvE", "Glizzy Gang")).toBeNull();
    // Same region and name, other ruleset: not the same guild.
    expect(await armoryGuildOf("CAMWOW US1 Realm 4 PvP", "Fatal")).toBeNull();
    expect(await armoryGuildOf("CAMWOW US1 Realm 7", "Fatal")).toMatchObject({ slug: "fatal" });
  });

  test("is no guild with the armory off, when the guild is hidden, or when the armory cannot be read", async () => {
    const { armoryGuildOf } = await import("./guild-merge");
    vi.stubEnv("EVERLOOT_ARMORY", "");
    expect(await armoryGuildOf("CAMWOW US1 Realm 3 PvE", "Fatal")).toBeNull();
    vi.stubEnv("EVERLOOT_ARMORY", "1");
    await playerStore().suppressGuild("CAMWOW US1 Realm 3 PvE", "Fatal");
    expect(await armoryGuildOf("CAMWOW US1 Realm 3 PvE", "Fatal")).toBeNull();
    holder.store = { ...mem, guild: async () => { throw new Error("down"); } } as ArmoryStore;
    expect(await armoryGuildOf("CAMWOW US1 Realm 3 PvE", "Frères de Sang")).toBeNull();
  });

  test("an addon guild row is the armory guild when its key matches", async () => {
    const { sameGuild } = await import("./guild-merge");
    const fatal = armoryGuild({ region: "us", slug: "fatal", name: "Fatal", rulesetId: 2 });
    expect(sameGuild({ realm: "CAMWOW US1 Realm 3 PvE", guildName: "Fatal" }, fatal)).toBe(true);
    expect(sameGuild({ realm: "CAMWOW US1 Realm 3 PvE", guildName: "fatal " }, fatal)).toBe(true);
    expect(sameGuild({ realm: "CAMWOW EU1 Realm 3 PvE", guildName: "Fatal" }, fatal)).toBe(false);
    expect(sameGuild({ realm: "CAMWOW US1 Realm 4 PvP", guildName: "Fatal" }, fatal)).toBe(false);
    expect(sameGuild({ realm: "CAMWOW US1 Realm 3 PvE", guildName: "Fatalis" }, fatal)).toBe(false);
  });
});
