import { expect, test } from "vitest";
import { mergeCorpus, publicRecords } from "../src/corpus.js";
import { isSampleInstall } from "../src/sample-installs.js";
import { npcPage, worldFactsFromRecords } from "../src/world-pages.js";

/** The rows /upload's "Load sample" button built, each click under a fresh `sample-<uuid>` install id. */
const sample = (n: number) => {
  const base = { installId: `sample-0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`, capturedAt: "2026-11-20T00:00:00.000Z" };
  return [
    { ...base, eventId: "sample:1", kind: "npc_sighting", npcId: 1234, name: "Forest Spider", mapId: 141, x: 42.5, y: 61, level: 60, reaction: "hostile" },
    { ...base, eventId: "sample:2", kind: "loot", sourceNpcId: 1234, items: [{ itemId: 456, count: 2 }] },
  ];
};

test("only ids the upload page's sample makes count as sample installs", () => {
  expect(isSampleInstall("sample-0f1e2d3c-aaaa-4bbb-8ccc-dddddddddddd")).toBe(true);
  for (const id of ["install-1234", "ps-1111111111111111-2222222222222222", "my-sample-install", "Sample-1234", 12, undefined]) {
    expect(isSampleInstall(id)).toBe(false);
  }
});

test("rows from sample installs are never published, so four sample clicks no longer agree on an NPC", () => {
  const real = { installId: "install-real-1", eventId: "epoch:1", capturedAt: "2026-11-20T00:00:00.000Z", kind: "loot", sourceNpcId: 99, items: [{ itemId: 5, count: 1 }] };
  const records = publicRecords(mergeCorpus(undefined, [...sample(1), ...sample(2), ...sample(3), ...sample(4), real]));
  expect(records.map((r) => r.installId)).toEqual(["install-real-1"]);
  const page = npcPage(1234, worldFactsFromRecords(records));
  expect(page.name).toBeNull();
  expect(page.pins).toEqual([]);
});
