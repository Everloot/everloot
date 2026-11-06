import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

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
});
