import { expect, test } from "vitest";
import { mergeCorpus, mergeCorpusBatches, publicRecords } from "../src/corpus.js";
import { parseRecords } from "@everloot/protocol";

const loot = (eventId = "epoch:1", over = {}) => ({
  kind: "loot", installId: "install-one", eventId,
  capturedAt: "2026-10-07T00:00:00Z", sourceNpcId: 42,
  items: [{ itemId: 5, count: 1 }], ...over,
});

test("event identity survives canonical parsing", () => {
  expect(parseRecords([loot()]).records[0]).toHaveProperty("eventId", "epoch:1");
});
test("replays count once, but distinct identical same-second events count separately", () => {
  const a = mergeCorpus(undefined, [loot(), loot()]);
  expect(publicRecords(a)).toHaveLength(1);
  const b = mergeCorpus(a, [loot(), loot("epoch:2")]);
  expect(publicRecords(b)).toHaveLength(2);
  expect(b).toEqual(mergeCorpus(undefined, [loot(), loot(), loot(), loot("epoch:2")]));
});
test("conflicts are order independent and cannot be restored by replay", () => {
  const changed = loot("epoch:1", { items: [{ itemId: 5, count: 9 }] });
  const a = mergeCorpus(mergeCorpus(undefined, [loot()]), [changed]);
  const b = mergeCorpus(undefined, [changed, loot()]);
  expect(a).toEqual(b);
  expect(publicRecords(mergeCorpus(JSON.parse(JSON.stringify(a)), [loot()]))).toEqual([]);
  expect(a.conflicts).toHaveLength(1);
});
test("a copy that only adds optional fields upgrades the event, in either order; a changed field still conflicts", () => {
  // An older Desktop App sent the object row without the fields its protocol did not know.
  const stripped = loot("epoch:1", { sourceNpcId: undefined, sourceObjectId: 1618, sourceEvidence: "loot-api" });
  const full = { ...stripped, mapId: 1411, x: 52.4, y: 43.1, gatherKind: "herb", sourceObjectName: "Peacebloom" };
  const upgraded = mergeCorpus(mergeCorpus(undefined, [stripped], ["g1".padEnd(64, "1")]), [full]);
  expect(upgraded.conflicts).toEqual([]);
  expect(publicRecords(upgraded)).toEqual(parseRecords([full]).records);
  expect(upgraded.events[0]!.grants).toEqual(["g1".padEnd(64, "1")]);
  const late = mergeCorpus(mergeCorpus(undefined, [full]), [stripped]);
  expect(late).toEqual(mergeCorpus(undefined, [full]));
  expect(mergeCorpus(undefined, [stripped, full])).toEqual(mergeCorpus(undefined, [full]));
  // Extra fields with a shared field changed are a conflict, as before.
  const moved = { ...full, items: [{ itemId: 5, count: 9 }] };
  expect(mergeCorpus(mergeCorpus(undefined, [stripped]), [moved]).conflicts).toHaveLength(1);
});
test("legacy rows and rejected rows are withheld while raw inputs remain untouched", () => {
  const legacy = loot(); delete (legacy as { eventId?: string }).eventId;
  const invalid = loot("epoch:2", { installId: "" });
  const state = mergeCorpus(undefined, [legacy, invalid, loot()]);
  expect(state.legacyRecords).toBe(1);
  expect(publicRecords(state)).toEqual(parseRecords([loot()]).records);
  expect(legacy).not.toHaveProperty("eventId");
});
test("named records are private when no live publication authorization is supplied", () => {
  const state = mergeCorpus(undefined, [{ ...loot(), kind: "gold_snapshot",
    character: "Thrall", realm: "Moon Guard", currentCopper: 100, peakCopper: 100 }]);
  expect(publicRecords(state)).toEqual([]);
});

test("batched merging equals one merge per upload, including grants, conflicts and replays", () => {
  const changed = loot("epoch:1", { items: [{ itemId: 5, count: 9 }] });
  const legacy = loot("epoch:9"); delete (legacy as { eventId?: string }).eventId;
  const g1 = "a".repeat(64), g2 = "b".repeat(64);
  const batches = [
    { raw: [loot()], grants: [] },
    { raw: [loot("epoch:2"), legacy], grants: [] },
    { raw: [loot("epoch:3")], grants: [g1] },
    { raw: [loot("epoch:3")], grants: [g2, g1] },
    { raw: [changed], grants: [] },
    { raw: [loot("epoch:4"), loot("epoch:2")], grants: [] },
  ];
  const sequential = batches.reduce<ReturnType<typeof mergeCorpus> | undefined>((state, b) => mergeCorpus(state, b.raw, b.grants), undefined);
  expect(mergeCorpusBatches(undefined, batches)).toEqual(sequential);
  const start = mergeCorpus(undefined, [loot("epoch:7")], [g2]);
  expect(mergeCorpusBatches(start, batches)).toEqual(batches.reduce((s, b) => mergeCorpus(s, b.raw, b.grants), start));
});

test("replaying a large snapshot event by event stays linear", () => {
  const batches = Array.from({ length: 20_000 }, (_, i) => ({ raw: [loot(`epoch:${i}`, { installId: `install-${i % 50}` })], grants: [] as string[] }));
  const started = performance.now();
  const state = mergeCorpusBatches(undefined, batches);
  expect(state.events).toHaveLength(20_000);
  // One merge per event was quadratic: about 15 s for 10,000 events on the dev machine.
  expect(performance.now() - started).toBeLessThan(5_000);
});
test("full-scan snapshots stay out of the corpus; the market rollup reads them from the uploads", () => {
  const snapshot = {
    kind: "auction_snapshot", installId: "install-one", eventId: "epoch:9", capturedAt: "2026-10-07T00:00:00Z",
    realm: "Forever", scanId: "scan-1", part: 1, parts: 1, items: [[2589, 4, 80, 95, 100]],
  };
  const state = mergeCorpus(undefined, [loot(), snapshot]);
  expect(publicRecords(state).map((r) => r.kind)).toEqual(["loot"]);
  expect(state.legacyRecords).toBe(0);
});
test("census rows never enter the corpus, as sent or as stored", () => {
  const census = { installId: "install-one", capturedAt: "2026-10-18T21:30:00Z", race: "Scourge", class: "PRIEST", level: 24, faction: "Horde" };
  const sent = { ...census, kind: "census_seen", eventId: "epoch:9", guid: "Player-4395-0A1B2C3D", via: "target" };
  const stored = { ...census, kind: "census_self", eventId: `census_self:2026-10-18:${"a".repeat(24)}`, characterKey: "a".repeat(64), serverId: 4395, realm: "Forever" };
  expect(parseRecords([sent]).records).toHaveLength(1);
  const state = mergeCorpus(undefined, [sent, stored, loot()]);
  expect(state.events.map((e) => e.record.kind)).toEqual(["loot"]);
  expect(state.legacyRecords).toBe(0);
});
test("pull summaries never enter the corpus: they name the group and live where a hidden character can be deleted", () => {
  const pull = {
    kind: "pull_summary", installId: "install-one", eventId: "epoch:9", capturedAt: "2026-11-02T12:00:00Z", encounterId: 1144,
    name: "Rhahk'zor", instanceMapId: 36, success: true, realm: "Forever", members: [{ name: "Thrallina", class: "SHAMAN" }],
  };
  expect(parseRecords([pull]).records).toHaveLength(1);
  const state = mergeCorpus(undefined, [pull, loot()]);
  expect(state.events.map((e) => e.record.kind)).toEqual(["loot"]);
});
