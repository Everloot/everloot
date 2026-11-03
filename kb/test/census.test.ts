import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  CENSUS_CLASSES, CENSUS_LAUNCH, CENSUS_MIN_CHARACTERS, CENSUS_MIN_INSTALLS, CENSUS_MIN_REPORTERS, CENSUS_RACES, CENSUS_ROUND_TO, FACTIONS, LEVEL_BANDS,
  censusFromRows, roundCount, rollupCensus, type CensusCount, type CensusRow, type CensusView, type CensusWindow, type Faction,
} from "../src/census.js";

/** When the corpus was current: a Monday, twelve days after launch. */
const AS_OF = "2026-11-16T12:00:00Z";
const LAUNCH = CENSUS_LAUNCH;
const INSTALLS = ["install-a", "install-b", "install-c"];

/** The keyed address hash intake stamps (16 hex): one address per install here, unless a test says otherwise. */
const addr = (installId: string) => createHash("sha256").update(installId).digest("hex").slice(0, 16);

let seq = 0;
const row = (over: Partial<CensusRow> & Pick<CensusRow, "installId" | "characterKey">): CensusRow => ({
  kind: "census_seen", eventId: `census_seen:2026-11-15:${(++seq).toString(16)}`, capturedAt: "2026-11-15T10:00:00.000Z",
  serverId: 4, race: "Gnome", class: "PRIEST", level: 20, faction: "Alliance", via: "target", reporter: addr(over.installId), ...over,
});

/** `n` different characters, each reported once, spread over `installs` in turn. */
const crowd = (n: number, prefix: string, over: Partial<CensusRow> = {}, installs = INSTALLS) =>
  Array.from({ length: n }, (_, i) => row({ installId: installs[i % installs.length], characterKey: `${prefix}${i.toString(16).padStart(4, "0")}`, ...over }));

/** Levels that hit both ends of every band, used in turn. */
const LEVELS = [1, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 60];
const COMBOS = CENSUS_RACES.flatMap((r) => r.classes.map((c) => ({ faction: r.faction, race: r.token, class: c })));

/**
 * Every playable race and class with `n` characters, levels across every band and one in four an own
 * upload, so no slice is small and nothing is hidden. `skip` leaves one combination out.
 */
function everyone(n = 20, skip?: string): CensusRow[] {
  return COMBOS.filter((c) => `${c.faction}/${c.race}/${c.class}` !== skip).flatMap((c, k) => Array.from({ length: n }, (_, i) => row({
    installId: INSTALLS[i % 3], characterKey: `f${k.toString(16).padStart(2, "0")}${i.toString(16).padStart(4, "0")}`,
    faction: c.faction, race: c.race, class: c.class, level: LEVELS[(i + k) % LEVELS.length],
    ...(i % 4 === 0 ? { kind: "census_self" as const, realm: "Forever", via: undefined } : {}),
  })));
}

const census = (rows: CensusRow[], asOf = AS_OF) => rollupCensus(rows, { asOf, launch: LAUNCH });
const week = (rows: CensusRow[], asOf = AS_OF) => census(rows, asOf).windows.week;
const cell = (w: CensusWindow, race: string, cls: string, faction = "Alliance") =>
  w.raceClass.find((c) => c.race === race && c.class === cls && c.faction === faction)!.count;
const band = (w: CensusWindow, id: string) => w.levels.find((l) => l.band === id)!.count;
const klass = (w: CensusWindow, id: string) => w.classes.find((c) => c.class === id)!.count;

test("one character counts once, however many installs see it and whether it uploads its own rows", () => {
  const rows = crowd(10, "aa");
  // A popular character: seen by twenty installs and uploading its own data too.
  for (let i = 0; i < 20; i++) rows.push(row({ installId: `install-${i}`, characterKey: "aa0000", via: i % 2 ? "mouseover" : "group" }));
  rows.push(row({ installId: "install-own", characterKey: "aa0000", kind: "census_self", realm: "Forever", via: undefined }));
  expect(week(rows).characters).toBe(10);
});

