import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), api: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { api: store.api } }));

import { GET } from "./route";
import { ALL_RECORD_KINDS, CENSUS_KINDS, COMPLETION_KINDS, GUILD_KILL_KINDS, LINK_KINDS, PLAYER_KINDS, PUBLIC_RECORD_KINDS } from "@everloot/protocol";
import { ANON_PAGE, KEY_PAGE } from "@/lib/data-guard";
import { newKey } from "@/lib/api-keys";
import { corpusPublicResponse, parseRecords } from "@everloot/protocol";
import { publicInstallId } from "@/lib/public-install";

const base = { installId: "install-1", capturedAt: "2026-10-09T00:00:00.000Z" };
const gold = { ...base, eventId: "e:1", kind: "gold_snapshot", character: "Thrall", realm: "Forever", currentCopper: 1, peakCopper: 1 };
const scan = { ...base, eventId: "e:2", kind: "auction_scan", realm: "Forever", itemId: 1, copper: 5 };
const req = (query = "") => new Request(`https://everloot.app/api/corpus/public${query}`);
/** What leaves the site: the same record without the install id. */
const published = ({ installId: _, ...rest }: Record<string, unknown>) => rest;

beforeEach(() => {
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 1, records: [gold, scan] });
  store.api.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("without kinds the whole public corpus is returned", async () => {
  const body = await (await GET(req())).json();
  expect(body.records).toEqual([published(gold), published(scan)]);
});

test("without a key no record leaves the site with an install id at all", async () => {
  for (const query of ["", "?kinds=auction_scan"]) {
    const body = await (await GET(req(query))).json();
    expect(body.records.length).toBeGreaterThan(0);
    for (const record of body.records) expect(record).not.toHaveProperty("installId");
  }
});

test("with a key every record carries its install's pseudonym, the real id never appears, and the records parse", async () => {
  const secret = "k".repeat(32);
  vi.stubEnv("EVERLOOT_CHARACTER_KEY", secret);
  const loot = { installId: "real-install-0002", capturedAt: base.capturedAt, eventId: "e:5", kind: "loot", sourceNpcId: 1, items: [] };
  store.loadCorpus.mockResolvedValue({ uploads: 2, records: [gold, scan, loot] });
  for (const query of ["", "?kinds=loot,gold_snapshot"]) {
    const res = await GET(req(query));
    const text = await res.text();
    expect(text).not.toContain("install-1");
    expect(text).not.toContain("real-install-0002");
    const { records } = JSON.parse(text);
    for (const record of records) expect(record.installId).toMatch(/^pub-[0-9a-f]{32}$/);
    const parsed = parseRecords(records);
    expect(parsed.receipt.rejected).toEqual([]);
    expect(parsed.records).toHaveLength(records.length);
  }
  const { records } = await (await GET(req())).json();
  const byEvent = Object.fromEntries(records.map((r: { eventId: string; installId: string }) => [r.eventId, r.installId]));
  expect(byEvent["e:1"]).toBe(publicInstallId("install-1", secret));
  expect(byEvent["e:1"]).toBe(byEvent["e:2"]);
  expect(byEvent["e:5"]).not.toBe(byEvent["e:1"]);
});

test("kinds narrows the body to the record kinds a tool reads", async () => {
  const body = await (await GET(req("?kinds=auction_scan"))).json();
  expect(body).toMatchObject({ ok: true, uploads: 1, kinds: ["auction_scan"] });
  expect(body.records).toEqual([published(scan)]);
});

