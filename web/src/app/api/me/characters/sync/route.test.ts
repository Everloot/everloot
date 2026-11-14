import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));
const quota = vi.hoisted(() => ({ syncKey: vi.fn() }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { syncKey: quota.syncKey } }));

import { hashKey } from "@/lib/api-keys";
import { POST } from "./route";

const SECRET = "k".repeat(40);
const ACCOUNT = "11111111-2222-4333-8444-555555555555";
const KEY = `evl_${"a".repeat(64)}`;
const INSTALL = "install-1234";
const CHARACTER_KEY = "0a1b2c3d";
const owned = { installId: INSTALL, characterKey: CHARACTER_KEY, class: "SHAMAN", level: 60 };
const gear = {
  kind: "gear_snapshot", installId: INSTALL, capturedAt: "2026-11-05T10:00:00Z", character: "Thrallina", realm: "Forever Pioneer",
  equipped: [{ slot: "HeadSlot", itemId: 16_842, itemLevel: 66 }],
};
const profession = { kind: "profession_owned", ...owned, capturedAt: "2026-11-05T11:00:00Z", profession: "Mining", rank: 280, maxRank: 300 };
const reputation = { kind: "reputation_owned", ...owned, capturedAt: "2026-11-05T09:00:00Z", factionId: 76, reaction: 7, standing: 30_000, floor: 21_000, ceiling: 42_000 };

