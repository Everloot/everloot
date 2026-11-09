import { expect, test } from "vitest";
import type { EcosystemView, ProjectView } from "@/lib/ecosystem";
import { boardHref, boardQuery, boardRows, changeSince, initials, logoUrl, repoOwner, sortBoard } from "./addon-board";

const project = (id: string, over: { stars?: number | null; commits4w?: number | null; release?: string; lastCommit?: string; installs?: number | null; repo?: string; summary?: string; kind?: "addon" | "tool"; metrics?: false; gain?: ProjectView["starGain7d"] } = {}): ProjectView => ({
  id, name: id[0].toUpperCase() + id.slice(1), kind: over.kind ?? "addon", summary: over.summary ?? `${id} summary`,
  repo: over.repo ?? `${id}-owner/${id}`, url: `https://github.com/${over.repo ?? `${id}-owner/${id}`}`, addonNames: [],
  installs: over.installs ?? null, foreverReady: "unknown", badges: [], maintenanceScore: null, starGain7d: over.gain ?? null,
  metrics: over.metrics === false ? null : {
    status: "ok", fetchedAt: "2026-10-20T00:00:00Z", stars: over.stars ?? null, archived: false, license: null,
    lastCommit: over.lastCommit ?? null, release: over.release ? { tag: "v1", date: over.release, url: `https://github.com/x/${id}/releases/tag/v1` } : null,
    commits4w: over.commits4w ?? null, contributors: null, openIssues: null, closedIssues: null,
    medianFirstResponseHours: null, responseSample: 0, interfaces: null,
  },
});
const viewOf = (projects: ProjectView[]): EcosystemView => ({ refreshedAt: "2026-10-20T17:00:00Z", forever: null, projects, installsAvailable: true });

const names = (rows: { project: ProjectView }[]) => rows.map((r) => r.project.id);

test("the default ranking is stars, then commits in 4 weeks, then name; projects without facts come last", () => {
  const rows = boardRows(viewOf([
    project("zed", { stars: 0, commits4w: 66 }),
    project("gone", { metrics: false }),
    project("polestar", { stars: 133, commits4w: 1726 }),
    project("alpha", { stars: 0, commits4w: 66 }),
    project("olympus", { stars: 20, commits4w: 651 }),
    project("everloot", { stars: 0, commits4w: 1026 }),
  ]));
  expect(names(rows)).toEqual(["polestar", "olympus", "everloot", "alpha", "zed", "gone"]);
  expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("sorting by a column renumbers the rows and keeps missing values last both ways", () => {
  const rows = boardRows(viewOf([
    project("a", { stars: 5, commits4w: 3, release: "2026-10-01T00:00:00Z" }),
    project("b", { stars: 9, commits4w: null, release: "2026-10-19T00:00:00Z" }),
    project("c", { stars: 1, commits4w: 40 }),
  ]));
  const byCommits = sortBoard(rows, "commits", true);
  expect(names(byCommits)).toEqual(["c", "a", "b"]);
  expect(byCommits.map((r) => r.rank)).toEqual([1, 2, 3]);
  expect(names(sortBoard(rows, "commits", false))).toEqual(["a", "c", "b"]);
  expect(names(sortBoard(rows, "release", true))).toEqual(["b", "a", "c"]);
  expect(names(sortBoard(rows, "release", false))).toEqual(["a", "b", "c"]);
  expect(names(sortBoard(rows, "name", false))).toEqual(["a", "b", "c"]);
  expect(names(sortBoard(rows, "name", true))).toEqual(["c", "b", "a"]);
});

test("the query reads view, kind and sort, and anything unknown falls back to the default", () => {
  expect(boardQuery({})).toEqual({ view: "leaderboard", sort: "stars", desc: true });
  expect(boardQuery({ view: "cards", kind: "tool", sort: "-commits" })).toEqual({ view: "cards", sort: "commits", desc: true, kind: "tool" });
  expect(boardQuery({ sort: "name" })).toMatchObject({ sort: "name", desc: false });
  expect(boardQuery({ view: "grid", kind: "theme", sort: "-hype" })).toEqual({ view: "leaderboard", sort: "stars", desc: true });
  expect(boardQuery({ view: ["cards", "leaderboard"] })).toMatchObject({ view: "leaderboard" });
});

test("links leave the defaults out and round-trip through the query", () => {
  expect(boardHref({ view: "leaderboard", sort: "stars", desc: true })).toBe("/addons");
  const href = boardHref({ view: "cards", sort: "release", desc: true, kind: "addon" });
  expect(href).toBe("/addons?view=cards&kind=addon&sort=-release");
  expect(boardQuery(Object.fromEntries(new URL(href, "https://everloot.app").searchParams))).toEqual({ view: "cards", sort: "release", desc: true, kind: "addon" });
});

test("the change column is the view's own star gain, and the oldest since-date is null when no row has one", () => {
  const view = viewOf([project("a", { stars: 133, gain: { change: 33, since: "2026-10-14T18:00:00Z" } }), project("b", { stars: 3 })]);
  const rows = boardRows(view);
  expect(rows.find((r) => r.project.id === "a")).toMatchObject({ change: 33, changeSince: "2026-10-14T18:00:00Z" });
  expect(rows.find((r) => r.project.id === "b")).toMatchObject({ change: null, changeSince: null });
  expect(changeSince(rows)).toBe("2026-10-14T18:00:00Z");
  expect(changeSince(boardRows(viewOf([project("b", { stars: 3 })])))).toBeNull();
});

test("logos come from the repo owner's GitHub picture, with initials when there is no owner", () => {
  expect(repoOwner("fitzforge/polestar")).toBe("fitzforge");
  expect(logoUrl("fitzforge/polestar")).toBe("https://github.com/fitzforge.png?size=64");
  expect(logoUrl("not a repo")).toBeNull();
  expect(logoUrl("-bad/name")).toBeNull();
  expect(initials("forever-ref")).toBe("FR");
  expect(initials("Polestar")).toBe("PO");
  const [row] = boardRows(viewOf([project("x", { repo: "../x", summary: "  " })]));
  expect(row.logo).toBeNull();
  expect(row.owner).toBeNull();
  expect(row.description).toBeNull();
});
