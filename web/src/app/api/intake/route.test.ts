import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mergeCensusRows } from "../../../../../kb/src/census-rows";

/**
 * The route is the only place that decides what a submitter is told. It must persist the parsed
 * accepted records, and it must never report a receipt the store did not write.
 */

const store = vi.hoisted(() => ({ putUpload: vi.fn(), lookup: vi.fn(), requestQuota: vi.fn(), installQuota: vi.fn(), reporter: vi.fn(), installCensus: vi.fn() }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { request: store.requestQuota, install: store.installQuota, reporter: store.reporter } }));

vi.mock("@/lib/upload-store", () => ({
  sharingStore: { lookup: store.lookup },
  uploadStore: {
    putUpload: store.putUpload,
    installCensus: store.installCensus,
    loadCorpus: vi.fn(),
    putWaitlist: vi.fn(),
    writeSnapshot: vi.fn(),
  },
}));

const players = vi.hoisted(() => ({ upsert: vi.fn(), hiddenGuilds: vi.fn() }));
vi.mock("@/lib/player-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/player-store")>()),
  playerStore: () => ({ upsert: players.upsert, hiddenGuilds: players.hiddenGuilds }),
}));

const capturedAt = "2026-10-05T00:00:00.000Z";
const loot = (installId: string) => ({
  kind: "loot",
  installId,
  capturedAt,
  sourceNpcId: 123,
  items: [{ itemId: 456, count: 1, secret: "strip" }],
  extra: "strip",
});
const canonicalLoot = {
  kind: "loot",
  installId: "install-1234",
  capturedAt,
  sourceNpcId: 123,
  items: [{ itemId: 456, count: 1 }],
};