test("the latest report sets a character's level, from any install or kind", () => {
  // Thirty characters first reported at 12, later at 23 by their own upload; an older report of 5 changes nothing.
  const movers = crowd(30, "bb", { level: 12, capturedAt: "2026-11-12T08:00:00.000Z" });
  movers.push(...crowd(30, "bb", { level: 23, kind: "census_self", realm: "Forever", via: undefined, capturedAt: "2026-11-16T08:00:00.000Z" }, ["install-own"]));
  movers.push(...crowd(30, "bb", { level: 5, capturedAt: "2026-11-10T08:00:00.000Z" }));
  const moved = week([...everyone(), ...movers]);
  const stayed = week([...everyone(), ...crowd(30, "bb", { level: 23 })]);
  expect(moved.levels).toEqual(stayed.levels);
  expect(band(moved, "20-29")).not.toEqual(band(week(everyone()), "20-29"));
});

test("ties go to the higher level, then an own row, then the smaller install id; the event id is never read", () => {
  const at = "2026-11-15T10:00:00.000Z";
  const pair = (prefix: string, a: Partial<CensusRow>, b: Partial<CensusRow>) =>
    Array.from({ length: 30 }, (_, i) => {
      const key = `${prefix}${i.toString(16).padStart(4, "0")}`;
      return [row({ installId: "install-b", characterKey: key, capturedAt: at, ...a }), row({ installId: "install-c", characterKey: key, capturedAt: at, ...b })];
    }).flat();
  const winners = (rows: CensusRow[]) => week([...everyone(), ...rows]).classes;
  // Same time: level 30 beats 20, though its install sorts last.
  expect(winners(pair("t1", { class: "MAGE", level: 20 }, { class: "WARRIOR", level: 30 })))
    .toEqual(winners(crowd(30, "t1", { class: "WARRIOR", level: 30 })));
  // Same time and level: the own row wins.
  expect(winners(pair("t2", { class: "MAGE", level: 30 }, { class: "WARRIOR", level: 30, kind: "census_self", realm: "Forever", via: undefined })))
    .toEqual(winners(crowd(30, "t2", { class: "WARRIOR", level: 30 })));
  // Same time, level and kind: install-b sorts before install-c, whatever the event ids say.
  expect(winners(pair("t3", { class: "MAGE", eventId: "census_seen:2026-11-15:00" }, { class: "WARRIOR", eventId: "census_seen:2026-11-15:999999" })))
    .toEqual(winners(crowd(30, "t3", { class: "MAGE" })));
});

test("the 7-day window is the last seven UTC days, today included; since launch is everything from launch on", () => {
  const recent = crowd(10, "cc", { capturedAt: "2026-11-10T00:00:00.000Z" }); // first instant of the window
  const older = crowd(10, "dd", { capturedAt: "2026-11-09T23:59:59.999Z" }); // one millisecond before it
  const view = census([...recent, ...older]);
  expect(view.windows.week).toMatchObject({ from: "2026-11-10T00:00:00.000Z", to: "2026-11-16T12:00:00.000Z", characters: 10 });
  expect(view.windows.launch).toMatchObject({ from: LAUNCH, to: "2026-11-16T12:00:00.000Z", characters: 20 });
});

test("rows from before launch (the beta) and rows dated after the corpus was current are not counted", () => {
  const beta = crowd(10, "ee", { capturedAt: "2026-10-20T12:00:00.000Z" });
  const future = crowd(10, "ff", { capturedAt: "2026-11-16T12:00:01.000Z" });
  const view = census([...beta, ...future, ...crowd(10, "f0")]);
  expect(view.windows.launch.characters).toBe(10);
  expect(view.windows.week.characters).toBe(10);
});

