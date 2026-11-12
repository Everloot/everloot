/** Run from kb: npx tsx test/answer-sources.bench.ts [baseline.json]
 * Redirect stdout to save a baseline; passing it compares complete answers as well as timings.
 * Uses the committed game files and an empty lore release, isolating local game-file matching.
 * No network, live corpus or D1 latency is included. Each question gets a fresh process so
 * an earlier question cannot hide first-call regexp compilation costs.
 */
import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { answerSources } from "../src/answer-sources.js";
import { openDb } from "../src/db.js";
import { readFilesIndex } from "../src/files-evidence.js";

const questions = ["which bosses are in Deadmines", "where does Hogger spawn", "what drops Linen Cloth"];
if (process.argv[2] === "--question") {
  const question = process.argv[3]!;
  const files = readFilesIndex("../web/src/data/game-data");
  const db = openDb(":memory:");
  try {
    const started = performance.now();
    const answer = await answerSources(db, { question, limit: 8 }, null, null, files);
    const firstMs = performance.now() - started;
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      deepStrictEqual(await answerSources(db, { question, limit: 8 }, null, null, files), answer);
      times.push(performance.now() - start);
    }
    console.log(JSON.stringify({ question, facts: files.facts.length, firstMs, medianMs: times.sort((a, b) => a - b)[3], answer }));
  } finally { db.close(); }
} else {
  const results = questions.map((question) => JSON.parse(execFileSync(process.execPath,
    [...process.execArgv, "test/answer-sources.bench.ts", "--question", question], { encoding: "utf8" })));
  if (process.argv[2]) {
    const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
    deepStrictEqual(results.map((r) => r.answer), baseline.map((r: { answer: unknown }) => r.answer));
  }
  console.log(JSON.stringify(results, null, 2));
}
