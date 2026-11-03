import { describe, expect, test } from "vitest";
import {
  CENSUS_CLASSES, CENSUS_LAUNCH, CENSUS_RACES, FACTIONS, LEVEL_BANDS, rollupCensus, type CensusCount, type CensusRow, type CensusWindow,
} from "../../../kb/src/census";
import { activeDims, censusHref, filterCensus, parseCensusFilter, type CensusFilter } from "./census-filter";

const AS_OF = "2026-11-16T12:00:00Z";
const COMBOS = CENSUS_RACES.flatMap((r) => r.classes.map((c) => ({ faction: r.faction, race: r.token, class: c })));

/** A small deterministic generator, so a failure reproduces. */
function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** Many small cells and a few large ones, at random levels, from four installs on four addresses. */
function corpus(seed: number): CensusRow[] {
  const next = random(seed);
  const rows: CensusRow[] = [];
  COMBOS.forEach((c, k) => {
    const n = next() < 0.3 ? 0 : next() < 0.6 ? Math.floor(next() * 12) : Math.floor(next() * 40);
    for (let i = 0; i < n; i++) {
      const install = `install-${"abcd"[i % 4]}`;
      rows.push({
        kind: "census_seen", installId: install, reporter: install.padStart(16, "0"), capturedAt: "2026-11-15T10:00:00.000Z",
        characterKey: `s${seed}x${k}x${i}`, serverId: 4, faction: c.faction, race: c.race, class: c.class, level: 1 + Math.floor(next() * 60), via: "target",
      });
    }
  });
  return rows;
}

const weekOf = (rows: CensusRow[]) => rollupCensus(rows, { asOf: AS_OF, launch: CENSUS_LAUNCH }).windows.week;

/** Every filter the menus can make: each dimension unset or set to each of its values. */
function everyFilter(): CensusFilter[] {
  const out: CensusFilter[] = [];
  for (const faction of [undefined, ...FACTIONS]) {
    for (const race of [undefined, ...new Set(CENSUS_RACES.map((r) => r.token))]) {
      for (const cls of [undefined, ...CENSUS_CLASSES.map((c) => c.token)]) {
        for (const level of [undefined, ...LEVEL_BANDS.map((b) => b.id)]) out.push({ faction, race, class: cls, level });
      }
    }
  }
  return out.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as CensusFilter);
}

/** The published cells of a window, looked up by what they count, independently of the filter code. */
function published(w: CensusWindow): Map<string, CensusCount> {
  const key = (f: CensusFilter) => [f.faction ?? "", f.race ?? "", f.class ?? "", f.level ?? ""].join("|");
  const m = new Map<string, CensusCount>();
  m.set(key({}), w.characters);
  for (const c of w.factions) m.set(key({ faction: c.faction }), c.count);
  for (const c of w.races) m.set(key({ faction: c.faction, race: c.race }), c.count);
  for (const c of w.classes) m.set(key({ class: c.class }), c.count);
  for (const c of w.raceClass) m.set(key({ faction: c.faction, race: c.race, class: c.class }), c.count);
  for (const c of w.levels) m.set(key({ level: c.band }), c.count);
  return m;
}
const keyOf = (f: CensusFilter) => [f.faction ?? "", f.race ?? "", f.class ?? "", f.level ?? ""].join("|");
/** The filter a census link carries. */
const filterOf = (href: string) => parseCensusFilter(Object.fromEntries(new URL(href, "https://x.test").searchParams));
/** A race cell is keyed with its faction, which a filter may leave out: the one side that has such a cell. */
function cellKey(f: CensusFilter, cells: Map<string, CensusCount>): string {
  if (!f.race || f.faction) return keyOf(f);
  const sides = FACTIONS.map((faction) => keyOf({ ...f, faction })).filter((k) => cells.has(k));
  expect(sides, JSON.stringify(f)).toHaveLength(1);
  return sides[0];
}

describe("the URL", () => {
  test("race takes the name or the token; class, faction and level their own values; anything else is ignored", () => {
    expect(parseCensusFilter({ race: "troll" })).toEqual({ race: "Troll" });
    expect(parseCensusFilter({ race: "undead" })).toEqual({ race: "Scourge" });
    expect(parseCensusFilter({ race: "Scourge" })).toEqual({ race: "Scourge" });
    expect(parseCensusFilter({ race: "night-elf" })).toEqual({ race: "NightElf" });
    expect(parseCensusFilter({ class: "mage", faction: "Horde", level: "60" })).toEqual({ class: "MAGE", faction: "Horde", level: "60" });
    expect(parseCensusFilter({ race: "dracthyr", class: "evoker", faction: "neutral", level: "61", window: "launch" })).toEqual({});
  });

  test("ruleset is accepted as forever only, and narrows nothing until realms are mapped to rulesets", () => {
    expect(parseCensusFilter({ ruleset: "forever" })).toEqual({ ruleset: "forever" });
    expect(parseCensusFilter({ ruleset: "hardcore" })).toEqual({});
    expect(activeDims({ ruleset: "forever" })).toEqual([]);
  });

  test("a census link is written in one order and reads back as the same filter", () => {
    const f: CensusFilter = { faction: "Horde", race: "Scourge", class: "MAGE", level: "10-19", ruleset: "forever" };
    expect(censusHref(f)).toBe("/census?faction=horde&race=undead&class=mage&level=10-19&ruleset=forever");
    expect(censusHref(f, "launch")).toContain("&window=launch");
    expect(filterOf(censusHref(f))).toEqual(f);
    expect(censusHref({})).toBe("/census");
  });
});

