import { expect, test } from "vitest";
import { addonTrends, plainTitle, popularAddonsFromRecords, rollupAllAddons, type AddonSeenRow } from "../src/addon-rollup.js";

/** When the corpus was current: rows dated after it are ignored. */
const AS_OF = "2026-10-17T12:00:00Z";

const seen = (installId: string, name: string, capturedAt = "2026-10-17T00:00:00Z", loaded = true): AddonSeenRow =>
  ({ installId, name, title: name, loaded, capturedAt });

test("an addon is public once three installs report it", () => {
  const two = rollupAllAddons([seen("a", "Questie"), seen("b", "Questie")]);
  expect(two.addons[0]).toMatchObject({ name: "Questie", installs: 2, public: false });
  const three = rollupAllAddons([seen("a", "Questie"), seen("b", "Questie"), seen("c", "Questie")]);
  expect(three.addons[0]).toMatchObject({ name: "Questie", installs: 3, loadedInstalls: 3, share: 1, public: true });
});

test("one install reporting every session counts once", () => {
  const { addons } = rollupAllAddons([
    seen("a", "Questie", "2026-10-15T00:00:00Z"),
    seen("a", "Questie", "2026-10-16T00:00:00Z"),
    seen("a", "Questie", "2026-10-17T00:00:00Z"),
  ]);
  expect(addons[0]).toMatchObject({ installs: 1, public: false, firstSeen: "2026-10-15T00:00:00.000Z", lastSeen: "2026-10-17T00:00:00.000Z" });
});

test("the share is the installs running it out of every install that reported its addons", () => {
  const { addons, reportingInstalls } = rollupAllAddons([
    seen("a", "Questie"), seen("b", "Questie"), seen("c", "Questie", undefined, false),
    seen("a", "Bagnon"), seen("b", "Bagnon"), seen("c", "Bagnon"), seen("d", "Bagnon"),
    seen("d", "Everloot"),
  ]);
  expect(reportingInstalls).toBe(4);
  const questie = addons.find((a) => a.name === "Questie")!;
  expect(questie).toMatchObject({ installs: 3, loadedInstalls: 2, share: 0.5, public: true });
  expect(addons.map((a) => a.name)).toEqual(["Bagnon", "Questie"]);
});

test("Everloot and its answers addon are left out of the ranking", () => {
  const rows = ["a", "b", "c"].flatMap((id) => [seen(id, "Everloot"), seen(id, "EverlootAnswers"), seen(id, "Questie")]);
  expect(rollupAllAddons(rows).addons.map((a) => a.name)).toEqual(["Questie"]);
});

test("the rollup holds no install id", () => {
  const facts = popularAddonsFromRecords([
    { kind: "addon_seen", installId: "install-one", name: "Questie", title: "Questie", loaded: true, capturedAt: "2026-10-15T00:00:00Z" },
    { kind: "addon_seen", installId: "install-two", name: "Questie", title: "Questie", loaded: true, capturedAt: "2026-10-17T00:00:00Z" },
    { kind: "addon_seen", installId: "install-ten", name: "Questie", title: "Questie", loaded: true, capturedAt: "2026-10-16T00:00:00Z" },
    { kind: "addon_seen", installId: "install-six", name: "Questie", title: "Questie", loaded: "yes", capturedAt: "2026-10-17T00:00:00Z" },
    { kind: "loot", installId: "install-one" },
  ], AS_OF);
  // Each install reported once, so the third install's report is both the first and the last date three installs back.
  expect(facts.addons).toEqual([{
    name: "Questie", title: "Questie", installs: 3, loadedInstalls: 3, share: 1, versions: [],
    firstSeen: "2026-10-17T00:00:00.000Z", lastSeen: "2026-10-17T00:00:00.000Z", public: true,
  }]);
  expect(JSON.stringify(facts)).not.toContain("install-");
});

