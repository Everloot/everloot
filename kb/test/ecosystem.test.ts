import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  badgesFor, buildBoards, buildView, currentForeverInterface, foreverReady, interfaceFromVersion, handleEcosystemProjects, joinInstalls, maintenanceScore,
  median, medianFirstResponse, parseRegistry, parseSnapshot, parseTocInterfaces, starGain,
  type ProjectMetrics, type Registry, type Snapshot,
} from "../src/ecosystem.js";

const FOREVER = currentForeverInterface([{ product: "wow_classic_beta", version: "1.60.1.70450", buildId: 70450 }]);
const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const metrics = (over: Partial<ProjectMetrics> = {}): ProjectMetrics => ({
  status: "ok", fetchedAt: daysAgo(0), stars: 10, archived: false, license: "MIT", lastCommit: daysAgo(2),
  release: { tag: "v1.0.0", date: daysAgo(10), url: "https://github.com/o/r/releases/tag/v1.0.0" },
  commits4w: 5, contributors: 2, openIssues: 2, closedIssues: 8, medianFirstResponseHours: 10, responseSample: 6,
  interfaces: [16001], ...over,
});

const project = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id.toUpperCase(), kind: "addon", summary: "Plain summary.", repo: `o/${id}`, addonNames: [id],
  verifiedAt: "2026-10-18", evidence: `https://github.com/o/${id}`, ...over,
});
const registry = (...projects: ReturnType<typeof project>[]): Registry =>
  parseRegistry({ schema: 1, projects });
const snapshot = (projects: Record<string, ProjectMetrics>, history: Snapshot["history"] = {}): Snapshot =>
  ({ schema: 1, refreshedAt: daysAgo(0), projects, history });

