import { expect, test } from "vitest";
import type { JobState, JobStatus, LogLine } from "../src/shared/types";
import { emptyCause, emptyState, ghostProfile, jobOfLine, ownedLockouts, ownedProfessions, statePill, threadLines, watchPill, workingStrip } from "../src/renderer/parts";

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
  // Following a realm is the realms panel's business; the scans panel says what a scan needs, whatever is followed.
  expect(emptyCause("market", base, { followed: 0 } as never).cause).toBe("No full scan in your save file yet");
});

test("a fetch error is the cause, with a retry", () => {
  const e = emptyCause("changes", base, { error: "changes feed: 503" });
  expect(e.cause).toBe("changes feed: 503");
  expect(e.action?.label).toBe("Retry");
});

test("with everything on and a file watched, each page has its own reason", () => {
  expect(emptyCause("characters", base).cause).toBe("Save file read, no named character rows yet");
  expect(emptyCause("upload", base).action?.run).toBe("upload");
  expect(emptyCause("market", base).cause).toBe("No full scan in your save file yet");
  expect(emptyCause("ask", base).cause).toBe("No question waiting");
  expect(emptyCause("log", base).cause).toBe("Nothing logged since start");
});

test("a line's job comes from its prefix, and the rest belongs to the app", () => {
  expect(jobOfLine("upload TESTACC: sent 0 new events")).toBe("upload");
  expect(jobOfLine("upload: paused, skipped")).toBe("upload");
  expect(jobOfLine("prices: 0 items on 0 realm(s) written")).toBe("prices");
  expect(jobOfLine("prices: the site asked to wait; trying again in 3 min")).toBe("prices");
  expect(jobOfLine("ask TESTACC: answered 1 question")).toBe("ask");
  expect(jobOfLine("Watching 1 account file(s) in W:\\_classic_era_")).toBe("app");
  expect(jobOfLine("builds: 2 saved build(s) written")).toBe("app");
  expect(jobOfLine("uploads are not a job")).toBe("app");
});

test("the thread keeps app lines, reads oldest first and marks the newest", () => {
  const log: LogLine[] = [
    { at: "2026-11-03T01:00:00Z", level: "info", text: "Watching 1 account file(s)" },
    { at: "2026-11-03T01:01:00Z", level: "error", text: "upload X: failed" },
  ];
  const html = threadLines(log, 10, { upload: "U", prices: "P", ask: "A", app: "E" });
  expect(html.indexOf("Watching")).toBeLessThan(html.indexOf("failed"));
  expect(html).toContain('data-job="app"');
  expect(html).toContain('data-job="upload"');
  expect(html).toContain("step-error");
  expect(html.match(/step-last/g)?.length).toBe(1);
  expect(html.lastIndexOf("step-last")).toBeGreaterThan(html.indexOf("Watching"));
});

test("the thread shows the last n lines and nothing for an empty log", () => {
  const log: LogLine[] = Array.from({ length: 5 }, (_, i) => ({ at: "2026-11-03T01:0" + i + ":00Z", level: "info", text: "prices: line " + i }));
  const html = threadLines(log, 2, { upload: "", prices: "", ask: "", app: "" });
  expect(html).toContain("line 3"); expect(html).toContain("line 4"); expect(html).not.toContain("line 2");
  expect(threadLines([], 10, { upload: "", prices: "", ask: "", app: "" })).toBe("");
});

const strip = (state: JobState, paused: boolean) => ({ engine: { jobs: { upload: j(state) }, paused, files: ["a"], log: [] }, settings: { upload: true } } as never as Parameters<typeof workingStrip>[1]);

test("a strip carries the pill, the headline and the job's last line", () => {
  const html = workingStrip("upload", strip("running", false), "Uploading TESTACC", { at: "2026-11-03T01:01:00Z", level: "info", text: "upload TESTACC: sending <2> batches" });
  expect(html).toContain("pill-working");
  expect(html).toContain("strip-working");
  expect(html).toContain("Uploading TESTACC");
  expect(html).toContain("sending &lt;2&gt; batches");
  expect(html).toContain('aria-live="polite"');
});

test("a strip with no line yet has the headline only, and a paused engine says Paused", () => {
  const html = workingStrip("upload", strip("idle", true), "Waiting for the next write", null);
  expect(html).toContain(">Paused<");
  expect(html).toContain("strip-paused");
  expect(html).not.toContain("strip-last");
});

test("the ghost profile is hidden from assistive tech and draws the three regions", () => {
  const html = ghostProfile();
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("river-card");
  expect(html).toContain("week-card");
  expect(html).toContain("Roster");
  expect((html.match(/wk-col/g) ?? []).length).toBe(7);
});

test("the rendered block escapes the cause and carries the action as a data attribute", () => {
  const html = emptyState({ cause: "<b>" + "x".repeat(140), step: "", action: { label: "Open Settings", page: "settings" } }, "");
  expect(html).toContain("&lt;b&gt;");
  expect(html).toContain('class="empty"');
  expect(html).toContain('data-page="settings"');
  expect(emptyState({ cause: "c", step: "s", action: { label: "Upload now", run: "upload" } }, "")).toContain('data-run="upload"');
});

test("a keyed character's professions and raid lockouts read as rank of max and killed of total; none is a dash, never a zero", () => {
  expect(ownedProfessions([{ name: "Mining", rank: 280, maxRank: 300 }])).toBe('<div>Mining <span class="muted">280/300</span></div>');
  expect(ownedProfessions([])).toBe('<span class="muted">–</span>');
  const html = ownedLockouts([{ instance: "Zul'Gurub <b>", difficulty: "20 Player", killed: 3, total: 10, resetAt: "2026-11-11T12:00:00Z" }]);
  expect(html).toContain("Zul&#39;Gurub &lt;b&gt;");
  expect(html).toContain("20 Player · 3/10 · resets ");
  expect(ownedLockouts([{ instance: "Molten Core", difficulty: "", killed: 6, total: 10, resetAt: "2026-11-11T12:00:00Z" }])).toContain('<span class="muted">6/10 · resets ');
  expect(ownedLockouts([])).toBe('<span class="muted">–</span>');
});

test("the Addon page without a folder offers only Open Settings", () => {
  const e = emptyCause("addon", { ...base, settings: { ...base.settings, gameFolder: null } });
  expect(e.cause).toBe("Not watching a game folder");
  expect(e.action).toEqual({ label: "Open Settings", page: "settings" });
  const html = emptyState(e, "");
  expect(html).toContain('data-page="settings"');
  expect(html.match(/<button /g)).toHaveLength(1);
});

test("Market with nothing written offers one price refresh, without changing the no-scan cause", () => {
  const e = emptyCause("market", base, { written: false });
  expect(e.cause).toBe("Nothing written into the game yet");
  expect(e.action).toEqual({ label: "Refresh prices", run: "prices" });
  const html = emptyState(e, "");
  expect(html).toContain('data-run="prices"');
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(emptyCause("market", base).cause).toBe("No full scan in your save file yet");
});
