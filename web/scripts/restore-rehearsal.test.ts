import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { rehearseRestore } from "./restore-rehearsal";

const loot = (eventId: string, installId = "install-aaaa") => ({
  kind: "loot", eventId, installId, capturedAt: "2026-10-10T00:00:00.000Z",
  sourceNpcId: 42, sourceEvidence: "loot-api", items: [{ itemId: 5, count: 1 }],
});

function mirror(uploads: Record<string, unknown[]>, snapshot: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "everloot-mirror-"));
  for (const [name, records] of Object.entries(uploads)) {
    mkdirSync(join(dir, "uploads", "2026-10-10"), { recursive: true });
    writeFileSync(join(dir, "uploads", "2026-10-10", name), JSON.stringify({ addonVersion: "0.2.2", records }));
  }
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  writeFileSync(join(dir, "snapshots", "corpus.json"), JSON.stringify({ records: snapshot }));
  return dir;
}

test("raw uploads rebuild every event the backed-up snapshot published", async () => {
  const dir = mirror({ "a.json": [loot("e:1")], "b.json": [loot("e:2", "install-bbbb")] }, [loot("e:1")]);
  const result = await rehearseRestore(dir);
  expect(result).toMatchObject({ ok: true, uploads: 2, rebuilt: 2, snapshot: 1, missing: [] });
});

test("an event in the snapshot that no raw upload can rebuild fails the rehearsal", async () => {
  const dir = mirror({ "a.json": [loot("e:1")] }, [loot("e:1"), loot("e:9")]);
  const result = await rehearseRestore(dir);
  expect(result.ok).toBe(false);
  expect(result.missing).toEqual(["install-aaaa|e:9"]);
});

test("an empty snapshot cannot establish recovery", async () => {
  await expect(rehearseRestore(mirror({}, []))).rejects.toThrow(/empty snapshot/);
});

function modern(dir: string, records: unknown[], conflicts: string[] = []) {
  writeFileSync(join(dir, "snapshots", "corpus.json"), JSON.stringify({ records: [], corpusState: {
    version: 1, events: records.map((record) => ({ record, grants: [] })), conflicts, legacyRecords: 0,
  } }));
}

test("current snapshots compare internal events even when public records are empty", async () => {
  const row = loot("e:1");
  const dir = mirror({ "a.json": [row] }, []);
  modern(dir, [row]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: true, snapshot: 1, missing: [], changed: [] });
});

test("matching identities with different contents fail recovery", async () => {
  const row = loot("e:1");
  const changed = { ...row, items: [{ itemId: 5, count: 99 }] };
  const dir = mirror({ "a.json": [row] }, []);
  modern(dir, [changed]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: false, changed: ["install-aaaa|e:1"] });
});

test("legacy public snapshots also compare contents", async () => {
  const row = loot("e:1");
  const dir = mirror({ "a.json": [row] }, [{ ...row, items: [{ itemId: 5, count: 99 }] }]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: false, changed: ["install-aaaa|e:1"] });
});

test("missing, malformed and duplicate snapshots fail instead of comparing zero rows", async () => {
  const row = loot("e:1");
  const dir = mirror({ "a.json": [row] }, [row]);
  unlinkSync(join(dir, "snapshots", "corpus.json"));
  await expect(rehearseRestore(dir)).rejects.toThrow();
  writeFileSync(join(dir, "snapshots", "corpus.json"), JSON.stringify({ corpusState: { events: "invalid" } }));
  await expect(rehearseRestore(dir)).rejects.toThrow();
  modern(dir, [row, row]);
  await expect(rehearseRestore(dir)).rejects.toThrow(/duplicate/);
});

test("a conflict created by the raw uploads cannot disappear from verification", async () => {
  const row = loot("e:2");
  const dir = mirror({ "a.json": [loot("e:1"), row], "b.json": [{ ...row, items: [{ itemId: 5, count: 99 }] }] }, []);
  modern(dir, [loot("e:1")]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: false, conflictsMatch: false });
  modern(dir, [loot("e:1")], [JSON.stringify(["install-aaaa", "e:2"])]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: true, conflictsMatch: true });
});

test("equal filenames on different mirror days cannot overwrite an upload", async () => {
  const dir = mirror({ "same.json": [loot("e:1")] }, []);
  mkdirSync(join(dir, "uploads", "2026-10-11"));
  writeFileSync(join(dir, "uploads", "2026-10-11", "same.json"), JSON.stringify({ records: [loot("e:2")] }));
  modern(dir, [loot("e:1"), loot("e:2")]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: true, uploads: 2, snapshot: 2 });
});

test("internal event grant provenance is part of recovery", async () => {
  const row = loot("e:1");
  const dir = mirror({ "a.json": [row] }, []);
  const grant = "a".repeat(64);
  writeFileSync(join(dir, "snapshots", "corpus.json"), JSON.stringify({ records: [], corpusState: {
    version: 1, events: [{ record: row, grants: [grant] }], conflicts: [], legacyRecords: 0,
  } }));
  expect(await rehearseRestore(dir)).toMatchObject({ ok: false, changed: ["install-aaaa|e:1"] });
  writeFileSync(join(dir, "uploads", "2026-10-10", "a.json"), JSON.stringify({ records: [row], publicationGrants: [grant] }));
  expect(await rehearseRestore(dir)).toMatchObject({ ok: true, changed: [] });
});