function request(payload: unknown): Request {
  return new Request("https://everloot.app/api/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** A fresh route module per test. */
async function freshPost() {
  vi.resetModules();
  const { POST } = await import("./route.js");
  return POST;
}

beforeEach(() => {
  store.requestQuota.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.installQuota.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.reporter.mockReset().mockReturnValue("0123456789abcdef");
  store.putUpload.mockReset();
  store.installCensus.mockReset().mockResolvedValue([]);
  store.putUpload.mockResolvedValue(true);
  store.lookup.mockReset();
  store.lookup.mockResolvedValue(null);
  players.upsert.mockReset().mockResolvedValue(undefined);
  players.hiddenGuilds.mockReset().mockResolvedValue(new Set());
});

describe("POST /api/intake", () => {
  test("persists the parsed accepted records, not the raw payload", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.1.0", records: [{ ...loot("install-1234"), installId: "" }, loot("install-1234")] }));

    expect(response.status).toBe(200);
    expect(store.putUpload).toHaveBeenCalledWith(expect.any(String), "install-1234", {
      addonVersion: "0.1.0",
      records: [canonicalLoot],
    }, []);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, persisted: true, accepted: [{ index: 1, kind: "loot" }] });
    expect(body).not.toHaveProperty("records");
    expect(body).not.toHaveProperty("upload");
  });

  test("the stored upload keeps the client build the addon reported", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.2.6", clientBuild: "1.60.1.70450", records: [loot("install-1234")] }));

    expect(response.status).toBe(200);
    expect(store.putUpload).toHaveBeenCalledWith(expect.any(String), "install-1234", {
      addonVersion: "0.2.6",
      clientBuild: "1.60.1.70450",
      records: [canonicalLoot],
    }, []);
  });

  test("a disenchant window with the item it came from is accepted and stored whole", async () => {
    const POST = await freshPost();
    const disenchant = {
      kind: "loot", installId: "install-1234", capturedAt, sourceEvidence: "loot-api",
      sourceItemId: 2455, lootType: "disenchant", copper: 12, items: [{ itemId: 10940, count: 2 }],
    };
    const response = await POST(request({ addonVersion: "0.3.11", records: [disenchant, { ...disenchant, lootType: "mining" }] }));

    expect(response.status).toBe(200);
    expect(store.putUpload).toHaveBeenCalledWith(expect.any(String), "install-1234", {
      addonVersion: "0.3.11",
      records: [disenchant],
    }, []);
    expect(await response.json()).toMatchObject({ ok: true, persisted: true, accepted: [{ index: 0, kind: "loot" }] });
  });

  test("two accepted install ids reject the whole submission and write nothing", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.1.0", records: [loot("install-aaaa"), loot("install-bbbb")] }));

    expect(response.status).toBe(422);
    expect(store.putUpload).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ ok: false });
  });

  test.each([["a NUL", "install-\u00001234"], ["half a character pair", "install-\ud8001234"]])(
    "an install id with %s is refused before anything is written: the index cannot store it",
    async (_, installId) => {
      const POST = await freshPost();
      const response = await POST(request({ addonVersion: "0.1.0", records: [loot(installId)] }));

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ ok: false, error: "This install id holds a character the store cannot keep." });
      expect(store.installQuota).not.toHaveBeenCalled();
      expect(store.putUpload).not.toHaveBeenCalled();
    },
  );

  test("a valid envelope with no accepted row is refused and writes nothing", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.1.0", records: [{ ...loot("install-1234"), capturedAt: "nope" }] }));

    expect(response.status).toBe(422);
    expect(store.putUpload).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.accepted).toEqual([]);
    expect(body.rejected[0].index).toBe(0);
  });

  test("more than 2000 rows is an envelope refusal, not a write", async () => {
    const POST = await freshPost();
    const rows = Array.from({ length: 2001 }, () => loot("install-1234"));
    const response = await POST(request({ addonVersion: "0.1.0", records: rows }));

    expect(response.status).toBe(422);
    expect(store.putUpload).not.toHaveBeenCalled();
  });

  test("a malformed body is 400 and writes nothing", async () => {
    const POST = await freshPost();
    const response = await POST(new Request("https://everloot.app/api/intake", { method: "POST", body: "{" }));

    expect(response.status).toBe(400);
    expect(store.putUpload).not.toHaveBeenCalled();
  });

  test("storage that reports failure answers 503 with the receipt, never a thank-you", async () => {
    store.putUpload.mockResolvedValue(false);
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.1.0", records: [loot("install-1234")] }));

    expect(response.status).toBe(503);
    expect(store.putUpload).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, persisted: false, accepted: [{ index: 0, kind: "loot" }] });
    expect(String(body.error)).toMatch(/retry/i);
  });

  test("storage that throws is the same 503, not a crash", async () => {
    store.putUpload.mockRejectedValue(new Error("supabase down"));
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.1.0", records: [loot("install-1234")] }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, persisted: false });
  });

  test("shared install denial answers 429 with Retry-After and writes nothing", async () => {
    store.installQuota.mockResolvedValue({ allowed: false, retryAfter: 75 });
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.1.0", records: [loot("install-1234")] }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("75");
    expect(store.installQuota).toHaveBeenCalledWith("install-1234");
    expect(store.putUpload).not.toHaveBeenCalled();
  });

  test("request quota denial precedes body reads and grant lookups", async () => {
    store.requestQuota.mockResolvedValue({ allowed: false, retryAfter: 40 });
    const POST = await freshPost();
    const req = request({});
    const read = vi.spyOn(req.body!, "getReader");
    const response = await POST(req);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("40");
    expect(read).not.toHaveBeenCalled();
    expect(store.lookup).not.toHaveBeenCalled();
    expect(store.putUpload).not.toHaveBeenCalled();
  });

  test("quota storage failure refuses intake rather than falling back", async () => {
    const POST = await freshPost();
    for (const quota of [store.requestQuota, store.installQuota]) {
      quota.mockRejectedValueOnce(new Error("database down"));
      const response = await POST(request({ addonVersion: "0.1.0", records: [loot("install-1234")] }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false });
    }
    expect(store.putUpload).not.toHaveBeenCalled();
  });
});

