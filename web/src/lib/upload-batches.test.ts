import { recordSchemas } from "@everloot/protocol";
import { expect, test, vi } from "vitest";
import { censusCharacters, censusSummary, prepareUpload, sendBatches } from "./upload-batches";
const row = (i: number) => ({ kind: "loot", installId: "install-batches", eventId: `epoch:${i}`, capturedAt: "2026-10-07T00:00:00Z", sourceNpcId: 1, items: [] });

const refused = (count: number) => ({ ok: false, accepted: [], rejected: Array.from({ length: count }, (_, index) => ({ index, reason: "Try again later" })) });
const stored = (count: number) => ({ ok: true, persisted: true, uploadId: "stored", accepted: Array.from({ length: count }, (_, index) => ({ index, kind: "loot" })), rejected: [] });

for (const rejectedBatch of [0, 1]) test(`a fully rejected batch at position ${rejectedBatch} does not block later batches or claim storage`, async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: Array.from({ length: 4001 }, (_, i) => row(i)) }, {}, []);
  const original = [...session.batches];
  const receipts = original.map((body, index) => index === rejectedBatch ? refused(JSON.parse(body).records.length) : stored(JSON.parse(body).records.length));
  let next = 0;
  const send = vi.fn(async () => {
    const index = next++;
    return Response.json(receipts[index], { status: index === rejectedBatch ? 422 : 200 });
  });
  const progress = vi.fn();
  await sendBatches(session, send, progress);
  expect(session.next).toBe(3);
  expect(session.receipts).toEqual(receipts);
  expect(session.receipts[rejectedBatch]).not.toHaveProperty("persisted");
  expect(session.receipts[rejectedBatch]).not.toHaveProperty("uploadId");
  expect(session.receipts.reduce((n, r) => n + r.accepted!.length, 0)).toBe(2001);
  expect(progress).toHaveBeenCalledTimes(3);
  expect(session.batches).toEqual(original);
});

test("after a rejected batch and confirmed progress, a failure retries only the unchanged unresolved batch", async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: Array.from({ length: 4001 }, (_, i) => row(i)) }, {}, []);
  const send = vi.fn().mockResolvedValueOnce(Response.json(refused(2000), { status: 422 }))
    .mockResolvedValueOnce(Response.json(stored(2000)))
    .mockRejectedValueOnce(new Error("offline"));
  await expect(sendBatches(session, send)).rejects.toThrow("offline");
  expect(session.next).toBe(2);
  expect(session.receipts).toHaveLength(2);
  send.mockResolvedValueOnce(Response.json(stored(1)));
  await sendBatches(session, send);
  expect(send.mock.calls.map((call) => call[1].body)).toEqual([...session.batches, session.batches[2]]);
  expect(session.next).toBe(3);
});

test("a single fully rejected batch finishes with zero saved rows and its original refusal", async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: [row(1)] }, {}, []);
  const receipt = refused(1);
  await sendBatches(session, vi.fn(async () => Response.json(receipt, { status: 422 })));
  expect(session.next).toBe(1);
  expect(session.receipts).toEqual([receipt]);
});

test("a one-row envelope refusal cannot be mistaken for rejection of that row", async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: [row(1), { ...row(2), installId: "other-install" }] }, {}, []);
  const send = vi.fn(async () => Response.json({ ok: false, accepted: [], rejected: [{ index: -1, reason: "Envelope refused" }] }, { status: 422 }));
  await expect(sendBatches(session, send)).rejects.toThrow(/confirmed/i);
  expect(send).toHaveBeenCalledTimes(1);
  expect(session.next).toBe(0);
  expect(session.receipts).toEqual([]);
});

test("a durable partial receipt keeps accepted and rejected rows distinct", async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: [row(1), row(2)] }, {}, []);
  const receipt = { ...stored(1), rejected: [{ index: 1, reason: "Try again later" }] };
  await sendBatches(session, vi.fn(async () => Response.json(receipt)));
  expect(session.next).toBe(1);
  expect(session.receipts).toEqual([receipt]);
  expect(session.receipts[0].accepted).toHaveLength(1);
  expect(session.receipts[0].rejected).toHaveLength(1);
});

for (const status of [429, 503]) test(`a ${status} after a rejected batch stops and preserves its receipt`, async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: [row(1), { ...row(2), installId: "other-install" }] }, {}, []);
  const receipt = refused(1);
  const send = vi.fn().mockResolvedValueOnce(Response.json(receipt, { status: 422 }))
    .mockResolvedValueOnce(Response.json({ error: "Try later" }, { status }));
  await expect(sendBatches(session, send)).rejects.toThrow("Try later");
  expect(session.next).toBe(1);
  expect(session.receipts).toEqual([receipt]);
  expect(send).toHaveBeenCalledTimes(2);
});

