import { expect, test } from "vitest";
import { censusFromRows, type CensusRow, type CensusWindow, type Faction } from "../../../kb/src/census";
import {
  RANKINGS, START_LINE, firstWeek, hubIndexable, parseRankingQuery, rankRows, rankedCount, rankingDef, rankingHref,
  rankingIndexable, rankingView, rankingWeeks, weekStart,
} from "./rankings";

let n = 0;
/** `count` characters of one race and class, seen by three installs from three addresses in turn. */
const crowd = (count: number, prefix: string, at: string, over: Partial<CensusRow> = {}): CensusRow[] =>
  Array.from({ length: count }, (_, i) => ({
    kind: "census_seen", installId: `install-${"abc"[i % 3]}`, reporter: `${i % 3}`.padStart(16, "0"), eventId: `census_seen:x:${++n}`,
    capturedAt: at, characterKey: `${prefix}${i.toString(16).padStart(4, "0")}`, serverId: 4,
    race: "Human", class: "HUNTER", level: 20, faction: "Alliance", via: "target", ...over,
  }));

const WEEK1 = "2026-11-11T10:00:00.000Z"; // the first ranked week, from Monday 9 November
const WEEK2 = "2026-11-18T10:00:00.000Z";
const LAUNCH_WEEK = "2026-11-06T10:00:00.000Z"; // launch week, before the first full week

/** A mixed week: clear counts, a small one (hidden), and a Horde side. */
const mixed = (at: string, p: string) => [
  ...crowd(42, `${p}1`, at, { race: "Human", class: "HUNTER" }),
  ...crowd(28, `${p}2`, at, { race: "Human", class: "WARRIOR", level: 60 }),
  ...crowd(16, `${p}3`, at, { race: "Gnome", class: "PRIEST" }),
  ...crowd(22, `${p}4`, at, { race: "Orc", class: "HUNTER", faction: "Horde" }),
  ...crowd(4, `${p}5`, at, { race: "Gnome", class: "MAGE" }),
  ...crowd(30, `${p}6`, at, { kind: "census_self", realm: "Forever", via: undefined, race: "Troll", class: "PRIEST", faction: "Horde" }),
];

/** A hand-made week: only what rankRows reads. */
const windowOf = (classes: Record<string, number | null>, characters: number | null = 100): CensusWindow => ({
  id: "week", from: "", to: "", collecting: characters === null, characters, installs: 3, bias: { own: null, seen: null },
  factions: [], races: [], raceClass: [], levels: [],
  classes: Object.entries(classes).map(([cls, count]) => ({ class: cls, count })),
});

