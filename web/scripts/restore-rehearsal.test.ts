import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
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