describe("auction scans in an upload", () => {
  const part = (realm: string, i = 0) => ({
    kind: "auction_snapshot", installId: "install-1234", capturedAt, realm, scanId: `scan-${realm.length}-${i}`.replace(/\W/g, "-"),
    part: 1, parts: 1, items: [[2589, 1, 10, 5, 5]],
  });

  test("the stored upload carries the keyed hash of the upload address, never one sent in the body", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.3.0", reporter: "ffffffffffffffff", records: [part("Forever")] }));
    expect(response.status).toBe(200);
    const stored = store.putUpload.mock.calls[0]![2];
    expect(stored.reporter).toBe("0123456789abcdef");
    expect(JSON.stringify(stored)).not.toContain("ffffffffffffffff");
  });

  test("a scan's faction and auction house are stored; a scan without them is still accepted", async () => {
    const POST = await freshPost();
    const named = { ...part("Forever", 1), faction: "Horde", house: "Neutral" };
    const response = await POST(request({ addonVersion: "0.3.4", records: [named, part("Forever", 2)] }));
    expect(response.status).toBe(200);
    const [first, second] = store.putUpload.mock.calls[0]![2].records;
    expect(first).toMatchObject({ faction: "Horde", house: "Neutral" });
    expect(second).not.toHaveProperty("house");
    const bad = await (await freshPost())(request({ addonVersion: "0.3.4", records: [{ ...part("Forever", 3), house: "Goblin" }] }));
    expect(bad.status).toBe(422);
  });

  test("uploads without scans are not tagged with a reporter", async () => {
    const POST = await freshPost();
    await POST(request({ addonVersion: "0.3.0", records: [loot("install-1234")] }));
    expect(store.putUpload.mock.calls[0]![2]).not.toHaveProperty("reporter");
    expect(store.reporter).not.toHaveBeenCalled();
  });

  test("a completion catalog upload carries the address hash too, so its votes count once per address", async () => {
    const POST = await freshPost();
    const title = { kind: "title_catalog", installId: "install-1234", eventId: "e:1", capturedAt, titleId: 4, name: "Private" };
    const response = await POST(request({ addonVersion: "0.3.3", reporter: "ffffffffffffffff", records: [title] }));
    expect(response.status).toBe(200);
    const stored = store.putUpload.mock.calls[0]![2];
    expect(stored.reporter).toBe("0123456789abcdef");
    expect(JSON.stringify(stored)).not.toContain("ffffffffffffffff");
  });

  test("one upload may carry scans from at most 3 realms; the rest are rejected with a reason", async () => {
    const POST = await freshPost();
    const realms = ["Aaa", "Bbb", "Ccc", "Ddd", "Aaa"];
    const response = await POST(request({ addonVersion: "0.3.0", records: realms.map((r, i) => part(r, i)) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted.map((a: { index: number }) => a.index)).toEqual([0, 1, 2, 4]);
    expect(body.rejected).toEqual([{ index: 3, reason: expect.stringContaining("at most 3 realms") }]);
  });

  test("a realm that is not a plain name is rejected at intake", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.3.0", records: [part("visit scam.example")] }));
    expect(response.status).toBe(422);
    expect(store.putUpload).not.toHaveBeenCalled();
  });
});