test("weeks are ISO weeks from Monday 00:00 UTC, and the first ranked week is the first full week after launch", () => {
  expect(new Date(weekStart(Date.parse("2026-11-15T23:59:59.999Z"))).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  expect(new Date(weekStart(Date.parse("2026-11-16T00:00:00.000Z"))).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  expect(new Date(firstWeek()).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  expect(new Date(firstWeek("2026-11-09T00:00:00.000Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  expect(START_LINE).toBe("Rankings start with the first full week after 4 November.");
});

test("before the first full week there are no weeks, so no numbers, even with rows from launch week", () => {
  expect(rankingWeeks(mixed(LAUNCH_WEEK, "l"), "2026-11-08T23:00:00.000Z")).toEqual([]);
  const view = rankingView(rankingDef("classes")!, []);
  expect(view.week).toBeNull();
  expect(view.rows).toEqual([]);
});

test("a frozen week's counts match /census for that span cell for cell: thresholds, rounding and complementary suppression", () => {
  const rows = [...mixed(LAUNCH_WEEK, "l"), ...mixed(WEEK1, "w"), ...mixed(WEEK2, "v")];
  const weeks = rankingWeeks(rows, "2026-11-20T12:00:00.000Z");
  expect(weeks.map((w) => [w.start, w.current])).toEqual([["2026-11-09", false], ["2026-11-16", true]]);
  const census = censusFromRows(rows, "2026-11-15T23:59:59.999Z").windows.week;
  const week = weeks[0].window;
  for (const key of ["collecting", "characters", "installs", "factions", "races", "classes", "raceClass", "levels", "bias"] as const) {
    expect(week[key], key).toEqual(census[key]);
  }
  // The small cell is hidden, and so is at least one more, so it can't be worked out from the total.
  expect(week.classes.find((c) => c.class === "MAGE")!.count).toBeNull();
  expect(week.classes.filter((c) => c.count === null).length).toBeGreaterThanOrEqual(2);
  expect(week.classes.find((c) => c.class === "HUNTER")!.count).toBe(65);
});

test("the current week counts only its own rows, so far", () => {
  const weeks = rankingWeeks([...mixed(WEEK1, "w"), ...crowd(12, "z", WEEK2, { class: "WARRIOR" })], "2026-11-20T12:00:00.000Z");
  expect(weeks[1].to).toBe("2026-11-20T12:00:00.000Z");
  expect(weeks[1].window.collecting).toBe(false);
  expect(weeks[1].window.characters).toBe(10);
});

test("ranks follow the rounded counts: equal counts share a rank, hidden counts come last and unranked", () => {
  const rows = rankRows("classes", windowOf({ HUNTER: 40, WARRIOR: 40, PRIEST: 20, MAGE: null, ROGUE: null }));
  expect(rows.map((r) => [r.label, r.rank, r.count])).toEqual([
    ["Hunter", 1, 40], ["Warrior", 1, 40], ["Priest", 3, 20], ["Mage", null, null], ["Rogue", null, null],
  ]);
  expect(rows[0].share).toBe(0.4);
  expect(rows[3].share).toBeNull();
  expect(rankedCount(rows)).toBe(3);
});

test("change against last week: up, down, unchanged, and new for a row hidden last week", () => {
  const last = windowOf({ HUNTER: 40, WARRIOR: 30, PRIEST: 20, ROGUE: null });
  const now = windowOf({ WARRIOR: 45, HUNTER: 40, PRIEST: 20, ROGUE: 15 });
  const change = Object.fromEntries(rankRows("classes", now, {}, last).map((r) => [r.label, r.change]));
  expect(change).toEqual({ Warrior: { dir: "up", by: 1 }, Hunter: { dir: "down", by: 1 }, Priest: "same", Rogue: "new" });
  // No week before, or one still collecting: nothing to compare with.
  expect(rankRows("classes", now).every((r) => r.change === null)).toBe(true);
  expect(rankRows("classes", now, {}, windowOf({}, null)).every((r) => r.change === null)).toBe(true);
});

test("across two stored weeks the view compares with the week before; with one week there is no change column", () => {
  const def = rankingDef("classes")!;
  const second = [
    ...crowd(42, "v1", WEEK2, { class: "HUNTER" }), ...crowd(60, "v2", WEEK2, { class: "WARRIOR" }),
    ...crowd(16, "v3", WEEK2, { race: "Gnome", class: "PRIEST" }), ...crowd(22, "v4", WEEK2, { race: "Orc", class: "HUNTER", faction: "Horde" }),
    ...crowd(30, "v6", WEEK2, { race: "Troll", class: "PRIEST", faction: "Horde" }), ...crowd(6, "v7", WEEK2, { race: "Gnome", class: "MAGE" }),
    ...crowd(5, "v8", WEEK2, { race: "Gnome", class: "WARLOCK" }),
  ];
  const one = rankingView(def, rankingWeeks(mixed(WEEK1, "w"), "2026-11-15T12:00:00.000Z"));
  expect(one.previous).toBeNull();
  expect(one.rows.every((r) => r.change === null)).toBe(true);
  expect(one.weeksWithNumbers).toBe(1);

  const two = rankingView(def, rankingWeeks([...mixed(WEEK1, "w"), ...second], "2026-11-20T12:00:00.000Z"));
  expect(two.week!.start).toBe("2026-11-16");
  expect(two.previous!.start).toBe("2026-11-09");
  const before = new Map(rankRows("classes", two.previous!.window).map((r) => [r.key, r.rank]));
  for (const row of two.rows.filter((r) => r.rank !== null)) {
    const was = before.get(row.key);
    const expected = was == null ? "new" : was === row.rank ? "same" : { dir: was > row.rank! ? "up" : "down", by: Math.abs(was - row.rank!) };
    expect(row.change, row.label).toEqual(expected);
  }
  const change = (label: string) => two.rows.find((r) => r.label === label)!.change;
  // Warrior was hidden last week (complementary suppression), so it is new; it now ranks between Hunter and Priest.
  expect(change("Warrior")).toBe("new");
  expect(change("Hunter")).toBe("same");
  expect(change("Priest")).toEqual({ dir: "down", by: 1 });
  expect(two.weeksWithNumbers).toBe(2);
  expect(two.series[0].points).toHaveLength(2);
});

test("the default week is the newest with numbers; a current week still collecting falls back to last week", () => {
  const weeks = rankingWeeks([...mixed(WEEK1, "w"), ...crowd(3, "z", "2026-11-16T01:00:00.000Z")], "2026-11-16T02:00:00.000Z");
  expect(weeks.map((w) => w.window.collecting)).toEqual([false, true]);
  expect(rankingView(rankingDef("classes")!, weeks).week!.start).toBe("2026-11-09");
  expect(rankingView(rankingDef("classes")!, weeks, { week: "2026-11-16" }).week!.start).toBe("2026-11-16");
});

test("URL state: only the filters a ranking offers, with valid values, survive; the href writes them back in order", () => {
  const weeks = rankingWeeks(mixed(WEEK1, "w"), "2026-11-15T12:00:00.000Z");
  const races = rankingDef("races")!;
  const classes = rankingDef("classes")!;
  expect(parseRankingQuery(races, { faction: "HORDE", class: "priest", week: "2026-11-09" }, weeks)).toEqual({ faction: "Horde", class: "PRIEST", week: "2026-11-09" });
  expect(parseRankingQuery(races, { faction: "neutral", class: "monk", week: "2026-11-02" }, weeks)).toEqual({});
  expect(parseRankingQuery(classes, { faction: "alliance", class: "mage" }, weeks)).toEqual({});
  expect(parseRankingQuery(races, { faction: ["alliance", "horde"] }, weeks)).toEqual({ faction: "Alliance" });
  const href = rankingHref("races", { week: "2026-11-09", class: "PRIEST", faction: "Horde" });
  expect(href).toBe("/rankings/races?faction=horde&class=priest&week=2026-11-09");
  expect(parseRankingQuery(races, Object.fromEntries(new URL(href, "https://x").searchParams), weeks)).toEqual({ faction: "Horde", class: "PRIEST", week: "2026-11-09" });
  expect(rankingHref("classes", {})).toBe("/rankings/classes");
});

test("race filters only pick published cells: a faction keeps its races, a class reads the race and class grid", () => {
  const weeks = rankingWeeks(mixed(WEEK1, "w"), "2026-11-15T12:00:00.000Z");
  const w = weeks[0].window;
  const horde = rankingView(rankingDef("races")!, weeks, { faction: "horde" }).rows;
  expect(horde.every((r) => r.faction === "Horde")).toBe(true);
  expect(horde.map((r) => r.count).sort()).toEqual(w.races.filter((r) => r.faction === "Horde").map((r) => r.count).sort());
  const hunters = rankingView(rankingDef("races")!, weeks, { class: "hunter" }).rows;
  for (const r of hunters) {
    const [faction, race] = r.key.split("/");
    expect(r.count).toBe(w.raceClass.find((c) => c.faction === faction && c.race === race && c.class === "HUNTER")!.count);
  }
});

test("indexing: unfiltered with at least 10 ranked rows; a filtered or past-week view never", () => {
  const races: { race: string; faction: Faction }[] = [
    ...["Orc", "Tauren", "Troll", "Scourge", "Skyborne"].map((race) => ({ race, faction: "Horde" as const })),
    ...["Dwarf", "Gnome", "Human", "NightElf", "Skyborne"].map((race) => ({ race, faction: "Alliance" as const })),
  ];
  // Every race here can be a Warrior.
  const rows = races.flatMap((r, i) => crowd(12, `r${i}`, WEEK1, { race: r.race, faction: r.faction, class: "WARRIOR" }));
  const weeks = rankingWeeks(rows, "2026-11-15T12:00:00.000Z");
  const view = rankingView(rankingDef("races")!, weeks);
  expect(rankedCount(view.rows)).toBe(10);
  expect(rankingIndexable(view)).toBe(true);
  expect(rankingIndexable(rankingView(rankingDef("races")!, weeks, { faction: "horde" }))).toBe(false);
  expect(rankingIndexable(rankingView(rankingDef("races")!, weeks, { week: "2026-11-09" }))).toBe(false);
  // Nine classes and two factions can never reach 10 rows.
  expect(rankingIndexable(rankingView(rankingDef("classes")!, weeks))).toBe(false);
  expect(hubIndexable(weeks)).toBe(true);
  expect(hubIndexable(rankingWeeks(mixed(WEEK1, "w"), "2026-11-15T12:00:00.000Z"))).toBe(false);
  expect(hubIndexable([])).toBe(false);
});

test("every ranking has a description search engines accept", () => {
  for (const r of RANKINGS) expect(r.description.length, r.slug).toBeGreaterThanOrEqual(120);
  for (const r of RANKINGS) expect(r.description.length, r.slug).toBeLessThanOrEqual(160);
});
