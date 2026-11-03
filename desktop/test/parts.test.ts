import { expect, test } from "vitest";
import type { JobState, JobStatus } from "../src/shared/types";
import { statePill, watchPill } from "../src/renderer/parts";

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