describe("census rows in an upload", () => {
  const KEY = "test-character-key".repeat(2);
  const GUID = "Player-4395-0A1B2C3D";
  const SEEN_GUID = "Player-4395-0F00BA44";
  const self = {
    kind: "census_self", installId: "install-1234", eventId: `census_self:${GUID}`, capturedAt: "2026-10-18T21:30:00.000Z",
    guid: GUID, race: "Scourge", class: "PRIEST", level: 24, faction: "Horde", realm: "Forever",
  };
  const seen = {
    kind: "census_seen", installId: "install-1234", eventId: `census_seen:${SEEN_GUID}`, capturedAt: "2026-10-18T21:31:00.000Z",
    guid: SEEN_GUID, race: "Skyborne", class: "HUNTER", level: 60, faction: "Alliance", via: "mouseover",
    name: "Thrall", guild: "Horde Raiders", x: 41.2, y: 66.1,
  };
  /** Every piece of a GUID of five or more characters, lower case, so a re-cased copy is caught too. */
  const pieces = (guid: string) => {
    const out: string[] = [];
    for (let i = 0; i < guid.length; i++) for (let j = i + 5; j <= guid.length; j++) out.push(guid.slice(i, j).toLowerCase());
    return out;
  };
  const expectNoGuid = (value: unknown) => {
    // Upload and receipt ids are random UUIDs; one can contain a 5-character piece of a GUID by chance.
    const text = JSON.stringify(value).toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
    for (const guid of [GUID, SEEN_GUID]) for (const piece of pieces(guid)) expect(text, piece).not.toContain(piece);
  };

  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-18T23:30:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  /** What the real store would hand back: the census rows an install has already stored. */
  const storedBefore = () => store.installCensus.mockImplementation(async (installId: string) =>
    store.putUpload.mock.calls.flatMap((c) => c[2].records).filter((r: { kind: string; installId: string }) => r.kind.startsWith("census_") && r.installId === installId));

  test("the stored upload holds a character key and server id, never the GUID or any piece of it", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [self, seen, loot("install-1234")] }));
    expect(response.status).toBe(200);
    expect((await response.json()).accepted.map((a: { kind: string }) => a.kind)).toEqual(["census_self", "census_seen", "loot"]);
    const stored = store.putUpload.mock.calls[0]![2];
    expectNoGuid(stored);
    const [mine, theirs, kept] = stored.records;
    expect(Object.keys(mine).sort()).toEqual(["capturedAt", "characterKey", "class", "eventId", "faction", "installId", "kind", "level", "race", "realm", "reporter", "serverId"]);
    expect(Object.keys(theirs).sort()).toEqual(["capturedAt", "characterKey", "class", "eventId", "faction", "installId", "kind", "level", "race", "reporter", "serverId", "via"]);
    expect(mine).toMatchObject({ serverId: 4395, characterKey: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(mine.eventId).toBe(`census_self:2026-10-18:${mine.characterKey.slice(0, 24)}`);
    expect(theirs.eventId).toBe(`census_seen:2026-10-18:${theirs.characterKey.slice(0, 24)}`);
    expect(kept).toEqual(canonicalLoot);
  });

  test("without EVERLOOT_CHARACTER_KEY census rows are dropped and the rest of the upload is kept", async () => {
    for (const value of [undefined, "", "  ", "x".repeat(31)]) {
      store.putUpload.mockClear();
      vi.stubEnv("EVERLOOT_CHARACTER_KEY", value);
      const POST = await freshPost();
      const response = await POST(request({ addonVersion: "0.4.0", records: [self, loot("install-1234"), seen] }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.accepted).toEqual([{ index: 1, kind: "loot" }]);
      expect(body.rejected.map((r: { index: number }) => r.index)).toEqual([0, 2]);
      expect(body.rejected[0].reason).toMatch(/census/i);
      const stored = store.putUpload.mock.calls[0]![2];
      expect(stored.records).toEqual([canonicalLoot]);
      expectNoGuid(stored);
    }
  });

  test("an upload of census rows only, with no key, is refused and writes nothing", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", "");
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [self, seen] }));
    expect(response.status).toBe(422);
    expect(store.putUpload).not.toHaveBeenCalled();
    expectNoGuid(await response.json());
  });

  test("bad levels, factions and misplaced realm or via are refused with a reason", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    const bad = [
      { ...seen, level: 61 }, { ...seen, level: 0 }, { ...seen, faction: "horde" },
      { ...seen, realm: "Forever" }, { ...self, via: "target" }, { ...seen, guid: "Creature-0-4395-0-12-1234-0000ABCD" },
    ];
    const response = await POST(request({ addonVersion: "0.4.0", records: [...bad, loot("install-1234")] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toEqual([{ index: 6, kind: "loot" }]);
    expect(body.rejected.map((r: { index: number }) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(body.rejected[3].reason).toBe("realm is sent only for your own characters");
    expect(body.rejected[4].reason).toBe("via is sent only for players you see");
    expect(store.putUpload.mock.calls[0]![2].records).toEqual([canonicalLoot]);
  });

  test("every census row carries the keyed address hash the server computed, and never an address", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    await POST(request({ addonVersion: "0.4.0", records: [self, seen] }));
    const stored = store.putUpload.mock.calls[0]![2].records;
    expect(stored.map((r: { reporter: string }) => r.reporter)).toEqual(["0123456789abcdef", "0123456789abcdef"]);
    expect(JSON.stringify(stored)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  test("rows dated more than a day ahead or more than 30 days back are refused", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    const at = (iso: string) => ({ ...seen, capturedAt: iso });
    const rows = [
      at("2026-10-19T23:00:00.000Z"), at("2026-10-20T00:00:00.000Z"), at("2026-09-18T23:31:00.000Z"), at("2026-09-18T23:00:00.000Z"), at("2020-01-01T00:00:00.000Z"),
    ];
    const response = await POST(request({ addonVersion: "0.4.0", records: [...rows, loot("install-1234")] }));
    const body = await response.json();
    expect(body.rejected.map((r: { index: number }) => r.index)).toEqual([1, 3, 4]);
    expect(body.rejected[0].reason).toMatch(/30 days/);
    expect(store.putUpload.mock.calls[0]![2].records.filter((r: { kind: string }) => r.kind === "census_seen")).toHaveLength(2);
  });

  test("the daily cap holds across uploads: what an install stored before counts, and a repeat is still not new", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    storedBefore();
    const POST = await freshPost();
    const guid = (i: number) => `Player-4395-${i.toString(16).toUpperCase().padStart(8, "0")}`;
    const batch = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ ...seen, guid: guid(from + i) }));
    const send = async (records: unknown[]) => (await (await POST(request({ addonVersion: "0.4.0", records: [...records, loot("install-1234")] }))).json());
    expect((await send(batch(0, 300))).rejected).toEqual([]);
    const second = await send([...batch(300, 600), { ...seen, guid: guid(0), level: 59 }]);
    expect(second.rejected.map((r: { index: number }) => r.index)).toEqual(Array.from({ length: 100 }, (_, i) => 200 + i));
    const third = await send(batch(900, 901));
    expect(third.rejected).toHaveLength(1);
    const stored = store.putUpload.mock.calls.flatMap((c) => c[2].records).filter((r: { kind: string }) => r.kind === "census_seen");
    expect(new Set(stored.map((r: { eventId: string }) => r.eventId)).size).toBe(500);
  });

  test("when an install's earlier uploads cannot be read, census rows wait and the rest is stored", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    store.installCensus.mockResolvedValue(null);
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [self, loot("install-1234")] }));
    const body = await response.json();
    expect(body.accepted).toEqual([{ index: 1, kind: "loot" }]);
    expect(body.rejected[0].reason).toMatch(/later/);
  });

  test("a GUID whose server number has a leading zero is refused", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [{ ...seen, guid: "Player-04395-0F00BA44" }, loot("install-1234")] }));
    expect((await response.json()).rejected.map((r: { index: number }) => r.index)).toEqual([0]);
  });

  test("a realm that is not a realm name is refused on your own character", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [{ ...self, realm: "visit scam.example/<b>" }, loot("install-1234")] }));
    expect((await response.json()).rejected.map((r: { index: number }) => r.index)).toEqual([0]);
  });

  test("a name, guild or position sent with a player you see is not stored", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    await POST(request({ addonVersion: "0.4.0", records: [seen] }));
    const text = JSON.stringify(store.putUpload.mock.calls[0]![2]);
    for (const leak of ["Thrall", "Horde Raiders", "41.2", "66.1", "\"name\"", "\"guild\"", "\"x\"", "\"y\""]) expect(text).not.toContain(leak);
  });

  test("the same character sent again the same day keeps one event id, is never refused, and the later copy wins", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    const later = { ...self, level: 25, capturedAt: "2026-10-18T23:10:00.000Z" };
    for (const rows of [[self], [self, later], [later]]) {
      const response = await POST(request({ addonVersion: "0.4.0", records: rows }));
      expect(response.status).toBe(200);
      expect((await response.json()).rejected).toEqual([]);
    }
    const stored = store.putUpload.mock.calls.flatMap((call) => call[2].records);
    expect(new Set(stored.map((r: { eventId: string }) => r.eventId)).size).toBe(1);
    const folded = mergeCensusRows([], stored);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ level: 25, capturedAt: later.capturedAt });
  });

  test("one install keeps at most 500 players seen and 50 own characters per UTC day; the rest are refused and counted", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const POST = await freshPost();
    const guid = (i: number) => `Player-4395-${i.toString(16).toUpperCase().padStart(8, "0")}`;
    const seenRows = Array.from({ length: 502 }, (_, i) => ({ ...seen, guid: guid(i) }));
    const selfRows = Array.from({ length: 51 }, (_, i) => ({ ...self, guid: guid(10_000 + i) }));
    // A repeat of an accepted character is not a new one, and the next day has its own allowance.
    const repeat = { ...seen, guid: guid(0), level: 59 };
    const nextDay = { ...seen, guid: guid(600), capturedAt: "2026-10-19T08:00:00.000Z" };
    const records = [...seenRows, ...selfRows, repeat, nextDay];
    const response = await POST(request({ addonVersion: "0.4.0", records }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rejected.map((r: { index: number }) => r.index)).toEqual([500, 501, 552]);
    expect(body.rejected[0].reason).toMatch(/500/);
    expect(body.rejected[2].reason).toMatch(/50\b/);
    expect(body.accepted).toHaveLength(records.length - 3);
    const stored = store.putUpload.mock.calls[0]![2].records;
    expect(stored.filter((r: { kind: string }) => r.kind === "census_seen")).toHaveLength(502);
    expect(stored.filter((r: { kind: string }) => r.kind === "census_self")).toHaveLength(50);
  });

  test("no GUID is logged, even when storage fails", async () => {
    vi.stubEnv("EVERLOOT_CHARACTER_KEY", KEY);
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    }
    store.putUpload.mockRejectedValue(new Error("supabase down"));
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [self, seen] }));
    expect(response.status).toBe(503);
    expect(logged.length).toBeGreaterThan(0);
    expectNoGuid(logged);
    expectNoGuid(await response.json());
  });
});

