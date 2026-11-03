import { expect, test } from "vitest";
import type { JobState, JobStatus } from "../src/shared/types";
import { emptyCause, emptyState, statePill, watchPill } from "../src/renderer/parts";

const j = (state: JobState): JobStatus => ({ state, message: "", at: null });

test("each job state has a pill with a visible word", () => {
  expect(statePill(j("running"), false)).toContain("pill-working");
  expect(statePill(j("running"), false)).toContain("pill-ring");
  expect(statePill(j("running"), false)).toContain(">Working<");
  expect(statePill(j("error"), false)).toContain(">Failed<");
  expect(statePill(j("ok"), false)).toContain(">OK<");
  expect(statePill(j("off"), false)).toContain(">Off<");
  expect(statePill(j("idle"), false)).toContain(">Waiting<");
});

test("a paused engine says so for every job that is on", () => {
  expect(statePill(j("idle"), true)).toContain(">Paused<");
  expect(statePill(j("idle"), true)).toContain("pill-paused");
  expect(statePill(j("off"), true)).toContain(">Off<");
});

test("the watch pill counts files and says paused first", () => {
  expect(watchPill({ files: ["a"], paused: false })).toContain("Watching 1 file<");
  expect(watchPill({ files: ["a"], paused: false })).toContain("pill-ok");
  expect(watchPill({ files: ["a", "b"], paused: false })).toContain("Watching 2 files<");
  expect(watchPill({ files: [], paused: false })).toContain("Not watching");
  expect(watchPill({ files: [], paused: false })).toContain("pill-off");
  expect(watchPill({ files: ["a"], paused: true })).toContain(">Paused<");
});

const base = { settings: { gameFolder: "W:\\_classic_era_", upload: true, ask: { enabled: true } }, engine: { files: ["a"], paused: false } } as never as Parameters<typeof emptyCause>[1];

test("no game folder beats everything", () => {
  const e = emptyCause("characters", { ...base, settings: { ...base.settings, gameFolder: null } });
  expect(e.cause).toBe("Not watching a game folder");
  expect(e.action?.page).toBe("settings");
});

test("a folder with no save file says the folder and the fix", () => {
  const e = emptyCause("upload", { ...base, engine: { ...base.engine, files: [] } });
  expect(e.cause).toContain("W:\\_classic_era_");
  expect(e.step).toContain("Log out once");
  expect(e.action).toBeUndefined();
});

test("a paused app says so before anything about data", () => {
  expect(emptyCause("market", { ...base, engine: { ...base.engine, paused: true } }).cause).toBe("Everloot is paused");
});

test("an off job says it is off before anything about data", () => {
  expect(emptyCause("ask", { ...base, settings: { ...base.settings, ask: { ...base.settings.ask, enabled: false } } }).cause).toBe("/ask is off");
  expect(emptyCause("upload", { ...base, settings: { ...base.settings, upload: false } }).cause).toBe("Upload is off");
  expect(emptyCause("market", base, { followed: 0 }).cause).toBe("No realm followed yet");
});

test("a fetch error is the cause, with a retry", () => {
  const e = emptyCause("changes", base, { error: "changes feed: 503" });
  expect(e.cause).toBe("changes feed: 503");
  expect(e.action?.label).toBe("Retry");
});

test("with everything on and a file watched, each page has its own reason", () => {
  expect(emptyCause("characters", base).cause).toBe("Save file read, no named character rows yet");
  expect(emptyCause("upload", base).action?.run).toBe("upload");
  expect(emptyCause("market", base, { followed: 2 }).cause).toBe("No full scan in your save file yet");
  expect(emptyCause("ask", base).cause).toBe("No question waiting");
  expect(emptyCause("log", base).cause).toBe("Nothing logged since start");
});

test("the rendered block escapes the cause and carries the action as a data attribute", () => {
  const html = emptyState({ cause: "<b>" + "x".repeat(140), step: "", action: { label: "Open Settings", page: "settings" } }, "");
  expect(html).toContain("&lt;b&gt;");
  expect(html).toContain('class="empty"');
  expect(html).toContain('data-page="settings"');
  expect(emptyState({ cause: "c", step: "s", action: { label: "Upload now", run: "upload" } }, "")).toContain('data-run="upload"');
});
