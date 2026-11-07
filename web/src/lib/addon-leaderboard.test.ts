import { expect, test, vi } from "vitest";
import type { AddonPopularity } from "../../../kb/src/addon-rollup";
import type { ProjectView } from "../../../kb/src/ecosystem";

vi.mock("@/data/addon-repos", () => {
  const sources: Record<string, { repo: string; curseforge?: string; wago?: string }> = {
    Tracked: { repo: "someone/tracked", curseforge: "https://www.curseforge.com/wow/addons/tracked" },
    Curated: { repo: "someone/curated", wago: "https://addons.wago.io/addons/curated" },
  };
  return {
    approvedAddon: (name: string) => {
      const key = Object.keys(sources).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? { name: key, title: `${key} (owner title)`, source: sources[key] } : null;
    },
  };
});

import { LIVE_LIMIT, leaderRows, liveRepos, rateLimited, sparkPoints } from "./addon-leaderboard";

const addon = (name: string, share = 0.5): AddonPopularity => ({
  name, title: name, installs: 3, loadedInstalls: 3, versions: [], share,
  firstSeen: "2026-10-10T00:00:00.000Z", lastSeen: "2026-10-17T00:00:00.000Z", public: true,
});
const project = (addonNames: string[], stars: number | null): ProjectView => ({
  id: "tracked", name: "Tracked", kind: "addon", summary: "", repo: "someone/tracked", url: "https://github.com/someone/tracked",
  addonNames, installs: null, badges: [], maintenanceScore: null, starGain7d: null, foreverReady: null as unknown as ProjectView["foreverReady"],
  metrics: stars === null ? null : {
    status: "ok", fetchedAt: "2026-10-31T00:00:00Z", stars, archived: false, license: null, lastCommit: null,
    release: { tag: "v1", date: "2026-10-19T17:20:38Z", url: "https://github.com/someone/tracked/releases/tag/v1" },
    commits4w: null, contributors: null, openIssues: null, closedIssues: null, medianFirstResponseHours: null, responseSample: 0, interfaces: null,
  },
});

test("only curated repositories the snapshot does not cover are read live", () => {
  const addons = [addon("Tracked"), addon("Curated"), addon("Questie")];
  expect(liveRepos(addons, [project(["Tracked"], 10)])).toEqual(["someone/curated"]);
  // Without snapshot facts the tracked one is read live too.
  expect(liveRepos(addons, [project(["Tracked"], null)])).toEqual(["someone/tracked", "someone/curated"]);
  expect(LIVE_LIMIT).toBeGreaterThan(0);
});

test("rows join the snapshot, live reads and curated links; an unknown addon gets a search and no GitHub", () => {
  const rows = leaderRows(
    [addon("Tracked", 0.9), addon("Curated", 0.6), addon("Questie Plus", 0.3)],
    { Tracked: { shares: [0.5, 0.9], previousRank: 2 }, Curated: { shares: [0.7, 0.6], previousRank: 1 }, "Questie Plus": { shares: [null, 0.3], previousRank: null } },
    [project(["tracked"], 172)],
    { "someone/curated": { status: "ok", data: { repo: "someone/curated", url: "https://github.com/someone/curated", stars: 5, release: null } } },
  );
  expect(rows.map((r) => [r.rank, r.name, r.stars, r.release?.date ?? null, r.movement])).toEqual([
    [1, "Tracked", 172, "2026-10-19", { kind: "up", by: 1 }],
    [2, "Curated", 5, null, { kind: "down", by: 1 }],
    [3, "Questie Plus", null, null, { kind: "new" }],
  ]);
  expect(rows[0]).toMatchObject({ github: "https://github.com/someone/tracked", owner: "someone", curseforge: { href: "https://www.curseforge.com/wow/addons/tracked", search: false }, wago: null });
  expect(rows[1].wago).toBe("https://addons.wago.io/addons/curated");
  expect(rows[2]).toMatchObject({ github: null, logo: null, curseforge: { href: "https://www.curseforge.com/wow/search?search=Questie%20Plus", search: true } });
});

test("only an approved addon gets a page and the owner's title; an unapproved one keeps its usage label and no link", () => {
  const forged = { ...addon("Tracked"), title: "Tracked: free gold at evil.example" };
  const rows = leaderRows([forged, addon("Questie Plus")], {}, [], {});
  expect(rows[0]).toMatchObject({ title: "Tracked (owner title)", page: "/addons/Tracked" });
  expect(rows[1]).toMatchObject({ title: "Questie Plus", page: null });
  expect(JSON.stringify(rows)).not.toContain("evil.example");
});

test("with no board a week earlier there is no movement, not a column of New", () => {
  const rows = leaderRows([addon("Questie")], { Questie: { shares: [null, 0.5], previousRank: null } }, [], {});
  expect(rows[0].movement).toBeNull();
});

test("a rate-limited live read is reported, a missing repository is not", () => {
  expect(rateLimited({ a: { status: "unavailable", rateLimited: true } })).toBe(true);
  expect(rateLimited({ a: { status: "missing" }, b: { status: "unavailable", rateLimited: false } })).toBe(false);
  // The repository was read but its release hit the limit: the notice shows too.
  const data = { repo: "someone/curated", url: "https://github.com/someone/curated", stars: 5, release: null };
  expect(rateLimited({ a: { status: "partial", data, rateLimited: true } })).toBe(true);
  expect(rateLimited({ a: { status: "partial", data, rateLimited: false } })).toBe(false);
});

test("the sparkline needs two listed weeks and skips the weeks before the addon was listed", () => {
  expect(sparkPoints([null, 0.5])).toBeNull();
  expect(sparkPoints([null, 0.2, 0.4])).toBe("32.0,16.0 62.0,2.0");
  expect(sparkPoints([0.5, 0.5])).toBe("2.0,9.0 62.0,9.0");
});
