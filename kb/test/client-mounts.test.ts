import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientMounts, ridingSkillByType, writeClientMounts } from "../src/client-mounts.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70630,
  version: "1.0.0.70630", extractedAt: "2026-10-27T00:00:00.000Z", library: "test", definitions: "abc1234",
};
const table = (name: string, rows: [number, Record<string, unknown>][]): ExtractedTable =>
  ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

function snapshotWith(tables: ExtractedTable[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-mount-")), "client.sqlite");
  writeClientSnapshot(path, meta, tables);
  return path;
}

// Synthetic rows in the shape of the mount tables: type 1 asks for riding 75 through one capability and 150 through
// another (the lowest counts), type 2 asks for none, type 3 has no capability link at all.
const build = snapshotWith([
  table("Mount", [
    [9, { ID: 9, Name_lang: "Synthetic Ram", MountTypeID: 1, SourceSpellID: 900 }],
    [7, { ID: 7, Name_lang: "Synthetic Horse", MountTypeID: 2, SourceSpellID: 700 }],
    [8, { ID: 8, Name_lang: "   ", MountTypeID: 1, SourceSpellID: 800 }],
    [10, { ID: 10, Name_lang: "Synthetic Wolf", MountTypeID: 3, SourceSpellID: 1000 }],
  ]),
  table("MountTypeXCapability", [
    [1, { ID: 1, MountTypeID: 1, MountCapabilityID: 50, OrderIndex: 0 }],
    [2, { ID: 2, MountTypeID: 1, MountCapabilityID: 51, OrderIndex: 1 }],
    [3, { ID: 3, MountTypeID: 2, MountCapabilityID: 52, OrderIndex: 0 }],
    [4, { ID: 4, MountTypeID: 2, MountCapabilityID: 99, OrderIndex: 1 }],
  ]),
  table("MountCapability", [
    [50, { ID: 50, ReqRidingSkill: 150 }],
    [51, { ID: 51, ReqRidingSkill: 75 }],
    [52, { ID: 52, ReqRidingSkill: 0 }],
  ]),
]);

test("ridingSkillByType: the lowest skill among a type's capabilities; a missing capability row is skipped", () => {
  const get = (t: string) => {
    const tables: Record<string, [number, Record<string, unknown>][]> = {
      MountTypeXCapability: [[1, { MountTypeID: 1, MountCapabilityID: 50 }], [2, { MountTypeID: 1, MountCapabilityID: 51 }], [3, { MountTypeID: 2, MountCapabilityID: 99 }]],
      MountCapability: [[50, { ReqRidingSkill: 150 }], [51, { ReqRidingSkill: 75 }]],
    };
    return tables[t] ? new Map(tables[t]) : undefined;
  };
  expect([...ridingSkillByType(get)]).toEqual([[1, 75]]);
  expect(ridingSkillByType(() => undefined).size).toBe(0);
});

test("buildClientMounts: id order, the files' name and spell, riding skill only when asked for, nameless rows skipped", () => {
  const out = buildClientMounts(build);
  expect(out.schema).toBe("everloot.client-mounts/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70630", definitions: "abc1234" });
  expect(Object.keys(out.mounts)).toEqual(["7", "9", "10"]);
  expect(out.mounts["9"]).toEqual({ name: "Synthetic Ram", spellId: 900, ridingSkill: 75 });
  expect(out.mounts["7"]).toEqual({ name: "Synthetic Horse", spellId: 700 });
  expect(out.mounts["10"]).toEqual({ name: "Synthetic Wolf", spellId: 1000 });
});

test("a snapshot without the tables still yields a file, empty and labelled", () => {
  const empty = buildClientMounts(snapshotWith([]));
  expect(empty.mounts).toEqual({});
  expect(empty.label).toBe("Found in game files, unconfirmed");
});

test("writeClientMounts writes one mount per line in id order; the file parses back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-mount-out-")), "client-mounts.json");
  const written = writeClientMounts(build, path);
  const text = readFileSync(path, "utf8");
  const order = text.split("\n").map((l) => /^  "(\d+)": /.exec(l)).filter((m) => m).map((m) => Number(m![1]));
  expect(order).toEqual([7, 9, 10]);
  expect(JSON.parse(text).mounts["9"]).toEqual(written.mounts["9"]);
});