test("an unknown kind is a 400, never a silently empty answer", async () => {
  const response = await GET(req("?kinds=auction_scan,flying_mounts"));
  expect(response.status).toBe(400);
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("installed addon lists never leave row by row; only the leaderboard's counts are published", async () => {
  const addon = { ...base, eventId: "e:3", kind: "addon_seen", name: "Questie", title: "Questie", loaded: true };
  store.loadCorpus.mockResolvedValue({ uploads: 1, records: [gold, addon, scan] });
  const body = await (await GET(req())).json();
  expect(body.records).toEqual([published(gold), published(scan)]);
  const asked = await GET(req("?kinds=addon_seen"));
  expect(asked.status).toBe(400);
});

test("auction scans are not corpus records, so asking for them is refused", async () => {
  const response = await GET(req("?kinds=auction_snapshot"));
  expect(response.status).toBe(400);
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("talent builds are held back from the public corpus", async () => {
  const build = { ...base, eventId: "e:4", kind: "talent_snapshot", class: "MAGE", level: 30, group: 1, active: true, configId: 7, treeId: 786, exportStatus: "unavailable", points: 1, nodes: [{ nodeId: 1, ranks: 1 }] };
  store.loadCorpus.mockResolvedValue({ uploads: 1, records: [gold, build] });
  const body = await (await GET(req())).json();
  expect(body.records).toEqual([published(gold)]);
  expect((await GET(req("?kinds=talent_snapshot"))).status).toBe(400);
});

test("a kind that is not on the allowlist is never returned, filtered or not", async () => {
  const unlisted = { ...base, eventId: "e:9", kind: "talent_snapshot", talents: [] };
  store.loadCorpus.mockResolvedValue({ uploads: 1, records: [gold, unlisted, scan] });
  const body = await (await GET(req())).json();
  expect(body.records).toEqual([published(gold), published(scan)]);
  expect((await GET(req("?kinds=talent_snapshot"))).status).toBe(400);
});

test("a completion catalog row is never served raw, even if one reached the corpus", async () => {
  const title = { ...base, eventId: "e:7", kind: "title_catalog", titleId: 4, name: "Private" };
  store.loadCorpus.mockResolvedValue({ uploads: 1, records: [gold, title] });
  expect((await (await GET(req())).json()).records).toEqual([published(gold)]);
  expect((await GET(req("?kinds=title_catalog"))).status).toBe(400);
});

test("census rows never leave row by row, even if one reached the corpus", async () => {
  const census = { ...base, race: "Scourge", class: "PRIEST", level: 24, faction: "Horde", characterKey: "a".repeat(64), serverId: 4395 };
  const self = { ...census, eventId: `census_self:2026-10-18:${"a".repeat(24)}`, kind: "census_self", realm: "Forever" };
  const seen = { ...census, eventId: `census_seen:2026-10-18:${"a".repeat(24)}`, kind: "census_seen", via: "target" };
  store.loadCorpus.mockResolvedValue({ uploads: 1, records: [gold, self, seen, scan] });
  expect((await (await GET(req())).json()).records).toEqual([published(gold), published(scan)]);
  for (const kind of [...CENSUS_KINDS, ...PLAYER_KINDS]) expect((await GET(req(`?kinds=${kind}`))).status).toBe(400);
});

test("a guild kill row never leaves row by row: not one install's, not a hidden guild's, not with the switch on", async () => {
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  const kill = { ...base, eventId: "guild_kill:1", kind: "guild_kill", guildName: "Night Watch", realm: "Forever", faction: "horde", encounterId: 663, name: "Lucifron", instanceMapId: 409, difficulty: 9 };
  store.loadCorpus.mockResolvedValue({ uploads: 2, records: [gold, kill, { ...kill, installId: "install-other", eventId: "guild_kill:2" }, scan] });
  const body = JSON.stringify(await (await GET(req())).json());
  expect(body).not.toContain("guild_kill");
  expect(body).not.toContain("Night Watch");
  expect((await GET(req("?kinds=guild_kill"))).status).toBe(400);
  vi.unstubAllEnvs();
});

test("every record kind is either on the allowlist or named private here", () => {
  // The completion kinds are served only through the completion rollup: 3-install agreement and live grants.
  // The census kinds are published only as counts, like addon lists. Player rows go to the player pages, never this feed.
  // Link rows are redeemed at the account's link endpoint and never stored. Guild kills reach the public only
  // through the guild rollup (2 installs, hidden guilds out, behind EVERLOOT_GUILDS).
  const privateKinds = ["addon_seen", "talent_snapshot", "auction_snapshot", ...COMPLETION_KINDS, ...CENSUS_KINDS, ...PLAYER_KINDS, ...LINK_KINDS, ...GUILD_KILL_KINDS];
  expect([...PUBLIC_RECORD_KINDS, ...privateKinds].sort()).toEqual([...ALL_RECORD_KINDS].sort());
});

test("every answer carries the licence, the credit line and the source page, in the body and the headers", async () => {
  const res = await GET(req("?kinds=auction_scan"));
  expect(await res.json()).toMatchObject({
    attribution: { licence: "CC BY-SA 4.0", credit: "Data from Everloot (https://everloot.app), CC BY-SA 4.0.", source: "https://everloot.app/database" },
  });
  expect(res.headers.get("x-everloot-licence")).toBe("CC BY-SA 4.0");
  expect(res.headers.get("x-everloot-credit")).toBe("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
  expect(res.headers.get("link")).toContain('rel="license"');
});

test("guard off: no limit, the whole corpus in one page, as before", async () => {
  const body = await (await GET(req())).json();
  expect(body).toMatchObject({ offset: 0, limit: 2, total: 2, next: null });
  expect(store.api).not.toHaveBeenCalled();
});

const many = Array.from({ length: 1200 }, (_, i) => ({ ...base, eventId: `e:${i}`, kind: "loot", sourceNpcId: 1, items: [] }));

test("guard on: an anonymous caller gets a capped page and a next link, and spends the per-IP quota", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: many });
  const body = await (await GET(req("?kinds=loot&limit=5000"))).json();
  expect(body.records).toHaveLength(ANON_PAGE);
  expect(body).toMatchObject({ offset: 0, limit: ANON_PAGE, total: 1200 });
  expect(body.next).toBe(`https://everloot.app/api/corpus/public?kinds=loot&limit=${ANON_PAGE}&offset=${ANON_PAGE}`);
  expect(store.api).toHaveBeenCalledTimes(1);
});

test("guard on: past the anonymous limit the answer is a 429 that names the free key, and nothing is read", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  store.api.mockResolvedValue({ allowed: false, retryAfter: 1800 });
  const res = await GET(req());
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("1800");
  expect((await res.json()).getAKey).toBe("https://everloot.app/docs/api/keys");
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("guard on: a key gets the larger page without touching the anonymous quota", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  vi.stubEnv("SUPABASE_URL", "https://db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ allowed: true, retry_after: 0, key_ref: crypto.randomUUID() }])));
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: [...many, ...many, ...many, ...many, ...many].map((r, i) => ({ ...r, eventId: `k:${i}` })) });
  const res = await GET(new Request("https://everloot.app/api/corpus/public", { headers: { authorization: `Bearer ${newKey().token}` } }));
  const body = await res.json();
  expect(body.records).toHaveLength(KEY_PAGE);
  expect(body.total).toBe(6000);
  expect(store.api).not.toHaveBeenCalled();
});

test("a bad offset or limit is a 400", async () => {
  expect((await GET(req("?offset=-5"))).status).toBe(400);
  expect((await GET(req("?limit=0"))).status).toBe(400);
});

test("the body is the protocol's corpusPublicResponse", async () => {
  const body = await (await GET(req("?kinds=loot,vendor"))).json();
  const parsed = corpusPublicResponse.safeParse(body);
  expect(parsed.success ? null : parsed.error.issues).toBeNull();
});