test("in launch week the window starts at launch, and the trend leaves out the days before it", () => {
  const view = census(crowd(10, "g0", { capturedAt: "2026-11-05T10:00:00.000Z" }), "2026-11-06T12:00:00Z");
  expect(view.launched).toBe(true);
  expect(view.windows.week.from).toBe(LAUNCH);
  expect(view.windows.week.characters).toBe(10);
  expect(view.trend.map((d) => d.day)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
  expect(view.trend.map((d) => d.count)).toEqual([null, 10, null]);
});

test("before launch the view says it has not launched: empty windows whose dates never run backwards, and no trend", () => {
  const view = census(crowd(30, "g1", { capturedAt: "2026-10-18T10:00:00.000Z" }), "2026-10-18T12:00:00Z");
  expect(view).toMatchObject({ launched: false, launch: LAUNCH, trend: [] });
  for (const w of [view.windows.week, view.windows.launch]) {
    expect(w).toMatchObject({ collecting: true, characters: null, installs: 0, from: "2026-10-18T12:00:00.000Z", to: "2026-10-18T12:00:00.000Z" });
    expect(Date.parse(w.from)).toBeLessThanOrEqual(Date.parse(w.to));
  }
  expect(census([]).launched).toBe(true);
});

test("level bands are 1-9, 10-19 ... 50-59, and at 60, both ends of each band included", () => {
  expect(LEVEL_BANDS.map((b) => b.id)).toEqual(["1-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60"]);
  const rows = everyone();
  const w = week(rows);
  const expected: Record<string, number> = { "1-9": 0, "10-19": 0, "20-29": 0, "30-39": 0, "40-49": 0, "50-59": 0, "60": 0 };
  for (const r of rows) expected[r.level === 60 ? "60" : r.level < 10 ? "1-9" : `${Math.floor(r.level / 10) * 10}-${Math.floor(r.level / 10) * 10 + 9}`]++;
  for (const [id, n] of Object.entries(expected)) expect(band(w, id), id).toBe(roundCount(n));
});

test("with every slice large, nothing is hidden and every count is its own true number, rounded", () => {
  const rows = everyone(23);
  const w = week(rows);
  expect(w.characters).toBe(roundCount(rows.length));
  for (const c of CENSUS_CLASSES) expect(klass(w, c.token)).toBe(roundCount(rows.filter((r) => r.class === c.token).length));
  const all = [...w.factions, ...w.races, ...w.classes, ...w.raceClass, ...w.levels].map((c) => c.count);
  expect(all.every((c) => c !== null && c % CENSUS_ROUND_TO === 0)).toBe(true);
  expect([10, 12, 13, 17, 18, 102].map(roundCount)).toEqual([10, 10, 15, 15, 20, 100]);
});

test("a cell shows at 10 characters, not at 9", () => {
  const base = everyone(20, "Alliance/Gnome/PRIEST");
  expect(cell(week([...base, ...crowd(10, "i1")]), "Gnome", "PRIEST")).toBe(10);
  expect(cell(week([...base, ...crowd(9, "i1")]), "Gnome", "PRIEST")).toBeNull();
});

test("a cell shows at 3 installs, not at 2, however many characters they report", () => {
  const base = everyone(20, "Alliance/Gnome/PRIEST");
  expect(cell(week([...base, ...crowd(40, "j1", {}, ["install-a", "install-b"])]), "Gnome", "PRIEST")).toBeNull();
  expect(cell(week([...base, ...crowd(40, "j1", {}, ["install-a", "install-b", "install-c"])]), "Gnome", "PRIEST")).toBe(40);
});

test("the installs behind a count are every install that reported one of its characters in the window", () => {
  // Ten characters from one install, and two of them also seen by two more installs: three installs in all.
  const rows = crowd(10, "k1", {}, ["install-a"]);
  rows.push(row({ installId: "install-b", characterKey: "k10003" }), row({ installId: "install-c", characterKey: "k10007" }));
  expect(week(rows).characters).toBe(10);
  expect(week(crowd(10, "k2", {}, ["install-a"])).characters).toBeNull();
});

test("below the thresholds the whole window is collecting: no number at all, only how many installs have reported", () => {
  const w = week(crowd(9, "l1"));
  expect(w.collecting).toBe(true);
  expect(w.characters).toBeNull();
  expect(w.installs).toBe(3);
  const counts = [...w.factions, ...w.races, ...w.classes, ...w.raceClass, ...w.levels].map((c) => c.count);
  expect(counts.every((c) => c === null)).toBe(true);
  expect(w.bias).toEqual({ own: null, seen: null });
  expect(census(crowd(9, "l1")).trend.every((d) => d.count === null)).toBe(true);
  expect(week(crowd(30, "l2", {}, ["install-a", "install-b"])).collecting).toBe(true);
});

test("every playable cell is listed whether or not anyone plays it, so a listed cell says nothing on its own", () => {
  const keys = (w: CensusWindow) => w.raceClass.map((c) => `${c.faction}/${c.race}/${c.class}`);
  const busy = week(everyone());
  expect(keys(week([]))).toEqual(keys(busy));
  expect(keys(busy)).toContain("Alliance/Gnome/PRIEST");
  expect(keys(busy)).toContain("Horde/Skyborne/SHAMAN");
  expect(keys(busy)).toContain("Alliance/Skyborne/MAGE");
  expect(keys(busy)).not.toContain("Horde/Orc/PALADIN");
  expect(busy.races).toHaveLength(10);
  expect(busy.classes).toHaveLength(9);
});

test("a row that is not a playable combination, or has an impossible level, is left out", () => {
  const w = week([
    ...crowd(10, "n1"),
    ...crowd(10, "n2", { race: "Orc", class: "PALADIN", faction: "Horde" }),
    ...crowd(10, "n3", { race: "Gnome", faction: "Horde" }),
    ...crowd(10, "n4", { level: 61 }),
    ...crowd(10, "n5", { race: "Dracthyr" }),
  ]);
  expect(w.characters).toBe(10);
});

test("two-part splits: when one faction is hidden, so is the other", () => {
  const alliance = everyone().filter((r) => r.faction === "Alliance");
  const w = week([...alliance, ...crowd(5, "p1", { race: "Orc", class: "WARRIOR", faction: "Horde" })]);
  expect(w.characters).not.toBeNull();
  expect(w.factions.map((f) => f.count)).toEqual([null, null]);
});

test("a total and one faction both show 10 only when the other faction is hidden too, so it can't be read as 0 to 2", () => {
  const w = week([
    ...crowd(10, "a1", { race: "Human", class: "WARRIOR", faction: "Alliance" }),
    ...crowd(2, "h1", { race: "Orc", class: "WARRIOR", faction: "Horde" }),
  ]);
  // 12 characters round to 10, and so do the 10 Alliance characters: shown alone the Horde would be 0 to 2.
  expect(w.characters).toBe(10);
  expect(w.factions.map((f) => f.count)).toEqual([null, null]);
});

test("two-part splits: when own characters are hidden, so are the seen ones", () => {
  const seenOnly = everyone().map((r) => ({ ...r, kind: "census_seen" as const, realm: undefined, via: "target" as const }));
  const w = week([...seenOnly, ...crowd(4, "p2", { kind: "census_self", realm: "Forever", via: undefined })]);
  expect(w.bias).toEqual({ own: null, seen: null });
  expect(week(everyone()).bias.own).not.toBeNull();
});

test("a lone hidden level band takes the smallest shown band with it", () => {
  const rows = [...crowd(40, "q1", { level: 15 }), ...crowd(30, "q2", { level: 25 }), ...crowd(20, "q3", { level: 35 }),
    ...crowd(50, "q4", { level: 45 }), ...crowd(60, "q5", { level: 55 }), ...crowd(70, "q6", { level: 5 }), ...crowd(4, "q7", { level: 60 })];
  const w = week(rows);
  expect(band(w, "60")).toBeNull();
  expect(band(w, "30-39")).toBeNull();
  expect(w.levels.filter((l) => l.count === null)).toHaveLength(2);
  expect(band(w, "20-29")).toBe(30);
});

test("a lone hidden cell in the race and class grid takes cells with it in its row and in its column", () => {
  const w = week([...everyone(20, "Alliance/Gnome/PRIEST"), ...crowd(4, "r1")]);
  expect(cell(w, "Gnome", "PRIEST")).toBeNull();
  const gnomeRow = w.raceClass.filter((c) => c.faction === "Alliance" && c.race === "Gnome");
  const priestColumn = w.raceClass.filter((c) => c.class === "PRIEST");
  expect(gnomeRow.filter((c) => c.count === null).length).toBeGreaterThanOrEqual(2);
  expect(priestColumn.filter((c) => c.count === null).length).toBeGreaterThanOrEqual(2);
});

test("no level cross is published: with them, one hidden level-1 Undead Priest could be bounded below 10 (PR #699 review)", () => {
  // Twelve groups of ten and one Undead Priest at level 1. Faction, race and class by level band, each
  // suppressed sum by sum, let the Undead and Warlock totals, the Undead Warlocks and their shown bands
  // bound the hidden Undead at 1-9 to at most 6. Until suppression checks constraints across tables, the
  // census publishes level bands on their own only.
  const groups: [Faction, string, string, number][] = [
    ["Horde", "Orc", "ROGUE", 40], ["Horde", "Tauren", "DRUID", 10], ["Horde", "Tauren", "WARRIOR", 60], ["Horde", "Troll", "MAGE", 50],
    ["Horde", "Scourge", "PALADIN", 40], ["Horde", "Scourge", "PRIEST", 50], ["Horde", "Scourge", "ROGUE", 60], ["Horde", "Scourge", "WARLOCK", 10],
    ["Horde", "Scourge", "WARLOCK", 30], ["Alliance", "Gnome", "WARLOCK", 20], ["Alliance", "NightElf", "DRUID", 30], ["Alliance", "NightElf", "ROGUE", 20],
  ];
  const rows = groups.flatMap(([faction, race, cls, level], k) => crowd(10, `p${k.toString(16)}`, { faction, race, class: cls, level }));
  rows.push(row({ installId: INSTALLS[0], characterKey: "p-hidden-one", faction: "Horde", race: "Scourge", class: "PRIEST", level: 1 }));
  const view = census(rows);
  for (const w of [view.windows.week, view.windows.launch]) {
    expect(Object.keys(w).sort()).toEqual(["bias", "characters", "classes", "collecting", "factions", "from", "id", "installs", "levels", "raceClass", "races", "to"]);
  }
  expect(JSON.stringify(view)).not.toMatch(/factionLevels|raceLevels|classLevels/);
  const w = view.windows.week;
  const shown = <T extends { count: CensusCount }>(cells: T[], key: (c: T) => string) =>
    Object.fromEntries(cells.filter((c) => c.count !== null).map((c) => [key(c), c.count]));
  expect({
    characters: w.characters, bias: w.bias,
    factions: shown(w.factions, (c) => c.faction),
    races: shown(w.races, (c) => `${c.faction}/${c.race}`),
    classes: shown(w.classes, (c) => c.class),
    raceClass: shown(w.raceClass, (c) => `${c.faction}/${c.race}/${c.class}`),
    levels: shown(w.levels, (c) => c.band),
  }).toEqual({
    // The tables as main publishes them: the Undead Priest cell and the two lowest bands stay hidden.
    characters: 120, bias: { own: null, seen: null },
    factions: { Alliance: 30, Horde: 90 },
    races: { "Alliance/NightElf": 20, "Horde/Scourge": 50, "Horde/Tauren": 20, "Horde/Troll": 10 },
    classes: { DRUID: 20, PALADIN: 10, PRIEST: 10, ROGUE: 30, WARLOCK: 30, WARRIOR: 10 },
    raceClass: { "Alliance/NightElf/ROGUE": 10, "Horde/Scourge/ROGUE": 10, "Horde/Scourge/WARLOCK": 20 },
    levels: { "20-29": 20, "30-39": 20, "40-49": 20, "50-59": 20, "60": 20 },
  });
});

/** Every published sum in a window: its margin (null for the total) and its parts. */
function relations(w: CensusWindow): { name: string; margin: CensusCount; parts: CensusCount[] }[] {
  const out = [
    { name: "factions", margin: w.characters, parts: w.factions.map((f) => f.count) },
    { name: "bias", margin: w.characters, parts: [w.bias.own, w.bias.seen] },
    { name: "classes", margin: w.characters, parts: w.classes.map((c) => c.count) },
    { name: "levels", margin: w.characters, parts: w.levels.map((l) => l.count) },
  ];
  for (const f of FACTIONS) {
    out.push({ name: `${f} races`, margin: w.factions.find((x) => x.faction === f)!.count, parts: w.races.filter((r) => r.faction === f).map((r) => r.count) });
  }
  for (const r of w.races) {
    out.push({ name: `${r.faction} ${r.race} row`, margin: r.count, parts: w.raceClass.filter((c) => c.faction === r.faction && c.race === r.race).map((c) => c.count) });
  }
  for (const c of w.classes) out.push({ name: `${c.class} column`, margin: c.count, parts: w.raceClass.filter((x) => x.class === c.class).map((x) => x.count) });
  return out;
}

/** A small deterministic generator, so a failure reproduces. */
function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/**
 * The bound this suppression guarantees, checked against what is published. Take any one sum. Grant
 * an attacker more than the page shows: the margin's true value is at most its shown value plus 2, and
 * each shown part's true value at least its shown value minus 2 (and at least 10). The hidden parts then
 * add up to at most `room`. With two or more hidden parts, any one of them could be anything from 0 to
 * `room` while the others make up the rest, so `room` of at least 10 means at least 11 possible values.
 */
test("from any one published sum, a hidden count could be any of at least 11 values (0 to 10)", () => {
  const half = Math.floor(CENSUS_ROUND_TO / 2);
  let checked = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const next = random(seed);
    const rows: CensusRow[] = [];
    COMBOS.forEach((c, k) => {
      // Many small cells and a few large ones; some combinations with nobody.
      const n = next() < 0.3 ? 0 : next() < 0.6 ? Math.floor(next() * 12) : Math.floor(next() * 40);
      const installs = next() < 0.15 ? ["install-a", "install-b"] : ["install-a", "install-b", "install-c", "install-d"];
      for (let i = 0; i < n; i++) {
        rows.push(row({
          installId: installs[i % installs.length], characterKey: `s${seed}x${k}x${i}`, faction: c.faction, race: c.race, class: c.class,
          level: 1 + Math.floor(next() * 60), ...(next() < 0.2 ? { kind: "census_self" as const, realm: "Forever", via: undefined } : {}),
        }));
      }
    });
    const view: CensusView = census(rows);
    for (const w of [view.windows.week, view.windows.launch]) {
      if (w.collecting) continue;
      for (const rel of relations(w)) {
        const hidden = rel.parts.filter((p) => p === null).length;
        if (hidden === 0) continue;
        expect(hidden, `seed ${seed} ${w.id} ${rel.name}`).toBeGreaterThanOrEqual(2);
        if (rel.margin === null) continue; // a hidden margin bounds nothing from this sum
        const shownLow = rel.parts.filter((p): p is number => p !== null).reduce((s, p) => s + Math.max(p - half, CENSUS_MIN_CHARACTERS), 0);
        const room = rel.margin + half - shownLow;
        expect(room, `seed ${seed} ${w.id} ${rel.name}`).toBeGreaterThanOrEqual(CENSUS_MIN_CHARACTERS);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(500);
});

test("the daily trend counts each character once a day and follows the same thresholds", () => {
  const rows = [
    ...crowd(12, "u1", { capturedAt: "2026-11-14T09:00:00.000Z" }),
    ...crowd(12, "u1", { capturedAt: "2026-11-14T21:00:00.000Z" }),
    ...crowd(4, "u2", { capturedAt: "2026-11-15T09:00:00.000Z" }),
  ];
  const { trend } = census(rows);
  expect(trend.map((d) => d.day)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
  expect(trend.find((d) => d.day === "2026-11-14")!.count).toBe(10);
  expect(trend.find((d) => d.day === "2026-11-15")!.count).toBeNull();
});

test("bias: own characters are those with an own upload, even when someone else saw them too", () => {
  const rows = everyone();
  rows.push(row({ installId: "install-d", characterKey: rows.find((r) => r.kind === "census_self")!.characterKey }));
  const own = new Set(rows.filter((r) => r.kind === "census_self").map((r) => r.characterKey)).size;
  const all = new Set(rows.map((r) => r.characterKey)).size;
  expect(week(rows).bias).toEqual({ own: roundCount(own), seen: roundCount(all - own) });
});

test("no character key, install id or event id reaches the output", () => {
  const rows = [...everyone(), ...crowd(25, "deadbeef"), row({ installId: "install-secret", characterKey: "cafef00d", kind: "census_self", realm: "Forever", via: undefined })];
  const json = JSON.stringify(census(rows));
  for (const r of rows) {
    expect(json).not.toContain(r.characterKey);
    expect(json).not.toContain(r.installId);
    expect(json).not.toContain(r.eventId!);
  }
  expect(json).not.toMatch(/"(characterKey|installId|eventId|serverId|realm|via|kind)"/);
});

test("one global view for now, labelled so a ruleset or region view can sit beside it", () => {
  const view = census(crowd(10, "v1"));
  expect(view.scope).toEqual({ id: "all", label: "All of WoW: Forever" });
  expect(view.rule).toEqual({ minCharacters: CENSUS_MIN_CHARACTERS, minInstalls: CENSUS_MIN_INSTALLS, minReporters: CENSUS_MIN_REPORTERS, roundTo: CENSUS_ROUND_TO });
  expect(rollupCensus(crowd(10, "v1"), { asOf: AS_OF, launch: LAUNCH, scope: { id: "pvp-us", label: "PvP, Americas" } }).scope.id).toBe("pvp-us");
});

test("a cell needs 3 distinct addresses as well as 3 installs: many install ids behind one address do not clear it", () => {
  const oneAddress = addr("home");
  const w = week(crowd(20, "r1", { reporter: oneAddress }, ["install-a", "install-b", "install-c", "install-d"]));
  expect(w.installs).toBe(4);
  expect(w.collecting).toBe(true);
  expect(w.characters).toBeNull();
  // The same crowd from three addresses shows.
  expect(week(crowd(20, "r2")).characters).toBe(20);
  expect(CENSUS_MIN_REPORTERS).toBe(3);
});

test("two addresses are not enough, three are; the addresses of a cell are those that reported any of its characters", () => {
  const two = [...crowd(10, "r3", { reporter: addr("x") }, ["install-a", "install-b"]), ...crowd(10, "r4", { reporter: addr("y") }, ["install-c"])];
  expect(week(two).characters).toBeNull();
  // A third address that saw only one of the characters is enough: it reported one of the cell's characters.
  const three = [...two, row({ installId: "install-d", characterKey: "r3" + "0000", reporter: addr("z") })];
  expect(week(three).characters).toBe(20);
});

test("a row without a reporter counts toward installs but not toward addresses", () => {
  const rows = crowd(20, "r5", { reporter: undefined });
  const w = week(rows);
  expect(w.installs).toBe(3);
  expect(w.characters).toBeNull();
  // Two addresses plus unaddressed rows still fall short of 3 addresses.
  expect(week([...crowd(10, "r6", { reporter: addr("p") }, ["install-a"]), ...crowd(10, "r7", { reporter: addr("q") }, ["install-b"]), ...crowd(10, "r8", { reporter: undefined }, ["install-c"])]).characters).toBeNull();
});

test("a cell with enough characters and installs but one address is hidden, and its totals still show", () => {
  const w = week([
    ...everyone(20, "Horde/Orc/HUNTER"),
    ...crowd(30, "q1", { race: "Orc", class: "HUNTER", faction: "Horde", reporter: addr("solo") }),
  ]);
  expect(w.characters).not.toBeNull();
  expect(cell(w, "Orc", "HUNTER", "Horde")).toBeNull();
  // A lone hidden cell takes another in its row with it, so it can't be worked out from the race total.
  expect(w.raceClass.filter((c) => c.race === "Orc" && c.count === null).length).toBeGreaterThanOrEqual(2);
});

test("the output carries no reporter", () => {
  expect(JSON.stringify(census(everyone()))).not.toMatch(/[0-9a-f]{16}/);
  expect(JSON.stringify(census(everyone()))).not.toContain("reporter");
});

test("rows from the store are rolled up as they are", () => {
  expect(censusFromRows(crowd(10, "w1"), AS_OF).windows.week.characters).toBe(10);
});