for (const [label, status, receipt] of [
  ["request error", 422, { ...refused(2), error: "Refused envelope" }],
  ["null error", 422, { ...refused(2), error: null }],
  ["persistence claim", 422, { ...refused(2), persisted: false }],
  ["upload id", 422, { ...refused(2), uploadId: "" }],
  ["accepted rows", 422, { ...refused(2), accepted: [{ index: 0, kind: "loot" }] }],
  ["envelope rejection", 422, { ...refused(2), rejected: [{ index: -1, reason: "Envelope" }] }],
  ["duplicate index", 422, { ...refused(2), rejected: [{ index: 0, reason: "A" }, { index: 0, reason: "B" }] }],
  ["missing index", 422, refused(1)],
  ["out of range", 422, { ...refused(2), rejected: [{ index: 0, reason: "A" }, { index: 2, reason: "B" }] }],
  ["fractional index", 422, { ...refused(2), rejected: [{ index: 0, reason: "A" }, { index: 0.5, reason: "B" }] }],
  ["string index", 422, { ...refused(2), rejected: [{ index: 0, reason: "A" }, { index: "1", reason: "B" }] }],
  ["null entry", 422, { ...refused(2), rejected: [null, { index: 1, reason: "B" }] }],
  ["bad reason", 422, { ...refused(2), rejected: [{ index: 0, reason: {} }, { index: 1, reason: "B" }] }],
  ["rate limit", 429, refused(2)],
  ["server failure", 503, refused(2)],
  ["bad request", 400, refused(2)],
] as const) test(`${label} still stops without advancing or sending later batches`, async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: [row(1), row(2), { ...row(3), installId: "other-install" }] }, {}, []);
  const send = vi.fn(async () => Response.json(receipt, { status }));
  await expect(sendBatches(session, send)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  expect(session.next).toBe(0);
  expect(session.receipts).toEqual([]);
});
test("splits a full file by records and bytes, withholds legacy and unselected names", () => {
  const legacy = { ...row(9999), eventId: undefined };
  const gold = { kind: "gold_snapshot", installId: "install-batches", eventId: "epoch:gold", capturedAt: row(1).capturedAt, character: "Thrall", realm: "Moon Guard", currentCopper: 1, peakCopper: 1 };
  const session = prepareUpload({ addonVersion: "0.2.0", records: [...Array.from({ length: 4500 }, (_, i) => row(i)), legacy, gold, { kind: "bogus" }] }, {}, []);
  expect(session.batches.map((b) => JSON.parse(b).records.length)).toEqual([2000, 2000, 500]);
  expect(session.held).toEqual({ legacy: 1, named: 1, invalid: 1, links: 0 });
  expect(session.batches.every((b) => new TextEncoder().encode(b).length <= 600_000)).toBe(true);
});
test("character link rows never go in an upload, whatever is shared: their GUID and code stay out of every batch", () => {
  const link = {
    kind: "character_link", installId: "install-batches", eventId: "character_link:1", capturedAt: row(1).capturedAt, code: "EL-7K3Q-9P",
    name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, faction: "Horde", guid: "Player-4395-0A1B2C3D", completionKey: "0a1b2c3d",
  };
  for (const sharing of [{}, { gear: true, gold: true, guild: true, collection: true }]) {
    const session = prepareUpload({ addonVersion: "0.2.0", records: [link, row(1), { ...link, eventId: undefined }] }, sharing, ["a".repeat(64)]);
    expect(session.held.links).toBe(2);
    expect(session.batches).toHaveLength(1);
    for (const secret of ["character_link", "Player-4395", "EL-7K3Q-9P", "0a1b2c3d"]) expect(session.batches.join("")).not.toContain(secret);
  }
  expect(prepareUpload({ addonVersion: "0.2.0", records: [link] }, {}, []).batches).toEqual([]);
});
test("resumes at the first unconfirmed batch and rejects an unpersisted receipt", async () => {
  const session = prepareUpload({ addonVersion: "0.2.0", records: Array.from({ length: 2001 }, (_, i) => row(i)) }, {}, []);
  const first = session.batches[0], second = session.batches[1];
  const send = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, persisted: true, uploadId: "first", accepted: Array(2000).fill({}) })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, persisted: false })));
  await expect(sendBatches(session, send)).rejects.toThrow(/confirmed/i);
  expect(session.next).toBe(1);
  expect(session.receipts).toHaveLength(1);
  send.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, persisted: true, uploadId: "second", accepted: [{}] })));
  await sendBatches(session, send);
  expect(send.mock.calls.map((call) => call[1].body)).toEqual([first, second, second]);
  expect(session.next).toBe(2);
});
test("byte limits apply to large valid rows and one oversized row is an actionable failure", () => {
  const guild = { kind: "guild_snapshot", faction: "horde", installId: "install-batches", capturedAt: row(1).capturedAt, realm: "Moon Guard", guildName: "Raiders", members: Array.from({ length: 2000 }, (_, i) => ({ name: `Member${i}`, rank: "Member", lastOnlineDays: 0, level: 90, class: "Warrior" })) };
  const records = Array.from({ length: 10 }, (_, i) => ({ ...guild, eventId: `roster:${i}` }));
  const session = prepareUpload({ addonVersion: "0.2.0", records }, { guild: true }, ["a".repeat(64)]);
  expect(session.batches.length).toBeGreaterThan(1);
  expect(session.batches.every((b) => new TextEncoder().encode(b).length <= 600_000)).toBe(true);
  expect(() => prepareUpload({ addonVersion: "0.2.0", records }, { guild: true }, ["a".repeat(64)], 200)).toThrow(/large/i);
});
test("every batch carries the client build, and the preview lists the addons being sent", () => {
  const addon = (i: number, name: string, title: string) => ({ kind: "addon_seen", installId: "install-batches", eventId: `epoch:addon${i}`, capturedAt: row(1).capturedAt, name, title, loaded: true });
  const records = [...Array.from({ length: 2001 }, (_, i) => row(i)),
    addon(1, "Questie", "Questie"), addon(2, "DBM-Core", "Deadly Boss Mods"), addon(3, "DBM-StatusBarTimers", "Deadly Boss Mods"), addon(4, "Questie", "Questie")];
  const session = prepareUpload({ addonVersion: "0.2.6", clientBuild: "1.60.1.70450", records }, {}, []);
  expect(session.batches.map((b) => JSON.parse(b).clientBuild)).toEqual(["1.60.1.70450", "1.60.1.70450"]);
  // One entry per folder, since the folder name is what is uploaded; two folders can share a title.
  expect(session.addons).toEqual(["Deadly Boss Mods (DBM-Core)", "Deadly Boss Mods (DBM-StatusBarTimers)", "Questie (Questie)"]);
  const old = prepareUpload({ addonVersion: "0.2.5", records: [row(1)] }, {}, []);
  expect(JSON.parse(old.batches[0])).not.toHaveProperty("clientBuild");
  expect(old.addons).toEqual([]);
  const unreadable = prepareUpload({ addonVersion: "0.2.6", clientBuild: "beta", records: [row(1)] }, {}, []);
  expect(JSON.parse(unreadable.batches[0])).not.toHaveProperty("clientBuild");
});
test("the census preview counts characters, not rows", () => {
  expect(censusSummary({ seen: 312, self: 2 })).toBe("312 characters seen, 2 of your own");
  expect(censusSummary({ seen: 1, self: 0 })).toBe("1 character seen, 0 of your own");
  expect(censusSummary({ seen: 1200, self: 1 })).toBe("1,200 characters seen, 1 of your own");
  expect(censusSummary({ seen: 0, self: 0 })).toBeNull();
  expect(prepareUpload({ addonVersion: "0.3.3", records: [row(1)] }, {}, []).census).toEqual({ seen: 0, self: 0 });
});
test("a census row without a guid is not counted as a character", () => {
  expect(censusCharacters([
    { kind: "census_seen", guid: "Player-4242-00000001" }, { kind: "census_seen", guid: "Player-4242-00000001" },
    { kind: "census_seen" }, { kind: "census_seen", guid: "" }, { kind: "census_seen", guid: 7 },
    { kind: "census_self", guid: "Player-4242-00AABBCC" }, { kind: "census_self" },
    { kind: "loot", guid: "Player-4242-00000002" },
  ])).toEqual({ seen: 1, self: 1 });
});
// Runs once the census intake change adds the kinds to @everloot/protocol; until then the server would refuse them.
test.skipIf(!("census_seen" in recordSchemas))("census rows reach the preview as distinct characters per kind", () => {
  const base = { installId: "install-batches", capturedAt: "2026-10-18T00:00:00Z", race: "Orc", class: "WARRIOR", level: 20, faction: "Horde" };
  const seen = (n: number, guid: string) => ({ ...base, kind: "census_seen", eventId: `census_seen:2026-10-18:${n}`, guid, via: "target" });
  const self = { ...base, kind: "census_self", eventId: "census_self:2026-10-18:1", guid: "Player-4242-00AABBCC", realm: "Forever" };
  // The same player on two days is two rows and one character.
  const session = prepareUpload({ addonVersion: "0.3.3", records: [seen(1, "Player-4242-00000001"), seen(2, "Player-4242-00000002"), seen(3, "Player-4242-00000001"), self] }, {}, []);
  expect(session.census).toEqual({ seen: 2, self: 1 });
});
test("skip leaves settled rows out of the batches and returns their event ids; named and legacy rows are never skipped", () => {
  const sighting = (i: number, npcId: number) => ({ kind: "npc_sighting", installId: "install-batches", eventId: `epoch:npc${i}`, capturedAt: row(1).capturedAt, npcId, name: "Marshal Dughan", mapId: 1429, x: 42, y: 65 });
  const records = [sighting(1, 1), sighting(2, 2), sighting(3, 1), row(1), { ...sighting(4, 1), eventId: undefined }];
  const skip = vi.fn((r: Readonly<Record<string, unknown>>) => r.kind === "npc_sighting" && r.npcId === 1);
  const session = prepareUpload({ addonVersion: "0.2.6", clientBuild: "1.60.1.70450", records }, {}, [], undefined, skip);
  expect(session.skipped).toEqual(["epoch:npc1", "epoch:npc3"]);
  expect(session.counts).toEqual({ npc_sighting: 1, loot: 1 });
  expect(session.held.legacy).toBe(1);
  expect(prepareUpload({ addonVersion: "0.2.6", records }, {}, []).skipped).toEqual([]);
});
