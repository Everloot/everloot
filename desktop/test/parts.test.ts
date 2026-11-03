import { expect, test } from "vitest";
import type { JobState, JobStatus } from "../src/shared/types";
import { statePill } from "../src/renderer/parts";

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