test("one install's different title never wins, however new it is", () => {
  const { addons } = rollupAllAddons([
    seen("a", "Questie", "2026-10-10T00:00:00Z"), seen("b", "Questie", "2026-10-10T00:00:00Z"), seen("c", "Questie", "2026-10-10T00:00:00Z"),
    { ...seen("d", "Questie", "2026-10-16T00:00:00Z"), title: "Questie FREE GOLD" },
  ], AS_OF);
  expect(addons[0]).toMatchObject({ name: "Questie", title: "Questie", installs: 4 });
});

test("a title fewer than three installs agree on falls back to the folder name", () => {
  const { addons } = rollupAllAddons([
    { ...seen("a", "DBM-Core"), title: "Deadly Boss Mods" },
    { ...seen("b", "DBM-Core"), title: "Deadly Boss Mods" },
    { ...seen("c", "DBM-Core"), title: "DBM" },
  ], AS_OF);
  expect(addons[0]).toMatchObject({ name: "DBM-Core", title: "DBM-Core", public: true });
});

test("colour codes, textures and links are stripped from titles before they are compared", () => {
  expect(plainTitle("|cff00ff00Questie|r |TInterface\\Icons\\INV_Misc_Map_01:16|t")).toBe("Questie");
  expect(plainTitle("|Hitem:1234|h[Bags]|h |A:atlas-name:12:12|a")).toBe("[Bags]");
  expect(plainTitle("|cffffd200|r")).toBe("");
  const { addons } = rollupAllAddons([
    { ...seen("a", "Questie"), title: "|cffffd200Questie|r" },
    seen("b", "Questie"),
    { ...seen("c", "Questie"), title: "Questie |TInterface\\Icons\\x:16|t" },
  ], AS_OF);
  expect(addons[0].title).toBe("Questie");
});

test("rows dated after the corpus was current are ignored", () => {
  const { addons, reportingInstalls } = rollupAllAddons([
    seen("a", "Questie", "2026-10-14T00:00:00Z"), seen("b", "Questie", "2026-10-15T00:00:00Z"), seen("c", "Questie", "2026-10-16T00:00:00Z"),
    seen("c", "Questie", "2099-12-31T00:00:00Z"),
    seen("d", "Questie", "2099-12-31T00:00:00Z"),
  ], AS_OF);
  expect(reportingInstalls).toBe(3);
  expect(addons[0]).toMatchObject({ installs: 3, lastSeen: "2026-10-16T00:00:00.000Z" });
});

test("first seen is when the third install had reported; last seen is the newest date three installs reach", () => {
  const { addons } = rollupAllAddons([
    seen("a", "Questie", "2001-01-01T00:00:00Z"), seen("a", "Questie", "2026-10-16T12:00:00Z"),
    seen("b", "Questie", "2026-10-05T00:00:00Z"), seen("b", "Questie", "2026-10-15T00:00:00Z"),
    seen("c", "Questie", "2026-10-10T00:00:00Z"), seen("c", "Questie", "2026-10-14T00:00:00Z"),
    seen("d", "Questie", "2026-10-12T00:00:00Z"),
  ], AS_OF);
  // Earliest per install: a 2001, b 10-05, c 10-10, d 10-12. Latest: a 10-16, b 10-15, c 10-14, d 10-12.
  expect(addons[0]).toMatchObject({ firstSeen: "2026-10-10T00:00:00.000Z", lastSeen: "2026-10-14T00:00:00.000Z" });
});

test("dates are stored in UTC whatever offset the client wrote", () => {
  const { addons } = rollupAllAddons(["a", "b", "c"].map((id) => seen(id, "Questie", "2026-10-16T23:30:00-05:00")), AS_OF);
  expect(addons[0]).toMatchObject({ firstSeen: "2026-10-17T04:30:00.000Z", lastSeen: "2026-10-17T04:30:00.000Z" });
});

