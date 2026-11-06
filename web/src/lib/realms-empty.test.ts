import { expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../kb/src/market";

// The realm map as it is until launch: empty. Everything must behave as it did before the map existed.
vi.mock("../data/realms", async (importOriginal) => ({ ...(await importOriginal<typeof import("../data/realms")>()), REALMS: [] }));

const { boardsByRuleset, houseCounts, realmBoards, rulesetSummaries } = await import("./auction-house");
const { playerPath } = await import("./player-pages");
const { createCloudPlayerStore, createMemoryPlayerStore } = await import("./player-store");
const { DEFAULT_RULESET, realmInfo, realmRuleset } = await import("./realms");

test("with the map empty every realm is forever, and nothing is guessed", () => {
  for (const realm of ["Forever", "Mal'Ganis", "Some PvP Realm", "", "  "]) {
    expect(realmRuleset(realm)).toBe(DEFAULT_RULESET);
    expect(realmInfo(realm)).toBeNull();
  }
  expect(playerPath({ ruleset: realmRuleset("Forever Pioneer"), realm: "Forever Pioneer", name: "Thrallina" })).toBe("/characters/forever/forever-pioneer/thrallina");
});

const now = new Date("2026-11-10T12:00:00.000Z");
const scans = (realm: string, items: [number, number][]) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, capturedAt: now.toISOString(), realm, items: items.map(([id, value]) => [id, 2, 40, value, value]),
}));
const state = foldMarket(emptyMarket(), [...scans("Forever", [[2589, 205], [765, 33]]), ...scans("Mal'Ganis", [[2589, 300]])], now);

test("with the map empty the Auction House groups every realm under forever, and the rulesets say they are not mapped", () => {
  const boards = realmBoards(state, now);
  expect(boards.map((b) => [b.realm.slug, b.realm.ruleset])).toEqual([["forever", "forever"], ["malganis", "forever"]]);
  expect([...boardsByRuleset(boards).keys()]).toEqual(["forever"]);
  const summaries = rulesetSummaries(state, now);
  // Hardcore opens after launch and has no line until a realm is mapped to it.
  expect(summaries.map((s) => [s.ruleset, s.mapped, s.realms, s.items])).toEqual([
    ["normal", false, 0, 0], ["pvp", false, 0, 0], ["rp", false, 0, 0], ["rp-pvp", false, 0, 0], ["forever", true, 2, 2],
  ]);
  expect(summaries.at(-1)!.updatedAt).toBe(now.getTime());
  // The house switch counts the same with and without a ruleset of "every realm".
  expect(houseCounts(state, now)).toEqual(houseCounts(state, now, undefined, null));
});

test("with the map empty the player store writes and reads every row as forever, in one call per upload", async () => {
  const calls: { fn: string; body: Record<string, unknown> }[] = [];
  const doFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ fn: String(url).split("/").at(-1)!, body: JSON.parse(String(init?.body)) });
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  const cloud = createCloudPlayerStore("https://db.example", "key", doFetch);
  const row = (name: string, realm: string) => ({ name, realm, race: "Orc", class: "SHAMAN", level: 24, seen: "2026-11-05" });
  await cloud.upsert([row("Aa", "Forever Pioneer"), row("Bb", "Mal'Ganis")]);
  await cloud.guildMembers("Mal'Ganis", "the guild");
  expect(calls.map((c) => [c.fn, c.body.p_ruleset])).toEqual([["upsert_players", "forever"], ["guild_members", "forever"]]);
  expect(calls[0]!.body.p_rows).toHaveLength(2);

  const memory = createMemoryPlayerStore(() => now);
  await memory.upsert([row("Thrallina", "Forever Pioneer")]);
  expect((await memory.get("forever", "forever-pioneer", "thrallina"))?.ruleset).toBe("forever");
});
