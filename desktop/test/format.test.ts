import { expect, test } from "vitest";
import type { EngineState, JobState, Settings } from "../src/shared/types";
import { ago, companionStatus, copyLabel, esc, gold, kb, msg, sparkline, statusText } from "../src/renderer/format";

test("gold reads as gold, silver and copper, with the dash for unknown", () => {
  expect(gold(null)).toBe("–");
  expect(gold(0)).toBe("0c");
  expect(gold(57)).toBe("57c");
  expect(gold(1234)).toBe("12s 34c");
  expect(gold(12345678)).toBe(`${(1234).toLocaleString()}g 56s`);
});

test("sizes and ages are short", () => {
  expect(kb(512)).toBe("512 B");
  expect(kb(20480)).toBe("20 KB");
  expect(kb(1572864)).toBe("1.5 MB");
  const now = Date.parse("2026-10-18T12:00:00Z");
  expect(ago(null, now)).toBe("never");
  expect(ago("2026-10-18T11:59:50Z", now)).toBe("just now");
  expect(ago("2026-10-18T11:15:00Z", now)).toBe("45 min ago");
  expect(ago("2026-10-18T07:00:00Z", now)).toBe("5 h ago");
  expect(ago("2026-10-15T12:00:00Z", now)).toBe("3 d ago");
});

test("an IPC error shows only its reason", () => {
  expect(msg(new Error("Error invoking remote method 'restoreBackup': Error: not a backup"))).toBe("not a backup");
  expect(msg(new TypeError("TypeError: bad"))).toBe("bad");
  expect(msg("plain")).toBe("plain");
});

test("the Copy button says how the last press went on that answer only, and Copy otherwise", () => {
  expect(copyLabel(3, null)).toBe("Copy");
  expect(copyLabel(3, { index: 3, label: "Copied" })).toBe("Copied");
  expect(copyLabel(3, { index: 3, label: "Copy failed" })).toBe("Copy failed");
  expect(copyLabel(1, { index: 3, label: "Copied" })).toBe("Copy");
});

test("job status text follows the state", () => {
  expect(statusText({ state: "off", message: "", at: null })).toBe("Off");
  expect(statusText({ state: "idle", message: "", at: null })).toBe("Waiting for the next write");
  expect(statusText({ state: "ok", message: "", at: null })).toBe("Done");
  expect(statusText({ state: "ok", message: "sent 3", at: null })).toBe("sent 3");
  expect(statusText({ state: "error", message: "boom", at: null })).toBe("boom");
});

test("the sparkline needs two points, escapes its dates and spans the box", () => {
  expect(sparkline([])).toBe("");
  expect(sparkline([{ at: "2026-10-01", copper: 5 }])).toBe("");
  const svg = sparkline([{ at: "2026-10-01T00:00:00Z", copper: 100 }, { at: "2026-10-02T00:00:00Z", copper: 300 }, { at: "2026-10-03T00:00:00Z", copper: 200 }]);
  expect(svg).toContain('aria-label="gold from 2026-10-01 to 2026-10-03"');
  expect(svg).toContain("<title>3 snapshots, 2026-10-01 to 2026-10-03</title>");
  expect(svg).toContain('d="M0.0,23.0 L47.5,1.0 L95.0,12.0"');
  // A flat line sits in the middle.
  expect(sparkline([{ at: "a", copper: 7 }, { at: "b", copper: 7 }])).toContain('d="M0.0,12.0 L95.0,12.0"');
  expect(sparkline([{ at: '<"x">', copper: 1 }, { at: "b", copper: 2 }])).not.toContain('<"x">');
  expect(esc("<a href='x'>&</a>")).toBe("&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;");
});