describe("guild kill rows in an upload", () => {
  const kill = (guildName: string, extra: object = {}) => ({
    kind: "guild_kill", installId: "install-1234", eventId: `guild_kill:${guildName.replace(/\s/g, "-")}`, capturedAt,
    guildName, realm: "Forever Pioneer", faction: "horde", encounterId: 663, name: "Lucifron", instanceMapId: 409, difficulty: 9, size: 40, ...extra,
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  test("with the switch off they are dropped, the rest is kept and the hide list is never read", async () => {
    const POST = await freshPost();
    const body = await (await POST(request({ addonVersion: "0.4.0", records: [kill("Night Watch"), canonicalLoot] }))).json();
    expect(body.accepted.map((a: { kind: string }) => a.kind)).toEqual(["loot"]);
    expect(body.rejected[0].reason).toBe("Guild kills are not collected yet.");
    expect(players.hiddenGuilds).not.toHaveBeenCalled();
    expect(store.putUpload.mock.calls[0]![2].records.map((r: { kind: string }) => r.kind)).toEqual(["loot"]);
  });

  test("with the switch on they are stored in the upload; a hidden guild's are dropped; the list is read once", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    const { guildHideKey } = await import("@/lib/player-store");
    players.hiddenGuilds.mockResolvedValue(new Set([guildHideKey("forever-pioneer", "night watch")]));
    const POST = await freshPost();
    const body = await (await POST(request({ addonVersion: "0.4.0", records: [kill("Night Watch"), kill("Ember"), kill("Ember", { eventId: "guild_kill:2", encounterId: 664 })] }))).json();
    expect(body.accepted.map((a: { kind: string }) => a.kind)).toEqual(["guild_kill", "guild_kill"]);
    expect(body.rejected).toEqual([{ index: 0, reason: "This guild asked to be hidden; its kills are not kept." }]);
    expect(players.hiddenGuilds).toHaveBeenCalledOnce();
    const stored = store.putUpload.mock.calls[0]![2].records;
    expect(stored.map((r: { guildName: string }) => r.guildName)).toEqual(["Ember", "Ember"]);
  });

  test("when the hide list cannot be read the kills are not kept unchecked", async () => {
    vi.stubEnv("EVERLOOT_GUILDS", "1");
    players.hiddenGuilds.mockRejectedValue(new Error("down"));
    const POST = await freshPost();
    const body = await (await POST(request({ addonVersion: "0.4.0", records: [kill("Ember"), canonicalLoot] }))).json();
    expect(body.accepted.map((a: { kind: string }) => a.kind)).toEqual(["loot"]);
    expect(body.rejected[0].reason).toMatch(/could not be checked/);
  });
});

describe("player rows in an upload", () => {
  const seenAt = new Date().toISOString();
  const player = (name: string, extra: object = {}) => ({
    kind: "player_seen", installId: "install-1234", eventId: `player_seen:${name}`, capturedAt: seenAt,
    name, realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, guild: "Night Watch", ...extra,
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  test("with the switch off they are dropped, the rest of the upload is kept and the table is never touched", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [player("Thrallina"), canonicalLoot] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.accepted.map((a: { kind: string }) => a.kind)).toEqual(["loot"]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toMatch(/not collected yet/);
    expect(players.upsert).not.toHaveBeenCalled();
    expect(store.putUpload.mock.calls[0]![2].records.map((r: { kind: string }) => r.kind)).toEqual(["loot"]);
  });

  test("an upload of player rows only, with the switch off, is refused and writes nothing", async () => {
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [player("Thrallina")] }));
    expect(response.status).toBe(422);
    expect(players.upsert).not.toHaveBeenCalled();
    expect(store.putUpload).not.toHaveBeenCalled();
  });

  test("with the switch on they are written in one batch, with a date and no time, and never stored in the upload", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [player("Thrallina"), player("Throgar", { guild: undefined, guid: "Player-1-ABC", x: 4 }), canonicalLoot] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.accepted.map((a: { kind: string }) => a.kind)).toEqual(["player_seen", "player_seen", "loot"]);
    expect(players.upsert).toHaveBeenCalledOnce();
    const rows = players.upsert.mock.calls[0]![0];
    expect(rows).toEqual([
      { name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, guild: "Night Watch", seen: seenAt.slice(0, 10) },
      { name: "Throgar", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, seen: seenAt.slice(0, 10) },
    ]);
    expect(store.putUpload.mock.calls[0]![2].records.map((r: { kind: string }) => r.kind)).toEqual(["loot"]);
  });

  test("a player-only upload is persisted by the table alone and gets a normal receipt", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [player("Thrallina")] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, persisted: true, accepted: [{ kind: "player_seen" }] });
    expect(store.putUpload).not.toHaveBeenCalled();
  });

  test("a date more than 30 days back or a day ahead, and rows past the per-upload cap, are refused", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    const POST = await freshPost();
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const response = await POST(request({ addonVersion: "0.4.0", records: [player("Aa", { capturedAt: old }), player("Bb", { capturedAt: future }), player("Cc")] }));
    const body = await response.json();
    expect(body.rejected).toHaveLength(2);
    expect(players.upsert.mock.calls[0]![0].map((r: { name: string }) => r.name)).toEqual(["Cc"]);
    players.upsert.mockClear();
    const many = Array.from({ length: 1001 }, (_, i) => player(`N${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}${String.fromCharCode(97 + Math.floor(i / 676))}`, { eventId: `player_seen:${i}` }));
    const capped = await (await POST(request({ addonVersion: "0.4.0", records: many }))).json();
    expect(players.upsert.mock.calls[0]![0]).toHaveLength(1000);
    expect(capped.rejected).toHaveLength(1);
    expect(capped.rejected[0].reason).toMatch(/at most 1000/);
  });

  test("a row the players table would refuse is dropped with a reason, and the other rows still go", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    const POST = await freshPost();
    // "a-" is a realm the protocol allows, but its key is one character and the table wants two.
    const response = await POST(request({ addonVersion: "0.4.0", records: [player("Thrallina", { realm: "a-" }), player("Throgar"), canonicalLoot] }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toMatch(/cannot be stored/);
    expect(players.upsert.mock.calls[0]![0].map((r: { name: string }) => r.name)).toEqual(["Throgar"]);
    expect(store.putUpload.mock.calls[0]![2].records.map((r: { kind: string }) => r.kind)).toEqual(["loot"]);
  });

  test("when the table cannot be written the upload is not confirmed and the player can retry", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    players.upsert.mockRejectedValue(new Error("supabase down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const POST = await freshPost();
    const response = await POST(request({ addonVersion: "0.4.0", records: [player("Thrallina"), canonicalLoot] }));
    expect(response.status).toBe(503);
    expect((await response.json()).persisted).toBe(false);
    expect(store.putUpload).not.toHaveBeenCalled();
  });
});