test("the leaderboard's rows leave out addons fewer than three installs report, not just flag them", () => {
  const records = [
    ...["a", "b", "c"].map((id) => ({ kind: "addon_seen", ...seen(id, "Questie") })),
    ...["a", "b"].map((id) => ({ kind: "addon_seen", ...seen(id, "MyGuildTools") })),
  ];
  const { addons, reportingInstalls } = popularAddonsFromRecords(records);
  expect(addons.map((a) => a.name)).toEqual(["Questie"]);
  expect(reportingInstalls).toBe(3);
  expect(JSON.stringify(addons)).not.toContain("MyGuildTools");
});

test("a version is listed only when three installs report it, highest version first", () => {
  const v = (installId: string, version: string, capturedAt: string): AddonSeenRow => ({ ...seen(installId, "Questie", capturedAt), version });
  const { addons } = popularAddonsFromRecords([
    v("a", "1.0", "2026-10-10T00:00:00Z"), v("b", "1.0", "2026-10-10T00:00:00Z"), v("c", "1.0", "2026-10-11T00:00:00Z"),
    v("a", "1.1", "2026-10-15T00:00:00Z"), v("b", "1.1", "2026-10-15T00:00:00Z"), v("c", "1.1", "2026-10-16T00:00:00Z"),
    v("a", "1.9", "2026-10-16T00:00:00Z"), v("b", "1.9", "2026-10-16T00:00:00Z"), v("c", "1.9", "2026-10-16T00:00:00Z"),
    v("a", "1.10", "2026-10-01T00:00:00Z"), v("b", "1.10", "2026-10-01T00:00:00Z"), v("c", "1.10", "2026-10-01T00:00:00Z"),
    v("a", "9.9-private", "2026-10-16T00:00:00Z"), v("b", "9.9-private", "2026-10-16T00:00:00Z"),
  ].map((row) => ({ kind: "addon_seen", ...row })), AS_OF);
  expect(addons[0].versions).toEqual(["1.10", "1.9", "1.1", "1.0"].map((version) => ({ version, installs: 3 })));
  expect(JSON.stringify(addons)).not.toContain("9.9-private");
});

const WEEK_MS = 7 * 86_400_000;
/** The end of week i of `weeks`, the last one at AS_OF: the cut-off each published point is read at. */
const weekEnd = (i: number, weeks: number) => new Date(Date.parse(AS_OF) - (weeks - 1 - i) * WEEK_MS);
/** A time inside week i of `weeks`, a day before its end. */
const inWeek = (i: number, weeks: number) => new Date(weekEnd(i, weeks).getTime() - 86_400_000).toISOString();

test("loaded counts growing one install a week publish nothing but today", () => {
  // The review's case: three installs, the addon loaded on one, then two, then all three.
  const rows = [
    ...["a", "b", "c"].map((id) => seen(id, "Questie", inWeek(0, 3), false)),
    seen("a", "Questie", inWeek(0, 3)), seen("b", "Questie", inWeek(1, 3)), seen("c", "Questie", inWeek(2, 3)),
  ];
  expect(addonTrends(rows, AS_OF, 3)).toEqual({ Questie: { shares: [null, null, 1], previousRank: null } });
});

test("weeks that add three installs at a time are published, with the rank a week earlier", () => {
  const rows = [
    // Bagnon: three installs in week 0 and three more in week 1.
    ...["a", "b", "c"].map((id) => seen(id, "Bagnon", inWeek(0, 3))),
    ...["d", "e", "f"].map((id) => seen(id, "Bagnon", inWeek(1, 3))),
    // Questie: on the week 1 installs, then on three new ones in week 2, so it overtakes Bagnon.
    ...["d", "e", "f"].map((id) => seen(id, "Questie", inWeek(1, 3))),
    ...["g", "h", "i"].map((id) => seen(id, "Questie", inWeek(2, 3))),
  ];
  const trends = addonTrends(rows, AS_OF, 3);
  expect(trends.Bagnon).toEqual({ shares: [1, 1, 6 / 9], previousRank: 1 });
  expect(trends.Questie).toEqual({ shares: [null, 0.5, 6 / 9], previousRank: 2 });
});

