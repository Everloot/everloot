import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientAchievements, criteriaOf, serializeClientAchievements, writeClientAchievements } from "../src/client-achievements.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70630,
  version: "1.0.0.70630", extractedAt: "2026-10-27T00:00:00.000Z", library: "test", definitions: "abc1234",
};
const table = (name: string, rows: [number, Record<string, unknown>][]): ExtractedTable =>
  ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });

// Synthetic rows in the shape of the client tables. 100 is a group (no text),
// 102 is text spoken twice ("Kill 5 foes", Amount 5), 103 an empty node, 104 a
// heading WITH children (kept out), 105 its leaf.
const tree: [number, Record<string, unknown>][] = [
  [100, { ID: 100, Parent: 0, OrderIndex: 0, Description_lang: null, Amount: 1 }],
  [101, { ID: 101, Parent: 100, OrderIndex: 1, Description_lang: "Win battles", Amount: 1 }],
  [102, { ID: 102, Parent: 100, OrderIndex: 2, Description_lang: "Kill 5 foes", Amount: 5 }],
  [103, { ID: 103, Parent: 100, OrderIndex: 3, Description_lang: "  ", Amount: 2 }],
  [104, { ID: 104, Parent: 100, OrderIndex: 4, Description_lang: "Group heading", Amount: 2 }],
  [105, { ID: 105, Parent: 104, OrderIndex: 0, Description_lang: "Do half", Amount: 1 }],
];

test("criteriaOf: text nodes in order index first; amounts only over 1; headings with children are not criteria", () => {
  const t = new Map(tree.map(([id, r]) => [id, r]));
  expect(criteriaOf(100, t)).toEqual([
    { text: "Win battles" },
    { text: "Kill 5 foes", amount: 5 },
    { text: "Do half" },
  ]);
});

const tree2: [number, Record<string, unknown>][] = [[200, { ID: 200, Parent: 0, OrderIndex: 0, Description_lang: "Defeat 3 foes", Amount: 3 }]];
test("criteriaOf: a root that is itself the only leaf is one criterion; an unknown root is none", () => {
  const t = new Map(tree2.map(([id, r]) => [id, r]));
  expect(criteriaOf(200, t)).toEqual([{ text: "Defeat 3 foes", amount: 3 }]);
  expect(criteriaOf(999, t)).toEqual([]);
});

function snapshotWith(tables: ExtractedTable[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-ach-")), "client.sqlite");
  writeClientSnapshot(path, meta, tables);
  return path;
}

const build = snapshotWith([
  table("Achievement", [
    [49, { ID: 49, Title_lang: "Storm the Chasm", Description_lang: "Topple the Chasm's keeper", Points: 10, Criteria_tree: 100 }],
    [50, { ID: 50, Title_lang: "   ", Points: 5, Criteria_tree: 100 }],
    [51, { ID: 51, Title_lang: "No criteria asked", Points: 0, Criteria_tree: 0 }],
    [52, { ID: 52, Title_lang: "Done twice", Points: 0, Criteria_tree: 100 }],
  ]),
  table("CriteriaTree", tree),
]);

test("buildClientAchievements: ids keyed, the files' text with reports-style criteria, nameless rows skipped", () => {
  const achievements = buildClientAchievements(build);
  expect(achievements.schema).toBe("everloot.client-achievements/1");
  expect(achievements.build).toMatchObject({ product: "test", version: "1.0.0.70630", definitions: "abc1234" });
  expect(achievements.achievements["49"]).toEqual({
    title: "Storm the Chasm", description: "Topple the Chasm's keeper", points: 10,
    criteria: [{ text: "Win battles" }, { text: "Kill 5 foes", amount: 5 }, { text: "Do half" }],
  });
  expect(achievements.achievements["51"]).toEqual({ title: "No criteria asked", points: 0, criteria: [] });
  expect(achievements.achievements["52"]).toEqual({ title: "Done twice", points: 0, criteria: [{ text: "Win battles" }, { text: "Kill 5 foes", amount: 5 }, { text: "Do half" }] });
  // Nameless (blank title) rows are left out; the count in the file matches.
  expect(achievements.achievements["50"]).toBeUndefined();
  expect(Object.keys(achievements.achievements)).toEqual(["49", "51", "52"]);
});

test("a snapshot without the two tables still yields a file, empty and labelled", () => {
  const empty = buildClientAchievements(snapshotWith([]));
  expect(empty.achievements).toEqual({});
  expect(empty.note).toBe("criteria and text are the game files'; category names come from player reports");
  expect(empty.label).toBe("Found in game files, unconfirmed");
});

test("writeClientAchievements writes one achievement per line in id order; the file parses back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "kb-ach-out-")), "client-achievements.json");
  const table2 = writeClientAchievements(build, path);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  // One line per achievement id, no id out of order.
  const order = lines.map((l) => /^  "(\d+)": /.exec(l)).filter((m) => m).map((m) => Number(m![1]));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(lineCount(text, '  "49": ')).toBe(1);
  const reparsed = JSON.parse(text);
  expect(reparsed).toMatchObject({ schema: "everloot.client-achievements/1" });
  expect(reparsed.achievements["49"].criteria).toEqual(table2.achievements["49"]!.criteria);
});

function lineCount(text: string, needle: string): number {
  return text.split("\n").filter((l) => l.startsWith(needle)).length;
}