describe("character link rows in an upload", () => {
  const link = {
    kind: "character_link", installId: "install-1234", eventId: "character_link:1", capturedAt, code: "EL-7K3Q-9P",
    name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, faction: "Horde",
    guid: "Player-4395-0A1B2C3D", completionKey: "0a1b2c3d",
  };
  afterEach(() => { vi.unstubAllEnvs(); });

  test("with the switch off or on they are dropped, GUID and code with them, and the rest of the upload is kept", async () => {
    for (const value of ["", "1"]) {
      vi.stubEnv("EVERLOOT_CHARACTER_LINKS", value);
      store.putUpload.mockClear();
      const POST = await freshPost();
      const response = await POST(request({ addonVersion: "0.5.0", records: [link, canonicalLoot] }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.accepted.map((a: { kind: string }) => a.kind)).toEqual(["loot"]);
      expect(body.rejected).toEqual([{ index: 0, reason: expect.stringContaining("not in uploads") }]);
      const stored = JSON.stringify(store.putUpload.mock.calls[0]);
      for (const secret of ["Player-4395", "EL-7K3Q-9P", "character_link"]) expect(stored).not.toContain(secret);
    }
  });

  test("an upload of link rows only is refused and stores nothing", async () => {
    const POST = await freshPost();
    expect((await POST(request({ addonVersion: "0.5.0", records: [link] }))).status).toBe(422);
    expect(store.putUpload).not.toHaveBeenCalled();
  });
});