const settings = (over: Partial<Settings> = {}): Settings => ({
  gameFolder: "C:/Games/WoW/_classic_era_", endpoint: "https://everloot.app", upload: true, prices: true, census: true, players: false,
  ask: { enabled: false, mcpUrl: "", tokenFile: null }, market: { realms: [] }, consentedAt: "2026-10-01T00:00:00Z", launchAtLogin: false, startInTray: false, ...over,
});
const engine = (jobs: Partial<Record<"upload" | "prices" | "ask", JobState>> = {}, over: Partial<EngineState> = {}): Pick<EngineState, "files" | "jobs" | "log" | "paused"> => {
  const job = (state: JobState) => ({ state, message: state === "error" ? "boom" : "", at: null });
  return { files: ["a/Everloot.lua"], log: [], paused: false, jobs: { upload: job(jobs.upload ?? "idle"), prices: job(jobs.prices ?? "idle"), ask: job(jobs.ask ?? "off") }, ...over };
};

test("the companion status never says ready before consent or a game folder", () => {
  expect(companionStatus({ settings: settings({ consentedAt: null }), engine: engine() }).state).toBe("setup");
  const noFolder = companionStatus({ settings: settings({ gameFolder: null }), engine: engine({}, { files: [] }) });
  expect(noFolder.state).toBe("setup");
  expect(noFolder.headline).toMatch(/game folder/i);
  // A folder with no addon file yet is waiting for the game, not missing setup.
  const noFile = companionStatus({ settings: settings(), engine: engine({}, { files: [] }) });
  expect(noFile.state).toBe("idle");
  expect(noFile.headline).toMatch(/first addon file/i);
  expect(noFile.detail).toMatch(/log out/i);
});

test("paused outranks errors and running work, and does not claim a running job was stopped", () => {
  const s = companionStatus({ settings: settings(), engine: engine({ upload: "running", prices: "error" }, { paused: true }) });
  expect(s.state).toBe("paused");
  expect(s.detail).toMatch(/Upload/);
  expect(s.detail).toMatch(/Market prices/);
  expect(s.detail).not.toMatch(/stopped|canceled/i);
});

test("an error is not hidden by another job running, and names only the failed jobs", () => {
  const s = companionStatus({ settings: settings(), engine: engine({ upload: "running", prices: "error", ask: "error" }) });
  expect(s.state).toBe("error");
  expect(s.jobs).toEqual(["prices", "ask"]);
  expect(s.detail).toContain("Market prices");
  expect(s.detail).toContain("In-game /ask");
  expect(s.detail).toMatch(/Upload/);
});

test("running names the jobs that are running, in upload, prices, ask order", () => {
  const s = companionStatus({ settings: settings(), engine: engine({ prices: "running", upload: "running" }) });
  expect(s.state).toBe("running");
  expect(s.jobs).toEqual(["upload", "prices"]);
  expect(s.detail).toBe("Upload and Market prices are running.");
});

test("all three jobs off says so; Ask off by default with the others waiting is just idle", () => {
  expect(companionStatus({ settings: settings(), engine: engine({ upload: "off", prices: "off", ask: "off" }) }).state).toBe("off");
  const idle = companionStatus({ settings: settings(), engine: engine() });
  expect(idle.state).toBe("idle");
  expect(idle.headline).toBe("Watching 1 account file");
});

test("a successful last run is idle, not proof that everything is healthy", () => {
  const s = companionStatus({ settings: settings(), engine: engine({ upload: "ok", prices: "ok" }, { files: ["a", "b"] }) });
  expect(s.state).toBe("idle");
  expect(s.headline).toBe("Watching 2 account files");
});

test("idle never promises an upload that is turned off", () => {
  const on = companionStatus({ settings: settings(), engine: engine() });
  expect(on.detail).toMatch(/next upload/i);
  const prices = companionStatus({ settings: settings({ upload: false }), engine: engine({ upload: "off", prices: "idle" }) });
  expect(prices.state).toBe("idle");
  expect(prices.headline).toBe("Watching 1 account file");
  expect(prices.detail).not.toMatch(/next upload/i);
  expect(prices.detail).toMatch(/Upload is off/);
  expect(prices.detail).toContain("Market prices is waiting");
  const askOnly = companionStatus({ settings: settings({ upload: false }), engine: engine({ upload: "off", prices: "off", ask: "idle" }) });
  expect(askOnly.state).toBe("idle");
  expect(askOnly.detail).not.toMatch(/next upload/i);
  expect(askOnly.detail).toContain("In-game /ask is waiting");
  expect(askOnly.detail).not.toContain("Market prices");
});
