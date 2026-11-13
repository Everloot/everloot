import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientBags, ClientBags, writeClientBags } from "../src/client-bags.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70630,
  version: "1.0.0.70630", extractedAt: "2026-10-27T00:00:00.000Z", library: "test", definitions: "abc1234",
};
const table = (name: string, rows: [number, Record<string, unknown>][]): ExtractedTable =>
  ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

function snapshotWith(tables: ExtractedTable[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-bags-")), "client.sqlite");
  writeClientSnapshot(path, meta, tables);
  return path;
}

// Synthetic rows in the shape of the item tables: two plain bags, a herb bag, a quiver (class 11), a container
// with no slots, a nameless container and a sparse row with no Item row.
const build = snapshotWith([
  table("Item", [
    [30, { ID: 30, ClassID: 1, SubclassID: 0 }],
    [10, { ID: 10, ClassID: 1, SubclassID: 0 }],
    [20, { ID: 20, ClassID: 1, SubclassID: 2 }],
    [40, { ID: 40, ClassID: 11, SubclassID: 2 }],
    [50, { ID: 50, ClassID: 1, SubclassID: 0 }],
    [60, { ID: 60, ClassID: 1, SubclassID: 0 }],
  ]),
  table("ItemSparse", [
    [30, { ID: 30, Display_lang: "Synthetic Big Bag", ContainerSlots: 14, OverallQualityID: 1, Bonding: 0, RequiredLevel: 0 }],
    [10, { ID: 10, Display_lang: "Synthetic Small Bag", ContainerSlots: 6, OverallQualityID: 1, Bonding: 1, RequiredLevel: 5 }],
    [20, { ID: 20, Display_lang: "Synthetic Herb Bag", ContainerSlots: 20, OverallQualityID: 2, Bonding: 2, RequiredLevel: 0 }],
    [40, { ID: 40, Display_lang: "Synthetic Quiver", ContainerSlots: 16, OverallQualityID: 2, Bonding: 0, RequiredLevel: 40 }],
    [50, { ID: 50, Display_lang: "Synthetic Box", ContainerSlots: 0, OverallQualityID: 1 }],
    [60, { ID: 60, Display_lang: "  ", ContainerSlots: 8, OverallQualityID: 1 }],
    [70, { ID: 70, Display_lang: "Synthetic Orphan", ContainerSlots: 8, OverallQualityID: 1 }],
  ]),
  table("ItemSubClass", [
    [1, { ID: 1, ClassID: 1, SubClassID: 0, DisplayName_lang: "Bag" }],
    [2, { ID: 2, ClassID: 1, SubClassID: 2, DisplayName_lang: "Herb Bag" }],
    [3, { ID: 3, ClassID: 11, SubClassID: 2, DisplayName_lang: "Quiver" }],
    [4, { ID: 4, ClassID: 1, SubClassID: 9, DisplayName_lang: "" }],
  ]),
]);

test("buildClientBags: containers with slots in id order; quivers, slotless, nameless and orphan rows left out", () => {
  const out = buildClientBags(build);
  expect(out.schema).toBe("everloot.client-bags/1");
  expect(out.build).toMatchObject({ product: "test", version: "1.0.0.70630", definitions: "abc1234" });
  expect(Object.keys(out.bags)).toEqual(["10", "20", "30"]);
  expect(out.bags["10"]).toEqual({ quality: 1, slots: 6, subclass: 0 });
  expect(out.bags["20"]).toEqual({ quality: 2, slots: 20, subclass: 2 });
  expect(out.bags["30"]).toEqual({ quality: 1, slots: 14, subclass: 0 });
});

test("the subclass words are the files' container subclasses with a name, by id", () => {
  expect(buildClientBags(build).subclasses).toEqual({ 0: "Bag", 2: "Herb Bag" });
});

test("the file carries no item names, binding or required level: those stay in private storage", () => {
  const text = JSON.stringify(buildClientBags(build));
  for (const word of ["Synthetic", "Bonding", "bonding", "RequiredLevel", "requiredLevel", '"name"'])expect(text).not.toContain(word);
});

test("a snapshot without the tables still yields a file, empty and labelled", () => {
  const empty = buildClientBags(snapshotWith([]));
  expect(empty.bags).toEqual({});
  expect(empty.subclasses).toEqual({});
  expect(empty.label).toBe("Found in game files, unconfirmed");
});

test("writeClientBags writes one bag per line in id order; the file parses back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-bags-out-")), "client-bags.json");
  const written = writeClientBags(build, path);
  const text = readFileSync(path, "utf8");
  const order = text.split("\n").map((l) => /^  "(\d+)": \{/.exec(l)).filter((m) => m).map((m) => Number(m![1]));
  expect(order).toEqual([10, 20, 30]);
  expect(ClientBags.parse(JSON.parse(text))).toEqual(written);
});
