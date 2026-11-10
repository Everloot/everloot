import { expect, test } from "vitest";
import { buildDatabaseActivity } from "./database-activity";
import type { Corpus } from "./upload-store";

test("four times the corpus takes less than six times the build time", () => {
  const now = new Date("2026-11-10");
  const previous = buildDatabaseActivity({ records: [], uploads: 0 } as Corpus, now);
  const corpus = (entities: number): Corpus => ({
    uploads: 3,
    records: Array.from({ length: entities }, (_, i) => [1, 2, 3].flatMap((n) => [
      { kind: "item_seen", itemId: i + 1, name: "Thread", installId: String(n), capturedAt: now.toISOString() },
      { kind: "npc_sighting", npcId: i + 1, name: "Guard", mapId: 1429, x: 40, y: 60, positionKind: "npc", installId: String(n), capturedAt: now.toISOString() },
      { kind: "quest", questId: i + 1, title: "A task", level: 10, giverNpcId: i + 1, rewardItemIds: [], installId: String(n), capturedAt: now.toISOString() },
    ])).flat(),
  } as Corpus);
  // Steady-state cron: history exists, so this measures the full-corpus publication gates.
  const small = corpus(7000), large = corpus(28000);
  buildDatabaseActivity(corpus(100), now, previous);
  const measure = (c: Corpus) => {
    const start = performance.now();
    const file = buildDatabaseActivity(c, now, previous);
    expect(file.publicKeys).toHaveLength(c.records.length / 3);
    return performance.now() - start;
  };
  const smallMs = measure(small), largeMs = measure(large);
  console.warn(`Activity scaling: ${small.records.length} rows ${smallMs.toFixed(1)} ms; ${large.records.length} rows ${largeMs.toFixed(1)} ms; ratio ${(largeMs / smallMs).toFixed(2)}`);
  expect(largeMs / smallMs).toBeLessThan(6);
}, 120_000);