describe("the committed registry", () => {
  const raw = JSON.parse(readFileSync(new URL("../curated/ecosystem.json", import.meta.url), "utf8"));
  test("parses, and every project is verified and on a public GitHub repo", () => {
    const parsed = parseRegistry(raw);
    expect(parsed.projects.length).toBeGreaterThan(0);
    expect(parsed.projects.map((p) => p.id)).toContain("everloot");
    for (const p of parsed.projects) {
      expect(p.evidence, p.id).toMatch(/^https:\/\//);
      expect(p.verifiedAt, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  const committedForever = () => currentForeverInterface(JSON.parse(readFileSync(new URL("../changes/builds.json", import.meta.url), "utf8")).builds);
  test("our own addon's .toc is Forever-ready against the newest Forever build we know", () => {
    expect(committedForever()?.interface).toBeGreaterThan(0);
    const toc = readFileSync(new URL("../../addon/Everloot.toc", import.meta.url), "utf8");
    expect(foreverReady(parseTocInterfaces(toc), committedForever())).toBe("yes");
  });
  test("the committed snapshot parses and only names registered projects", () => {
    const snap = parseSnapshot(JSON.parse(readFileSync(new URL("../changes/ecosystem.json", import.meta.url), "utf8")));
    const ids = new Set(parseRegistry(raw).projects.map((p) => p.id));
    for (const id of Object.keys(snap.projects)) expect(ids.has(id), id).toBe(true);
  });
});

describe("registry validation", () => {
  const bad = (over: Record<string, unknown>) => () => registry(project("a", over));
  test("names the entry and field", () => {
    expect(bad({ repo: "not a repo" })).toThrow("(a): repo must be owner/name");
    expect(bad({ repo: "o/r/extra" })).toThrow("repo must be owner/name");
    expect(bad({ kind: "guild" })).toThrow("kind must be addon or tool");
    expect(bad({ summary: "x".repeat(161) })).toThrow("summary");
    expect(bad({ toc: "../x.toc" })).toThrow("toc");
    expect(bad({ toc: "addon/x.lua" })).toThrow("toc");
    expect(bad({ evidence: "javascript:alert(1)" })).toThrow("evidence must be a web link");
    expect(bad({ verifiedAt: "yesterday" })).toThrow("verifiedAt");
    expect(bad({ id: "Bad Id" })).toThrow("bad id");
    expect(bad({ addonNames: ["a/b"] })).toThrow("addonNames");
  });
  test("a duplicate id is refused", () => {
    expect(() => registry(project("a"), project("a"))).toThrow("duplicate id a");
  });
});

describe("metrics math", () => {
  test("median of odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  test("median first response: replied issues count their wait", () => {
    const issue = (h: number | null, age = 20) => ({
      createdAt: daysAgo(age),
      firstResponseAt: h === null ? null : new Date(Date.parse(daysAgo(age)) + h * 3_600_000).toISOString(),
    });
    expect(medianFirstResponse([issue(2), issue(10), issue(30)], NOW)).toEqual({ hours: 10, sample: 3 });
  });
  test("an unanswered issue a week old counts as its age; a younger one is left out", () => {
    const old = { createdAt: daysAgo(10), firstResponseAt: null };
    const young = { createdAt: daysAgo(2), firstResponseAt: null };
    const a = { createdAt: daysAgo(20), firstResponseAt: new Date(Date.parse(daysAgo(20)) + 3_600_000).toISOString() };
    const r = medianFirstResponse([a, a, old, young], NOW);
    expect(r.sample).toBe(3);
    expect(r.hours).toBe(1);
  });
  test("fewer than three usable issues is not a median", () => {
    const a = { createdAt: daysAgo(20), firstResponseAt: new Date(Date.parse(daysAgo(20)) + 3_600_000).toISOString() };
    expect(medianFirstResponse([a, a], NOW)).toEqual({ hours: null, sample: 2 });
  });
  test("a reply dated before the issue is ignored", () => {
    expect(medianFirstResponse([{ createdAt: daysAgo(5), firstResponseAt: daysAgo(6) }], NOW).sample).toBe(0);
  });
  test("star gain uses the newest point at least six days old, and needs one", () => {
    const history = [{ at: daysAgo(20), stars: 1 }, { at: daysAgo(7), stars: 10 }, { at: daysAgo(3), stars: 14 }];
    expect(starGain(history, 20, NOW)).toBe(10);
    expect(starGain([{ at: daysAgo(2), stars: 5 }], 9, NOW)).toBeNull();
    expect(starGain(history, null, NOW)).toBeNull();
  });
});

describe("Forever-ready", () => {
  test("parses single, list and variant Interface lines, once each", () => {
    expect(parseTocInterfaces("## Interface: 16001\n## Title: x")).toEqual([16001]);
    expect(parseTocInterfaces("## Interface: 11509, 16001, 20506\r\n")).toEqual([11509, 16001, 20506]);
    expect(parseTocInterfaces("## Interface-Classic: 16001\n## Interface: 16001")).toEqual([16001]);
    expect(parseTocInterfaces("## Notes: Interface: 16001\n## Interface: abc")).toEqual([]);
  });
  test("yes, no and unknown", () => {
    expect(foreverReady([11509, 16001], FOREVER)).toBe("yes");
    expect(foreverReady([11509], FOREVER)).toBe("no");
    expect(foreverReady([70058], FOREVER)).toBe("no"); // a build number, not an interface
    expect(foreverReady([], FOREVER)).toBe("unknown");
    expect(foreverReady(null, FOREVER)).toBe("unknown");
    expect(foreverReady([16001], null)).toBe("unknown");
  });
  test("the interface comes from the version: Blizzard's major*10000 + minor*100 + patch", () => {
    expect(interfaceFromVersion("1.60.1.70450")).toBe(16001);
    expect(interfaceFromVersion("1.15.9.70003")).toBe(11509); // Classic Era, the number Olympus ships for it
    expect(interfaceFromVersion("1.60.12")).toBe(16012);
    expect(interfaceFromVersion("nonsense")).toBeNull();
    expect(interfaceFromVersion("1.600.1")).toBeNull();
  });
  test("it is taken from the newest Forever build and carries its stamp", () => {
    const builds = [
      { product: "wow_classic_beta", version: "1.60.1.70058", buildId: 70058 },
      { product: "wow_classic_beta", version: "1.60.2.70611", buildId: 70611 },
      { product: "wow_classic_era", version: "1.15.9.70003", buildId: 99999 },
    ];
    expect(currentForeverInterface(builds)).toEqual({ interface: 16002, version: "1.60.2.70611", build: 70611, derivedFrom: "version" });
    expect(currentForeverInterface([builds[2]])).toBeNull();
    expect(currentForeverInterface([])).toBeNull();
  });
  test("the newest build counts whether it is WoW Forever's own product (wowf) or the beta", () => {
    const builds = [
      { product: "wow_classic_beta", version: "1.60.1.70532", buildId: 70532 },
      { product: "wowf", version: "1.60.1.70630", buildId: 70630 },
      { product: "wow_classic_era", version: "1.15.9.70576", buildId: 70576 },
    ];
    expect(currentForeverInterface(builds)).toEqual({ interface: 16001, version: "1.60.1.70630", build: 70630, derivedFrom: "version" });
  });
});

describe("badges and the maintenance score", () => {
  test("badges follow the facts and the thresholds", () => {
    expect(badgesFor(metrics(), "yes", NOW)).toEqual(["forever-ready", "active", "fresh-release", "responsive", "open-license"]);
    expect(badgesFor(metrics({ lastCommit: daysAgo(31), release: null, medianFirstResponseHours: 49, license: null }), "no", NOW)).toEqual([]);
    expect(badgesFor(metrics({ archived: true }), "unknown", NOW)).toEqual(["responsive", "open-license", "archived"]);
    expect(badgesFor(null, "yes", NOW)).toEqual(["forever-ready"]);
  });
  test("a full-marks project scores 100", () => {
    expect(maintenanceScore(metrics({ closedIssues: 10, openIssues: 0 }), NOW)).toBe(100);
  });
  test("a part GitHub cannot show is left out, not scored as zero", () => {
    const sparse = metrics({ release: null, openIssues: 1, closedIssues: 1, medianFirstResponseHours: null });
    expect(maintenanceScore(sparse, NOW)).toBe(100); // commit 30/30 + licence 10/10
    expect(maintenanceScore(metrics({ release: null, openIssues: 1, closedIssues: 1, medianFirstResponseHours: null, license: null }), NOW)).toBe(75);
  });
  test("a stale project scores low, an archived or missing one has no score", () => {
    expect(maintenanceScore(metrics({ lastCommit: daysAgo(400), release: { tag: "v", date: daysAgo(500), url: "https://x.test/" }, medianFirstResponseHours: 400, openIssues: 9, closedIssues: 0, license: null }), NOW)).toBe(0);
    expect(maintenanceScore(metrics({ archived: true }), NOW)).toBeNull();
    expect(maintenanceScore({ ...metrics(), status: "missing" }, NOW)).toBeNull();
    expect(maintenanceScore(null, NOW)).toBeNull();
  });
  test("under 40 measurable points there is no score", () => {
    expect(maintenanceScore(metrics({ lastCommit: null, release: null, openIssues: null, closedIssues: null, medianFirstResponseHours: null }), NOW)).toBeNull();
  });
});

describe("the 3-install join", () => {
  test("below three installs is not counted, three or more is", () => {
    expect(joinInstalls(["Polestar"], [{ name: "Polestar", installs: 2 }])).toBeNull();
    expect(joinInstalls(["Polestar"], [{ name: "Polestar", installs: 3 }])).toBe(3);
  });
  test("matches folder names without regard to case and takes the largest, never the sum", () => {
    const popular = [{ name: "olympus", installs: 5 }, { name: "Olympus_Arena", installs: 4 }, { name: "Other", installs: 99 }];
    expect(joinInstalls(["Olympus", "Olympus_Arena"], popular)).toBe(5);
  });
  test("an unlisted addon, no folder names and unreadable counts are all null", () => {
    expect(joinInstalls(["Nope"], [{ name: "Polestar", installs: 9 }])).toBeNull();
    expect(joinInstalls([], [{ name: "Polestar", installs: 9 }])).toBeNull();
    expect(joinInstalls(["Polestar"], null)).toBeNull();
  });
  test("a view never carries a count the rule hides", () => {
    const reg = registry(project("a"), project("b"));
    const view = buildView(reg, snapshot({}), [{ name: "a", installs: 2 }, { name: "b", installs: 7 }], NOW, FOREVER);
    expect(view.projects.map((p) => p.installs)).toEqual([null, 7]);
  });
});

describe("boards", () => {
  const reg = registry(project("alpha"), project("beta"), project("gamma"), project("delta"), project("old"));
  const snap = snapshot(
    {
      alpha: metrics({ commits4w: 30, lastCommit: daysAgo(1), release: { tag: "v3", date: daysAgo(5), url: "https://x.test/a" } }),
      beta: metrics({ commits4w: 30, lastCommit: daysAgo(3), release: { tag: "v2", date: daysAgo(1), url: "https://x.test/b" }, license: null, medianFirstResponseHours: null, responseSample: 0 }),
      gamma: metrics({ commits4w: 0, release: null, stars: 50 }),
      delta: metrics({ archived: true, commits4w: 99 }),
      old: { ...metrics(), status: "missing" },
    },
    { alpha: [{ at: daysAgo(8), stars: 9 }], beta: [{ at: daysAgo(8), stars: 4 }], gamma: [{ at: daysAgo(8), stars: 49 }], delta: [{ at: daysAgo(8), stars: 0 }] },
  );
  const popular = [{ name: "alpha", installs: 4 }, { name: "beta", installs: 12 }, { name: "gamma", installs: 3 }, { name: "delta", installs: 50 }];
  const boards = Object.fromEntries(buildBoards(buildView(reg, snap, popular, NOW, FOREVER), NOW).map((b) => [b.id, b.rows.map((r) => r.project.id)]));

  test("most installed: by count, archived and missing excluded", () => {
    expect(boards.installed).toEqual(["beta", "alpha", "gamma"]);
  });
  test("rising: stars gained in a week, only gains, archived out", () => {
    // beta +6; alpha and gamma +1 each, tied, so by name; delta is archived.
    expect(boards.rising).toEqual(["beta", "alpha", "gamma"]);
  });
  test("most active: commits in 4 weeks, ties by newest commit, zero left out", () => {
    expect(boards.active).toEqual(["alpha", "beta"]);
  });
  test("freshest release: newest date first, projects without a release out", () => {
    expect(boards.release).toEqual(["beta", "alpha"]);
  });
  test("best maintained: score order, a project with no score is out", () => {
    // alpha 96, gamma 95 (no release is left out, not zeroed), beta 83 (no licence, no reply time).
    expect(boards.maintained).toEqual(["alpha", "gamma", "beta"]);
  });
  test("ties break on the name, not on registry order", () => {
    const flipped = registry(project("beta"), project("alpha"));
    const tie = snapshot({ alpha: metrics({ commits4w: 7, lastCommit: daysAgo(2) }), beta: metrics({ commits4w: 7, lastCommit: daysAgo(2) }) });
    const rows = buildBoards(buildView(flipped, tie, null, NOW, FOREVER), NOW).find((b) => b.id === "active")!.rows.map((r) => r.project.id);
    expect(rows).toEqual(["alpha", "beta"]);
  });
  test("with no history the rising board is empty, and with no counts so is installed", () => {
    const view = buildView(reg, snapshot(snap.projects), null, NOW, FOREVER);
    const b = buildBoards(view, NOW);
    expect(b.find((x) => x.id === "rising")!.rows).toEqual([]);
    expect(b.find((x) => x.id === "installed")!.rows).toEqual([]);
  });
});

describe("handleEcosystemProjects", () => {
  const reg = registry(project("alpha", { summary: "Alpha does things." }), project("beta"));
  const view = buildView(reg, snapshot({ alpha: metrics(), beta: metrics({ interfaces: [11509] }) }), [{ name: "alpha", installs: 5 }], NOW, FOREVER);
  test("not connected is not an empty list", () => {
    expect(handleEcosystemProjects(null, { board: "all", limit: 10 })).toMatch(/not connected/);
  });
  test("lists projects with links, installs and the data age", () => {
    const text = handleEcosystemProjects(view, { board: "all", limit: 10 }, NOW);
    expect(text).toContain("ALPHA [addon]: Alpha does things.");
    expect(text).toContain("5 installs");
    expect(text).toContain("Repository: https://github.com/o/alpha");
    expect(text).toContain("GitHub data refreshed 2026-10-20");
  });
  test("a board, the limit and the Forever-ready filter apply", () => {
    expect(handleEcosystemProjects(view, { board: "installed", limit: 10 }, NOW)).toMatch(/^1\. ALPHA/);
    expect(handleEcosystemProjects(view, { board: "all", limit: 1 }, NOW).match(/Repository:/g)).toHaveLength(1);
    const ready = handleEcosystemProjects(view, { board: "all", forever_ready_only: true, limit: 10 }, NOW);
    expect(ready).toContain("ALPHA");
    expect(ready).not.toContain("BETA [");
  });
  test("an empty board says so and does not invent rows", () => {
    expect(handleEcosystemProjects(view, { board: "rising", limit: 10 }, NOW)).toMatch(/^No projects match/);
  });
});