test("a week that adds one or two reporting installs is hidden for every addon", () => {
  const rows = [
    ...["a", "b", "c", "d", "e", "f"].map((id) => seen(id, "Bagnon", inWeek(0, 3))),
    // One new install in week 2: week 1 and today differ by one install, so week 1 cannot be shown.
    seen("g", "Bagnon", inWeek(2, 3)),
  ];
  expect(addonTrends(rows, AS_OF, 3).Bagnon).toEqual({ shares: [null, null, 1], previousRank: null });
});

test("no rows or no weeks means no trend", () => {
  expect(addonTrends([], AS_OF)).toEqual({});
  expect(addonTrends(["a", "b", "c"].map((id) => seen(id, "Questie")), AS_OF, 0)).toEqual({});
});

/** A small seeded generator, so a failing case can be replayed. */
function random(seed: number) {
  return () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
}

test("from the published history, no count or change below three installs can be worked out", () => {
  const weeks = 6;
  let pastPoints = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rand = random(seed);
    const rows: AddonSeenRow[] = [];
    const installs = 3 + Math.floor(rand() * 25);
    for (let n = 0; n < installs; n++) {
      const joined = Math.floor(rand() * weeks);
      for (const name of ["Questie", "Bagnon", "Details", "WeakAuras"]) {
        if (rand() < 0.6) rows.push(seen(`i${n}`, name, inWeek(joined, weeks), false));
        if (rand() < 0.5) rows.push(seen(`i${n}`, name, inWeek(joined + Math.floor(rand() * (weeks - joined)), weeks)));
      }
    }
    const trends = addonTrends(rows, AS_OF, weeks);
    // The reader's best case: the reporting installs at every week end are known.
    const boards = Array.from({ length: weeks }, (_, i) => rollupAllAddons(rows, weekEnd(i, weeks)));
    const published = (name: string) => trends[name].shares.flatMap((share, i) => (share === null ? [] : [i]));
    const weeksShown = new Set(Object.keys(trends).flatMap(published));
    for (const i of weeksShown) {
      const gap = boards[weeks - 1].reportingInstalls - boards[i].reportingInstalls;
      expect(gap === 0 || gap >= 3, `seed ${seed}: reporting installs at week ${i}`).toBe(true);
    }
    for (const [name, trend] of Object.entries(trends)) {
      pastPoints += published(name).length - 1;
      const loaded = published(name).map((i) => {
        const truth = boards[i].addons.find((a) => a.name === name)!;
        expect(trend.shares[i], `seed ${seed}: ${name} week ${i}`).toBeCloseTo(truth.share, 12);
        return Math.round(trend.shares[i]! * boards[i].reportingInstalls);
      });
      for (let i = 0; i < loaded.length - 1; i++) {
        expect(loaded[i], `seed ${seed}: ${name} loaded`).toBeGreaterThanOrEqual(3);
        for (let j = i + 1; j < loaded.length; j++) {
          const change = loaded[j] - loaded[i];
          expect(change === 0 || change >= 3, `seed ${seed}: ${name} change ${loaded[i]} to ${loaded[j]}`).toBe(true);
        }
      }
    }
  }
  // The rule leaves something to check: plenty of past points are published.
  expect(pastPoints).toBeGreaterThan(100);
});

test("the history is one pass over the rows: 100,000 rows take under 300 ms", () => {
  const rows: AddonSeenRow[] = [];
  for (let n = 0; n < 100_000; n++) {
    rows.push(seen(`i${n % 5000}`, `Addon${n % 40}`, new Date(Date.parse(AS_OF) - (n % 56) * 86_400_000).toISOString(), n % 3 !== 0));
  }
  const started = performance.now();
  addonTrends(rows, AS_OF);
  expect(performance.now() - started).toBeLessThan(300);
});
