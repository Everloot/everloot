import { expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../kb/src/market";

// The realm map as it might read on launch day: two PvP realms, one Normal, one Hardcore; Forever stays unlisted.
vi.mock("../data/realms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/realms")>()),
  REALMS: [
    { name: "Mal'Ganis", ruleset: "pvp", region: "us" },
    { name: "Nightfall", ruleset: "pvp", region: "eu" },
    { name: "Argent Dawn", ruleset: "normal", region: "us" },
    { name: "Doomhowl", ruleset: "hardcore", region: "us" },
  ],
}));

const { boardsByRuleset, houseCounts, onRuleset, realmBoards, rulesetSummaries } = await import("./auction-house");
const { realmInfo, realmRuleset } = await import("./realms");
const { createCloudPlayerStore, createMemoryPlayerStore } = await import("./player-store");
const { playerPath, rulesetOf } = await import("./player-pages");

const now = new Date("2026-11-10T12:00:00.000Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
const scans = (realm: string, daysAgo: number, items: [number, number][], faction?: string) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, capturedAt: at(daysAgo), realm, ...(faction ? { faction } : {}),
  items: items.map(([id, value]) => [id, 2, 40, value, value]),
}));
const state = foldMarket(emptyMarket(), [
  ...scans("Mal'Ganis", 0, [[2589, 300], [765, 40]]),
  ...scans("Mal'Ganis", 7, [[765, 20]]),
  ...scans("Nightfall", 0, [[2589, 250], [2592, 90]], "Horde"),
  ...scans("Nightfall", 7, [[2592, 100]], "Horde"),
  ...scans("Forever", 0, [[4306, 950]]),
], now);

test("a listed realm gets its ruleset and region under any spelling; an unlisted one stays forever", () => {
  expect(realmRuleset("Mal'Ganis")).toBe("pvp");
  expect(realmRuleset("mal'ganis")).toBe("pvp");
  expect(realmRuleset("argent-dawn")).toBe("normal");
  expect(realmInfo("Nightfall")).toEqual({ ruleset: "pvp", region: "eu" });
  expect(realmRuleset("Forever")).toBe("forever");
  expect(realmInfo("Forever")).toBeNull();
});

test("the boards group ruleset, then realm, then house; unmapped realms come last as forever", () => {
  const boards = realmBoards(state, now);
  expect(boards.map((b) => [b.realm.name, b.realm.ruleset])).toEqual([["Mal'Ganis", "pvp"], ["Nightfall", "pvp"], ["Forever", "forever"]]);
  const groups = boardsByRuleset(boards);
  expect([...groups.keys()]).toEqual(["pvp", "forever"]);
  expect(groups.get("pvp")!.map((b) => b.realm.slug)).toEqual(["malganis", "nightfall"]);
  expect(onRuleset(boards, "normal")).toEqual([]);
  expect(onRuleset(boards, null)).toBe(boards);
  // The house level under the ruleset: Nightfall's Horde scans are the only Horde board.
  expect(boardsByRuleset(realmBoards(state, now, "Horde")).get("pvp")!.map((b) => b.realm.slug)).toEqual(["nightfall"]);
  expect(houseCounts(state, now, undefined, "pvp").get(null)).toBe(3);
  expect(houseCounts(state, now, undefined, "pvp").get("Horde")).toBe(2);
  expect(houseCounts(state, now, undefined, "normal").get(null)).toBe(0);
});

test("each ruleset's summary counts its own realms, says when it is mapped but empty, and shows Hardcore once mapped", () => {
  const byRuleset = Object.fromEntries(rulesetSummaries(state, now).map((s) => [s.ruleset, s]));
  expect(Object.keys(byRuleset)).toEqual(["normal", "pvp", "rp", "rp-pvp", "hardcore", "forever"]);
  expect(byRuleset.pvp).toMatchObject({ mapped: true, realms: 2, items: 3, updatedAt: Date.parse(at(0)) });
  // The biggest week moves first: 765 doubled on Mal'Ganis, 2592 fell 10% on Nightfall.
  expect(byRuleset.pvp!.moves.map((m) => [m.row.realm.slug, m.row.value.itemId, Math.round(m.change * 100)])).toEqual([["malganis", 765, 100], ["nightfall", 2592, -10]]);
  expect(byRuleset.normal).toMatchObject({ mapped: true, realms: 0, items: 0, updatedAt: null, moves: [] });
  expect(byRuleset.rp).toMatchObject({ mapped: false, items: 0 });
  expect(byRuleset.hardcore).toMatchObject({ mapped: true, items: 0 });
  expect(byRuleset.forever).toMatchObject({ mapped: true, realms: 1, items: 1 });
});

test("mapping a realm leaves player, guild and link addresses on forever, so no player is split into two rows", async () => {
  const calls: Record<string, unknown>[] = [];
  const doFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  const row = (name: string, realm: string) => ({ name, realm, race: "Orc", class: "SHAMAN", level: 24, seen: "2026-11-05" });
  const cloud = createCloudPlayerStore("https://db.example", "key", doFetch);
  await cloud.upsert([row("Aa", "Mal'Ganis"), row("Bb", "Forever"), row("Cc", "Nightfall")]);
  await cloud.guildMembers("Mal'Ganis", "the guild");
  expect(calls.map((c) => c.p_ruleset)).toEqual(["forever", "forever"]);
  expect((calls[0]!.p_rows as { name: string }[]).map((r) => r.name)).toEqual(["Aa", "Bb", "Cc"]);
  expect(rulesetOf("Mal'Ganis")).toBe("forever");
  expect(playerPath({ ruleset: rulesetOf("Mal'Ganis"), realm: "Mal'Ganis", name: "Thrallina" })).toBe("/players/forever/mal'ganis/thrallina");

  const memory = createMemoryPlayerStore(() => now);
  await memory.upsert([row("Thrallina", "Mal'Ganis")]);
  expect((await memory.get("forever", "mal'ganis", "thrallina"))?.ruleset).toBe("forever");
  expect(await memory.get("pvp", "mal'ganis", "thrallina")).toBeNull();
});