test("an unreadable raw upload fails even when other uploads cover the snapshot", async () => {
  const row = loot("e:1");
  const dir = mirror({ "a.json": [row] }, [row]);
  writeFileSync(join(dir, "uploads", "2026-10-10", "corrupt.json"), "{");
  await expect(rehearseRestore(dir)).rejects.toThrow(/invalid JSON/);
});

function sharded(dir: string, rows: unknown[]) {
  const folder = "snapshots/corpus/20261123T000000Z-test";
  mkdirSync(join(dir, folder), { recursive: true });
  const parts = rows.map((record, i) => {
    const key = `${folder}/${i}.json`;
    writeFileSync(join(dir, key), JSON.stringify([{ record, grants: [] }]));
    return key;
  });
  const snapshot = { format: 2, state: { version: 1, conflicts: [], legacyRecords: 0 }, parts };
  writeFileSync(join(dir, "snapshots/corpus.json"), JSON.stringify(snapshot));
  return snapshot;
}

test("format-2 parts rebuild and compare every internal event", async () => {
  const rows = [loot("e:1"), loot("e:2")];
  const dir = mirror({ "a.json": rows }, []);
  sharded(dir, rows);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: true, snapshot: 2, rebuilt: 2, changed: [] });
});

test("format-2 still detects missing and changed events", async () => {
  const dir = mirror({ "a.json": [loot("e:1")] }, []);
  sharded(dir, [{ ...loot("e:1"), items: [{ itemId: 5, count: 99 }] }, loot("e:9")]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: false,
    changed: ["install-aaaa|e:1"], missing: ["install-aaaa|e:9"] });
});

test("format-2 refuses a missing or non-array part", async () => {
  const dir = mirror({ "a.json": [loot("e:1")] }, []);
  const snapshot = sharded(dir, [loot("e:1")]);
  unlinkSync(join(dir, snapshot.parts[0]));
  await expect(rehearseRestore(dir)).rejects.toThrow("snapshot part is missing or invalid JSON");
  writeFileSync(join(dir, snapshot.parts[0]), "{}");
  await expect(rehearseRestore(dir)).rejects.toThrow("snapshot part is not a list");
  writeFileSync(join(dir, snapshot.parts[0]), "{");
  await expect(rehearseRestore(dir)).rejects.toThrow("snapshot part is missing or invalid JSON");
});

test("format-2 refuses unsafe or duplicate part paths", async () => {
  const dir = mirror({ "a.json": [loot("e:1")] }, []);
  const snapshot = sharded(dir, [loot("e:1")]);
  for (const [parts, message] of [
    [["../outside.json"], "snapshot part path is invalid"],
    [[snapshot.parts[0], snapshot.parts[0]], "snapshot part manifest is invalid"],
  ] as const) {
    writeFileSync(join(dir, "snapshots/corpus.json"), JSON.stringify({ ...snapshot, parts }));
    await expect(rehearseRestore(dir)).rejects.toThrow(message);
  }
});

test("format-2 rejects duplicate event identities across parts", async () => {
  const row = loot("e:1");
  const dir = mirror({ "a.json": [row] }, []);
  sharded(dir, [row, row]);
  await expect(rehearseRestore(dir)).rejects.toThrow(/duplicate snapshot event/);
});

test("a valid part key cannot follow a junction outside the mirror", async () => {
  const row = loot("e:1");
  const dir = mirror({ "a.json": [row] }, []);
  const snapshot = sharded(dir, [row]);
  const folder = join(dir, "snapshots/corpus/20261123T000000Z-test");
  renameSync(folder, `${folder}-original`);
  const outside = mkdtempSync(join(tmpdir(), "everloot-outside-"));
  writeFileSync(join(outside, "0.json"), JSON.stringify([{ record: row, grants: [] }]));
  symlinkSync(outside, folder, "junction");
  expect(snapshot.parts[0]).toContain("/0.json");
  await expect(rehearseRestore(dir)).rejects.toThrow("snapshot part is missing or invalid JSON");
});

test.each([{ parts: null }, { state: null }, { state: [] }])("malformed format-2 manifest fails: %j", async (invalid) => {
  const dir = mirror({ "a.json": [loot("e:1")] }, []);
  const snapshot = sharded(dir, [loot("e:1")]);
  writeFileSync(join(dir, "snapshots/corpus.json"), JSON.stringify({ ...snapshot, ...invalid }));
  await expect(rehearseRestore(dir)).rejects.toThrow("snapshot part manifest is invalid");
});

test("format-2 preserves conflict verification", async () => {
  const row = loot("e:2");
  const dir = mirror({ "a.json": [loot("e:1"), row], "b.json": [{ ...row, items: [{ itemId: 5, count: 99 }] }] }, []);
  sharded(dir, [loot("e:1")]);
  expect(await rehearseRestore(dir)).toMatchObject({ ok: false, conflictsMatch: false });
});