const send = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${KEY}` }) =>
  POST(new Request("https://everloot.app/api/me/characters/sync", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const thrallina = (records: unknown[]) => ({ characters: [{ name: "Thrallina", realm: "Forever Pioneer", records }] });
/** The key's account, then one answer per sync_character_facts call. */
const answers = (...calls: unknown[]) => {
  auth.authQuery.mockResolvedValueOnce([{ account: ACCOUNT, refusal: null }]);
  for (const c of calls) auth.authQuery.mockResolvedValueOnce(c);
};
const sentToDatabase = () => JSON.stringify(auth.authQuery.mock.calls);
const syncCalls = () => auth.authQuery.mock.calls.filter((c) => c[0] === "rpc/sync_character_facts").map((c) => JSON.parse(c[1].body));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHARACTER_LINKS", "1");
  vi.stubEnv("EVERLOOT_PRIVATE_SYNC", "1");
  vi.stubEnv("EVERLOOT_CHARACTER_KEY", SECRET);
  auth.getUser.mockReset().mockResolvedValue({ id: ACCOUNT, name: "Thrall#1" });
  auth.authQuery.mockReset();
  quota.syncKey.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off (or character links off) it is a 404 and nothing is read", async () => {
  for (const [links, sync] of [["1", ""], ["1", "true"], ["", "1"]]) {
    vi.stubEnv("EVERLOOT_CHARACTER_LINKS", links);
    vi.stubEnv("EVERLOOT_PRIVATE_SYNC", sync);
    expect((await send(thrallina([gear]))).status).toBe(404);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
});

describe("who may sync", () => {
  test("only a sync:own key: a session, even from this site, is 401 and nothing is read", async () => {
    const res = await send(thrallina([gear]), { origin: "https://everloot.app" });
    expect(res.status).toBe(401);
    expect(auth.authQuery).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  test("a key without sync:own is 403; an unknown or revoked key 401; nothing is synced", async () => {
    auth.authQuery.mockResolvedValueOnce([{ account: null, refusal: "no_scope" }]);
    expect((await send(thrallina([gear]))).status).toBe(403);
    auth.authQuery.mockResolvedValueOnce([{ account: null, refusal: "unknown_key" }]);
    const revoked = await send(thrallina([gear]));
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain("invalid_token");
    expect(auth.authQuery.mock.calls.map((c) => c[0])).toEqual(["rpc/sync_account_for_key", "rpc/sync_account_for_key"]);
    // The key itself never reaches the database, only its hash.
    expect(sentToDatabase()).not.toContain(KEY);
  });
});

describe("what is stored", () => {
  test("one fact per category, keyed by an install hash; no install id, character key or name of a row reaches storage", async () => {
    answers([{ category: "gear", outcome: "stored" }, { category: "professions", outcome: "stored" }, { category: "reputations", outcome: "stored" }]);
    const res = await send(thrallina([gear, profession, reputation, { kind: "loot", nonsense: true }]));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({
      characters: [{ index: 0, result: "synced", categories: { gear: "stored", professions: "stored", reputations: "stored" } }],
      skipped: 1,
    });
    const [call] = syncCalls();
    expect(call).toMatchObject({
      p_user_id: ACCOUNT, p_ruleset: "forever", p_realm: "Forever Pioneer", p_name: "Thrallina", p_class: "SHAMAN",
      p_source_ref: createHmac("sha256", SECRET).update(`source:${INSTALL}`).digest("hex"),
    });
    expect(call.p_facts.map((f: { category: string }) => f.category)).toEqual(["gear", "professions", "reputations"]);
    expect(call.p_facts[1]).toEqual({ category: "professions", captured_at: "2026-11-05T11:00:00.000Z", data: { professions: [{ name: "Mining", skillLine: null, rank: 280, maxRank: 300 }] } });
    const stored = JSON.stringify(call.p_facts);
    expect(stored).not.toContain(INSTALL);
    expect(stored).not.toContain(CHARACTER_KEY);
    expect(stored).not.toContain("Thrallina");
    // Nothing about the account, the key or an install comes back.
    const text = JSON.stringify(body);
    for (const secret of [ACCOUNT, KEY, INSTALL, CHARACTER_KEY, call.p_source_ref]) expect(text).not.toContain(secret);
  });

  test("a character the account holds no live link for is counted, never an error, and says nothing more", async () => {
    answers([{ category: null, outcome: "not_linked" }], [{ category: "gear", outcome: "duplicate" }]);
    const res = await send({ characters: [
      { name: "Jainy", realm: "Forever Pioneer", records: [{ ...gear, character: "Jainy" }] },
      { name: "Thrallina", realm: "Forever Pioneer", records: [gear] },
    ] });
    expect(res.status).toBe(200);
    expect((await res.json()).characters).toEqual([
      { index: 0, result: "not_linked" },
      { index: 1, result: "synced", categories: { gear: "duplicate" } },
    ]);
  });

  test("older captures and categories without consent pass the database's answer through", async () => {
    answers([{ category: "gear", outcome: "older" }, { category: "professions", outcome: "no_consent" }]);
    const body = await (await send(thrallina([gear, profession]))).json();
    expect(body.characters[0].categories).toEqual({ gear: "older", professions: "no_consent" });
  });

  test("rows of one install under two character keys are not one character: nothing is sent for it", async () => {
    answers();
    const body = await (await send(thrallina([profession, { ...reputation, characterKey: "ffffffff" }]))).json();
    expect(body.characters).toEqual([{ index: 0, result: "invalid" }]);
    expect(syncCalls()).toEqual([]);
  });

  test("a gear row of another character is skipped, not stored under this one", async () => {
    answers([{ category: null, outcome: "not_linked" }]);
    const body = await (await send(thrallina([{ ...gear, character: "Jainy" }]))).json();
    expect(body.skipped).toBe(1);
    expect(syncCalls()[0].p_facts).toEqual([]);
  });

  test("after a storage failure the remaining characters are marked to send again", async () => {
    answers([{ category: "gear", outcome: "stored" }]);
    auth.authQuery.mockRejectedValueOnce(new Error("down"));
    const body = await (await send({ characters: [
      { name: "Thrallina", realm: "Forever Pioneer", records: [gear] },
      { name: "Rokhan", realm: "Forever Pioneer", records: [{ ...gear, character: "Rokhan" }] },
      { name: "Zul", realm: "Forever Pioneer", records: [{ ...gear, character: "Zul" }] },
    ] })).json();
    expect(body.characters.map((c: { result: string }) => c.result)).toEqual(["synced", "retry", "retry"]);
  });

  test("a body that is not { characters: [...] } within the limits is a 400 before anything is synced", async () => {
    for (const bad of [{}, { characters: [] }, { characters: Array.from({ length: 11 }, () => thrallina([gear]).characters[0]) },
      { characters: [{ name: "Thrallina", realm: "Forever Pioneer" }] }, { characters: [{ name: "T", realm: "Forever Pioneer", records: [] }] }]) {
      answers();
      expect((await send(bad)).status).toBe(400);
    }
    expect(syncCalls()).toEqual([]);
  });

  test("achievements count only what this character earned: complete on the account alone, or unsaid, is left out", async () => {
    const achievement = { kind: "achievement_owned", ...owned, capturedAt: "2026-11-05T12:00:00Z", criteriaMet: 1, criteriaTotal: 1 };
    answers([{ category: "achievements", outcome: "stored" }]);
    await send(thrallina([
      { ...achievement, achievementId: 6, completed: true, earnedByMe: true, earnedOn: "2026-11-01" },
      { ...achievement, achievementId: 7, completed: true, earnedByMe: false },
      { ...achievement, achievementId: 8, completed: true },
      { ...achievement, achievementId: 9, completed: false, criteriaMet: 0 },
    ]));
    expect(syncCalls()[0].p_facts).toEqual([
      { category: "achievements", captured_at: "2026-11-05T12:00:00.000Z", data: { achievements: [{ id: 6, on: "2026-11-01" }], titleIds: [] } },
    ]);
  });
});

describe("talents", () => {
  const talentOwned = {
    kind: "talent_owned", ...owned, capturedAt: "2026-11-05T13:00:00Z", treeId: 790, specId: 262, points: 4,
    nodes: [{ nodeId: 30, ranks: 2 }, { nodeId: 10, ranks: 1, choice: 0 }, { nodeId: 20, ranks: 1, choice: 1 }],
  };
  const talentSnapshot = {
    kind: "talent_snapshot", installId: INSTALL, capturedAt: "2026-11-05T14:00:00Z", class: "SHAMAN", level: 60, group: 1, active: true,
    configId: 1, treeId: 790, specId: 262, exportStatus: "empty", points: 1, nodes: [{ nodeId: 5, ranks: 1 }],
  };

  test("a keyed talent_owned row becomes the talents fact, nodes sorted, in the shape the page reads", async () => {
    answers([{ category: "talents", outcome: "stored" }]);
    const body = await (await send(thrallina([talentOwned]))).json();
    expect(body.characters[0].categories).toEqual({ talents: "stored" });
    expect(syncCalls()[0].p_facts).toEqual([{
      category: "talents", captured_at: "2026-11-05T13:00:00.000Z",
      data: { class: "SHAMAN", treeId: 790, specId: 262, points: 4, nodes: [{ nodeId: 10, ranks: 1, choice: 0 }, { nodeId: 20, ranks: 1, choice: 1 }, { nodeId: 30, ranks: 2 }] },
    }]);
    expect(sentToDatabase()).not.toContain(CHARACTER_KEY);
  });

  test("an anonymous talent_snapshot row is skipped: it can never become a character's talents", async () => {
    answers([{ category: "gear", outcome: "stored" }]);
    const body = await (await send(thrallina([gear, talentSnapshot]))).json();
    expect(body.skipped).toBe(1);
    expect(syncCalls()[0].p_facts.map((f: { category: string }) => f.category)).toEqual(["gear"]);
    answers([{ category: null, outcome: "not_linked" }]);
    await send(thrallina([talentSnapshot]));
    expect(syncCalls()[1].p_facts).toEqual([]);
  });

  test("limits match the protocol's talent row: ranks above 10 and a build above 100 points are accepted", async () => {
    answers([{ category: "talents", outcome: "stored" }]);
    await send(thrallina([{ ...talentOwned, points: 11, nodes: [{ nodeId: 1, ranks: 11 }] }]));
    expect(syncCalls()[0].p_facts[0].data).toMatchObject({ points: 11, nodes: [{ nodeId: 1, ranks: 11 }] });
    const nodes = Array.from({ length: 150 }, (_, i) => ({ nodeId: i + 1, ranks: 1 }));
    answers([{ category: "talents", outcome: "stored" }]);
    await send(thrallina([{ ...talentOwned, points: 150, nodes }]));
    expect(syncCalls()[1].p_facts[0].data).toMatchObject({ points: 150 });
  });

  test("a talent_owned row whose points do not match its ranks, or repeats a node, is skipped", async () => {
    answers([{ category: null, outcome: "not_linked" }]);
    const body = await (await send(thrallina([
      { ...talentOwned, points: 9 },
      { ...talentOwned, nodes: [{ nodeId: 1, ranks: 1 }, { nodeId: 1, ranks: 1 }], points: 2 },
    ]))).json();
    expect(body.skipped).toBe(2);
    expect(syncCalls()[0].p_facts).toEqual([]);
  });
});

describe("stats", () => {
  const statsOwned = {
    kind: "stats_owned", ...owned, capturedAt: "2026-11-05T13:00:00Z",
    stats: { block: 4.5, strength: 100, agility: 0, stamina: 200, intellect: 5, spirit: 6, meleeHit: 0, armor: 3000, made_up: 9 },
  };

  test("a keyed stats_owned row becomes the stats fact: known keys in page order, zeros outside the attributes left out", async () => {
    answers([{ category: "stats", outcome: "stored" }]);
    const body = await (await send(thrallina([statsOwned]))).json();
    expect(body.characters[0].categories).toEqual({ stats: "stored" });
    const data = syncCalls()[0].p_facts[0].data;
    expect(syncCalls()[0].p_facts[0].category).toBe("stats");
    expect(Object.keys(data.stats)).toEqual(["strength", "agility", "stamina", "intellect", "spirit", "armor", "block"]);
    expect(data.stats).toMatchObject({ agility: 0, block: 4.5 });
    expect(sentToDatabase()).not.toContain(CHARACTER_KEY);
  });

  test("a row with no known key, or a non-finite or non-numeric value, is skipped", async () => {
    answers([{ category: null, outcome: "not_linked" }]);
    const body = await (await send(thrallina([
      { ...statsOwned, stats: { made_up: 1 } },
      { ...statsOwned, stats: {} },
      { ...statsOwned, stats: { strength: "12" } },
      { ...statsOwned, stats: { strength: null } },
    ]))).json();
    expect(body.skipped).toBe(4);
    expect(syncCalls()[0].p_facts).toEqual([]);
  });
});

describe("pvp", () => {
  const pvpOwned = { kind: "pvp_owned", ...owned, capturedAt: "2026-11-05T13:00:00Z", rank: 9, rankPoints: 12_500, rankThreshold: 15_000, rankMax: 14, season: 2, honorableKills: 1234, made_up: 1 };

  test("a keyed pvp_owned row becomes the pvp fact with the six numbers, null where absent", async () => {
    answers([{ category: "pvp", outcome: "stored" }]);
    const later = { ...pvpOwned, capturedAt: "2026-11-05T14:00:00Z", rank: undefined, rankPoints: undefined, rankThreshold: undefined, rankMax: undefined, season: undefined, honorableKills: 5 };
    const body = await (await send(thrallina([pvpOwned, later]))).json();
    expect(body.characters[0].categories).toEqual({ pvp: "stored" });
    const fact = syncCalls()[0].p_facts[0];
    expect(fact.category).toBe("pvp");
    expect(fact.data).toEqual({ rank: null, rankPoints: null, rankThreshold: null, rankMax: null, season: null, honorableKills: 5 });
    expect(sentToDatabase()).not.toContain(CHARACTER_KEY);
  });

  test("a row with neither rank nor honorable kills, or a bad number, is skipped", async () => {
    answers([{ category: null, outcome: "not_linked" }]);
    const body = await (await send(thrallina([
      { ...pvpOwned, rank: undefined, honorableKills: undefined }, { ...pvpOwned, rank: -1 }, { ...pvpOwned, honorableKills: 1.5 }, { ...pvpOwned, season: 3e9 },
    ]))).json();
    expect(body.skipped).toBe(4);
    expect(syncCalls()[0].p_facts).toEqual([]);
  });
});

describe("how often a key may sync", () => {
  test("each request counts against the key's own hourly bucket, after the key is checked; never the raw key", async () => {
    answers([{ category: "gear", outcome: "stored" }]);
    expect((await send(thrallina([gear]))).status).toBe(200);
    expect(quota.syncKey.mock.calls).toEqual([[hashKey(KEY)]]);
    expect(JSON.stringify(quota.syncKey.mock.calls)).not.toContain(KEY);
  });

  test("past the cap it is a 429 with Retry-After, never cached, and nothing is synced", async () => {
    quota.syncKey.mockResolvedValue({ allowed: false, retryAfter: 1234 });
    answers();
    const res = await send(thrallina([gear]));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1234");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).error).toMatch(/try again/i);
    expect(syncCalls()).toEqual([]);
  });

  test("a key that is not admitted is never counted: no key, a dead key or one without sync:own", async () => {
    await send(thrallina([gear]), {});
    auth.authQuery.mockResolvedValueOnce([{ account: null, refusal: "unknown_key" }]);
    await send(thrallina([gear]));
    auth.authQuery.mockResolvedValueOnce([{ account: null, refusal: "no_scope" }]);
    await send(thrallina([gear]));
    expect(quota.syncKey).not.toHaveBeenCalled();
  });

  test("the counter failing is a 503, never a pass", async () => {
    quota.syncKey.mockRejectedValue(new Error("down"));
    answers();
    const res = await send(thrallina([gear]));
    expect(res.status).toBe(503);
    expect(syncCalls()).toEqual([]);
  });
});

const bossKill = { kind: "boss_kill_owned", installId: INSTALL, characterKey: CHARACTER_KEY,
  capturedAt: "2026-11-05T10:00:00Z", encounterId: 2916, instanceMapId: 48, difficulty: 1,
  firstKillAt: "2026-11-05T10:00:00Z", lastKillAt: "2026-11-06T10:00:00Z", killCount: 2 };

test("boss kills have a separate private receipt with the gate off, without touching their absent table", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "");
  answers([]);
  const response = await send(thrallina([bossKill]));
  expect(response.status).toBe(200);
  expect((await response.json()).characters[0].categories).toEqual({ boss_kills: "no_consent" });
  expect(auth.authQuery.mock.calls.some((c) => String(c[0]).includes("boss_kills"))).toBe(false);
});

test("boss kills use the authenticated account and opaque source hash, never public character facts", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "1");
  answers([], "stored");
  const response = await send(thrallina([bossKill]));
  expect(response.status).toBe(200);
  expect((await response.json()).characters[0].categories).toEqual({ boss_kills: "stored" });
  const call = auth.authQuery.mock.calls.find((c) => c[0] === "rpc/sync_boss_kills");
  expect(call).toBeDefined();
  const data = JSON.parse(call![1].body);
  expect(data).toMatchObject({ p_user_id: ACCOUNT, p_name: "Thrallina", p_realm: "Forever Pioneer",
    p_source_ref: createHmac("sha256", SECRET).update(`source:${INSTALL}`).digest("hex") });
  expect(data.p_kills).toEqual([{ encounterId: 2916, instanceMapId: 48, difficulty: 1,
    firstKillAt: bossKill.firstKillAt, lastKillAt: bossKill.lastKillAt, killCount: 2 }]);
  expect(data.p_captured_at).toBe(bossKill.lastKillAt);
  expect(JSON.stringify(data.p_kills)).not.toContain(CHARACTER_KEY);
  expect(JSON.stringify(data)).not.toContain(INSTALL);
  expect(syncCalls()[0].p_facts).toEqual([]);
});

test("a missing boss-kill table is retriable, never silently acknowledged", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "1");
  answers([]);
  auth.authQuery.mockRejectedValueOnce(new Error("function sync_boss_kills does not exist"));
  const response = await send(thrallina([bossKill]));
  expect(response.status).toBe(503);
  expect((await response.json()).characters[0].result).toBe("retry");
});

test("boss kills do not write when the account has no live link, or when a group mixes character keys", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "1");
  answers([{ category: null, outcome: "not_linked" }]);
  const response = await send(thrallina([bossKill]));
  expect((await response.json()).characters[0].result).toBe("not_linked");
  expect(auth.authQuery.mock.calls.some((c) => c[0] === "rpc/sync_boss_kills")).toBe(false);
  answers();
  const mixed = await send(thrallina([profession, { ...bossKill, characterKey: "ffffffff" }]));
  expect((await mixed.json()).characters[0].result).toBe("invalid");
  expect(auth.authQuery.mock.calls.some((c) => c[0] === "rpc/sync_boss_kills")).toBe(false);
});
