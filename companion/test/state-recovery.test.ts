import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createSentState } from "../src/sent-state";
import { createAnswerStore } from "../src/bridge/run";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-recovery-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test.each(["", "{broken", "null", '{"install": [1]}'])("damaged receipt state is preserved and the uploader can recover: %s", (raw) => {
  const d = dir();
  const path = join(d, "sent.json");
  writeFileSync(path, raw);
  const notices: string[] = [];
  const state = createSentState(path, (message) => notices.push(message));
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("Starting fresh");
  expect(state.has("install", "epoch:1")).toBe(false);
  const saved = readdirSync(d).find((name) => name.startsWith("sent.json.corrupt-"));
  expect(saved).toBeDefined();
  expect(readFileSync(join(d, saved!), "utf8")).toBe(raw);
  state.add("install", ["epoch:1"]);
  expect(createSentState(path).has("install", "epoch:1")).toBe(true);
});

test.each(["", "{broken", "{}", '[{"id":"q1"}]'])("damaged answer state is preserved and new answers persist: %s", (raw) => {
  const d = dir();
  const path = join(d, "answers.json");
  writeFileSync(path, raw);
  const notices: string[] = [];
  const store = createAnswerStore(path, (message) => notices.push(message));
  expect(notices).toHaveLength(1);
  expect(store.list()).toEqual([]);
  const saved = readdirSync(d).find((name) => name.startsWith("answers.json.corrupt-"));
  expect(saved).toBeDefined();
  expect(readFileSync(join(d, saved!), "utf8")).toBe(raw);
  store.add({ id: "q1", answer: "answer", source: "test", answeredAt: "2026-10-27" });
  expect(createAnswerStore(path).has("q1")).toBe(true);
});

test("valid state files load untouched without a recovery warning", () => {
  const d = dir(), sent = join(d, "sent.json"), answers = join(d, "answers.json");
  const receipts = '\uFEFF{"install":["epoch:1"]}';
  const replies = '[{"id":"q1","answer":"ok","source":"test","answeredAt":"2026-10-27"}]';
  writeFileSync(sent, receipts); writeFileSync(answers, replies);
  const notices: string[] = [];
  expect(createSentState(sent, (m) => notices.push(m)).has("install", "epoch:1")).toBe(true);
  expect(createAnswerStore(answers, (m) => notices.push(m)).has("q1")).toBe(true);
  expect(notices).toEqual([]);
  expect(readdirSync(d).sort()).toEqual(["answers.json", "sent.json"]);
  expect(readFileSync(sent, "utf8")).toBe(receipts);
  expect(readFileSync(answers, "utf8")).toBe(replies);
});

test("a filesystem read error surfaces without treating an unreadable path as corrupt data", () => {
  const d = dir(), path = join(d, "sent.json");
  mkdirSync(path);
  const notices: string[] = [];
  expect(() => createSentState(path, (m) => notices.push(m))).toThrow();
  expect(notices).toEqual([]);
  expect(readdirSync(d)).toEqual(["sent.json"]);
});