describe("what a filter shows", () => {
  const w = weekOf(corpus(7));

  test("a race shows its own count and its classes from the grid, not its level bands", () => {
    const v = filterCensus(w, { race: "Troll" });
    expect(v.label).toBe("Troll");
    expect(v.headline).toEqual({ count: w.races.find((r) => r.race === "Troll")!.count });
    expect(v.breakdowns.map((b) => b.by)).toEqual(["class"]);
    expect(v.breakdowns[0].rows.map((r) => r.label)).toEqual(["Hunter", "Mage", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"]);
    expect(v.breakdowns[0].rows[0].href).toBe("/census?race=troll&class=hunter");
  });

  test("a level band shows its own count and no split: level is not crossed with faction, race or class", () => {
    const v = filterCensus(w, { level: "60" }, "launch");
    expect(v.headline).toEqual({ count: w.levels.find((l) => l.band === "60")!.count });
    expect(v.breakdowns).toEqual([]);
    expect(v.note).toBeNull();
  });

  test("Skyborne without a side shows the two sides apart, never one total", () => {
    const v = filterCensus(w, { race: "Skyborne" });
    expect(v.headline).toBeNull();
    expect(v.note).toBe("both-sides");
    expect(v.breakdowns).toHaveLength(1);
    expect(v.breakdowns[0].rows.map((r) => r.href)).toEqual(["/census?faction=horde&race=skyborne", "/census?faction=alliance&race=skyborne"]);
  });

  test("a faction's class has no published total: its races are listed, not added up", () => {
    const v = filterCensus(w, { faction: "Horde", class: "MAGE" });
    expect(v.headline).toBeNull();
    expect(v.note).toBe("no-total");
    expect(v.breakdowns.map((b) => b.by)).toEqual(["race"]);
    expect(v.breakdowns[0].rows.map((r) => r.label)).toEqual(["Orc", "Troll", "Undead"]);
  });

  test("a level band with any other filter is too fine to publish; an impossible combination says so", () => {
    for (const f of [
      { race: "Troll", class: "PRIEST", level: "60" }, { faction: "Horde", level: "60" }, { race: "Troll", level: "60" }, { class: "MAGE", level: "1-9" },
    ] as CensusFilter[]) {
      expect(filterCensus(w, f), JSON.stringify(f)).toMatchObject({ headline: null, breakdowns: [], note: "too-fine" });
    }
    expect(filterCensus(w, { race: "Troll", class: "PALADIN" })).toMatchObject({ headline: null, breakdowns: [], note: "impossible" });
    expect(filterCensus(w, { race: "Troll", faction: "Alliance" })).toMatchObject({ headline: null, breakdowns: [], note: "impossible" });
  });
});

describe("filters reveal nothing the census hides", () => {
  test("every number under every filter is the published cell for exactly what its row says it counts", () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = weekOf(corpus(seed));
      if (w.collecting) continue;
      const cells = published(w);
      for (const f of everyFilter()) {
        const v = filterCensus(w, f);
        if (v.headline) {
          expect(v.headline.count, JSON.stringify(f)).toBe(cells.get(cellKey(f, cells)));
          checked++;
        }
        for (const b of v.breakdowns) {
          for (const r of b.rows) {
            expect(r.count, `${JSON.stringify(f)} ${r.href}`).toBe(cells.get(cellKey(filterOf(r.href), cells)));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  test("no filtered split has a lone hidden part, and a hidden filter count is never the sum of shown parts", () => {
    let hiddenSplits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = weekOf(corpus(seed));
      if (w.collecting) continue;
      for (const f of everyFilter()) {
        const v = filterCensus(w, f);
        if (!v.headline) continue;
        for (const b of v.breakdowns) {
          const hidden = b.rows.filter((r) => r.count === null).length;
          const at = `seed ${seed} ${JSON.stringify(f)} by ${b.by}`;
          if (hidden > 0) hiddenSplits++;
          expect(hidden, at).not.toBe(1);
          if (v.headline.count === null) expect(hidden, at).toBeGreaterThanOrEqual(2);
        }
      }
    }
    expect(hiddenSplits).toBeGreaterThan(100);
  });

  test("no filter shows a number for a level band crossed with anything", () => {
    const w = weekOf(corpus(3));
    for (const f of everyFilter()) {
      const v = filterCensus(w, f);
      if (f.level && activeDims(f).length > 1) expect(v.headline, JSON.stringify(f)).toBeNull();
      for (const b of v.breakdowns) {
        for (const r of b.rows) {
          const g = filterOf(r.href);
          expect(Boolean(g.level) && activeDims(g).length > 1, `${JSON.stringify(f)} ${r.href}`).toBe(false);
        }
      }
    }
  });
});
