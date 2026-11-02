/**
 * The census rollup: who plays what on WoW: Forever, from the census_self and census_seen rows of
 * installs that turned the census on (docs/design/specs/2026-10-18-census-design.md, §5 and §6).
 *
 * - One character, one count: the latest row per characterKey, across both kinds and every install.
 * - Two windows: the last 7 UTC days, today included (the headline), and since launch. Rows from
 *   before launch (the beta) and rows dated after the corpus was current are not counted. Before
 *   launch the view says so (`launched: false`) and both windows are empty.
 * - A count shows only when it covers at least 10 characters reported by at least 3 installs and from at
 *   least 3 distinct addresses (`reporter`, the keyed hash of the sender's address that intake stamps). A row
 *   without a reporter counts toward installs but not toward addresses, so many install ids from one address
 *   still don't clear it.
 * - Complementary suppression: in every published sum (total = factions = classes = level bands =
 *   own + seen; faction = its races; race = its row of the race × class grid; class = its column), a
 *   relation with anything hidden has at least two hidden parts whose true counts add up to at least
 *   10. Where it would not, the smallest shown part is hidden too, until it does. So, from any one sum,
 *   a hidden part could be anything from 0 to at least 10.
 * - Every count that shows is rounded to the nearest 5, each from its own true number, so a total is
 *   not the sum of its rounded parts either.
 * - A hidden count is null: the page and the MCP tool read it as "not enough reports" (fewer than 10 characters,
 *   fewer than 3 installs or addresses, or hidden so a small count can't be worked out).
 * - The output carries counts only: no characterKey, install id, event id, server id or realm.
 *
 * One global view for now. Step 4 of the spec maps realms to ruleset and region; it will group the
 * rows first and call rollupCensus once per group with that group's scope.
 */

export const CENSUS_MIN_CHARACTERS = 10;
export const CENSUS_MIN_INSTALLS = 3;
/** Distinct keyed address hashes (`reporter`) a count needs, besides the installs. */
export const CENSUS_MIN_REPORTERS = 3;
export const CENSUS_ROUND_TO = 5;
/** Days in the headline window, today (UTC) included. */
export const CENSUS_WEEK_DAYS = 7;
/** Launch, 3:00 p.m. PST on November 4, 2026. web/src/data/wow-forever.ts LAUNCH_AT says the same; a web test keeps them equal. */
export const CENSUS_LAUNCH = "2026-11-04T23:00:00.000Z";

export type Faction = "Alliance" | "Horde";

/**
 * A stored census row, as intake writes it after swapping the GUID for characterKey (spec §4, §5.1).
 * Local until the census intake change lands in @everloot/protocol; then this becomes that type.
 */
export interface CensusRow {
  kind: "census_self" | "census_seen";
  installId: string;
  /** Intake writes `<kind>:<day>:<characterKey prefix>`; the rollup does not read it. */
  eventId?: string;
  capturedAt: string;
  /** HMAC of the GUID under a server key, hex. The GUID itself is never stored. */
  characterKey: string;
  serverId: number;
  /** Keyed hash of the sender's address (16 hex), set by intake. Rows without one count toward installs only. */
  reporter?: string;
  /** UnitRace's file token, such as "Scourge" or "NightElf". */
  race: string;
  /** UnitClass's file token, such as "HUNTER". */
  class: string;
  level: number;
  faction: Faction;
  /** census_self only: GetRealmName(). */
  realm?: string;
  /** census_seen only: how the player was seen. */
  via?: "target" | "mouseover" | "group";
}

export const CENSUS_CLASSES = [
  { token: "DRUID", name: "Druid" }, { token: "HUNTER", name: "Hunter" }, { token: "MAGE", name: "Mage" },
  { token: "PALADIN", name: "Paladin" }, { token: "PRIEST", name: "Priest" }, { token: "ROGUE", name: "Rogue" },
  { token: "SHAMAN", name: "Shaman" }, { token: "WARLOCK", name: "Warlock" }, { token: "WARRIOR", name: "Warrior" },
] as const;

/**
 * Who can play what, by race token, from Blizzard's race and class tables (the same tables as
 * web/src/data/wow-forever.ts RACES; a web test keeps them equal). Skyborne is on both factions with a
 * different class list on each. "Skyborne" as UnitRace's token is unconfirmed until a beta login checks it.
 */
export const CENSUS_RACES = [
  { faction: "Horde", token: "Orc", name: "Orc", classes: ["HUNTER", "MAGE", "ROGUE", "SHAMAN", "WARLOCK", "WARRIOR"] },
  { faction: "Horde", token: "Tauren", name: "Tauren", classes: ["DRUID", "HUNTER", "SHAMAN", "WARRIOR"] },
  { faction: "Horde", token: "Troll", name: "Troll", classes: ["HUNTER", "MAGE", "PRIEST", "ROGUE", "SHAMAN", "WARLOCK", "WARRIOR"] },
  { faction: "Horde", token: "Scourge", name: "Undead", classes: ["MAGE", "PALADIN", "PRIEST", "ROGUE", "WARLOCK", "WARRIOR"] },
  { faction: "Horde", token: "Skyborne", name: "Skyborne", classes: ["DRUID", "HUNTER", "ROGUE", "SHAMAN", "WARRIOR"] },
  { faction: "Alliance", token: "Dwarf", name: "Dwarf", classes: ["HUNTER", "PALADIN", "PRIEST", "ROGUE", "SHAMAN", "WARRIOR"] },
  { faction: "Alliance", token: "Gnome", name: "Gnome", classes: ["MAGE", "PRIEST", "ROGUE", "WARLOCK", "WARRIOR"] },
  { faction: "Alliance", token: "Human", name: "Human", classes: ["HUNTER", "MAGE", "PALADIN", "PRIEST", "ROGUE", "WARLOCK", "WARRIOR"] },
  { faction: "Alliance", token: "NightElf", name: "Night Elf", classes: ["DRUID", "HUNTER", "PRIEST", "ROGUE", "WARRIOR"] },
  { faction: "Alliance", token: "Skyborne", name: "Skyborne", classes: ["DRUID", "HUNTER", "MAGE", "ROGUE", "WARRIOR"] },
] as const satisfies readonly { faction: Faction; token: string; name: string; classes: readonly string[] }[];

export const FACTIONS: readonly Faction[] = ["Alliance", "Horde"];

export const LEVEL_BANDS = [
  { id: "1-9", min: 1, max: 9, label: "1–9" },
  { id: "10-19", min: 10, max: 19, label: "10–19" },
  { id: "20-29", min: 20, max: 29, label: "20–29" },
  { id: "30-39", min: 30, max: 39, label: "30–39" },
  { id: "40-49", min: 40, max: 49, label: "40–49" },
  { id: "50-59", min: 50, max: 59, label: "50–59" },
  { id: "60", min: 60, max: 60, label: "At 60" },
] as const;

export type LevelBand = (typeof LEVEL_BANDS)[number]["id"];

/** A published count: rounded to the nearest 5, or null when it is hidden. */
export type CensusCount = number | null;

/** What a hidden count means, in the words the page, /methodology and the MCP tool use. */
export const HIDDEN_LABEL = "not enough reports";
export const HIDDEN_MEANING = "fewer than 10 characters, fewer than 3 installs or fewer than 3 addresses, or hidden so that a small count can't be worked out from the others";

export interface CensusWindow {
  id: "week" | "launch";
  /** First instant counted, ISO. Before launch, the same as `to`: the window is empty. */
  from: string;
  /** When the corpus was current, ISO. */
  to: string;
  /** True while the window as a whole is under the thresholds (or before launch): then nothing in it shows a number. */
  collecting: boolean;
  characters: CensusCount;
  /** Distinct installs that reported a census row in the window. A count of installs, not characters. */
  installs: number;
  /** Characters with an own upload in the window, and characters known only from being seen. */
  bias: { own: CensusCount; seen: CensusCount };
  factions: { faction: Faction; count: CensusCount }[];
  races: { faction: Faction; race: string; count: CensusCount }[];
  classes: { class: string; count: CensusCount }[];
  raceClass: { faction: Faction; race: string; class: string; count: CensusCount }[];
  levels: { band: LevelBand; count: CensusCount }[];
}

export interface CensusView {
  scope: { id: string; label: string };
  asOf: string;
  /** When counting starts, ISO. */
  launch: string;
  /** False before launch: nothing is counted yet, which is not the same as collecting. */
  launched: boolean;
  rule: { minCharacters: number; minInstalls: number; minReporters: number; roundTo: number };
  windows: { week: CensusWindow; launch: CensusWindow };
  /**
   * Characters active each UTC day of the 7-day window, oldest first, under the same thresholds. Days
   * that end before launch are left out, so launch week has fewer than seven, and before launch none.
   */
  trend: { day: string; count: CensusCount }[];
}

export const GLOBAL_SCOPE = { id: "all", label: "All of WoW: Forever" };

const DAY_MS = 86_400_000;

export function roundCount(n: number): number {
  return Math.round(n / CENSUS_ROUND_TO) * CENSUS_ROUND_TO;
}

/** Whether a count clears the thresholds on its own. */
function clears(characters: number, installs: number, reporters: number): boolean {
  return characters >= CENSUS_MIN_CHARACTERS && installs >= CENSUS_MIN_INSTALLS && reporters >= CENSUS_MIN_REPORTERS;
}

const RACE_BY_FACTION = new Map<string, (typeof CENSUS_RACES)[number]>(CENSUS_RACES.map((r) => [`${r.faction}/${r.token}`, r]));

/** A race and class Blizzard's tables allow for that faction, at a level the game has. */
function playable(row: CensusRow): boolean {
  const race = RACE_BY_FACTION.get(`${row.faction}/${row.race}`);
  return !!race && (race.classes as readonly string[]).includes(row.class) &&
    Number.isInteger(row.level) && row.level >= 1 && row.level <= 60;
}

function bandOf(level: number): LevelBand {
  return LEVEL_BANDS.find((b) => level >= b.min && level <= b.max)!.id;
}

type Dated = { row: CensusRow; at: number };

/**
 * True when `a` is the report to keep for its character: the later capture, then the higher level, then
 * an own row over a sighting, then the lexically smaller install id. The event id is not read: intake
 * writes it as `<kind>:<day>:<characterKey prefix>`, which carries no order.
 */
function keeps(a: Dated, b: Dated): boolean {
  if (a.at !== b.at) return a.at > b.at;
  if (a.row.level !== b.row.level) return a.row.level > b.row.level;
  const own = Number(a.row.kind === "census_self") - Number(b.row.kind === "census_self");
  if (own !== 0) return own > 0;
  return a.row.installId < b.row.installId;
}

type Character = { latest: Dated; installs: Set<string>; reporters: Set<string>; own: boolean };

/** One published cell before rounding: its characters, the installs that reported any of them, and whether it is hidden. */
class Cell {
  characters = 0;
  installs = new Set<string>();
  reporters = new Set<string>();
  hidden = false;
  add(c: Character) {
    this.characters++;
    for (const id of c.installs) this.installs.add(id);
    for (const id of c.reporters) this.reporters.add(id);
  }
}

function cells<K extends string>(keys: readonly K[]): Map<K, Cell> {
  return new Map(keys.map((k) => [k, new Cell()]));
}

/** A published sum: the margin (null for the window total, which is never hidden while counting) and its parts. */
type Relation = { margin: Cell | null; parts: Cell[] };

/**
 * Hide cells under the thresholds, then keep hiding the smallest shown part of any relation whose hidden
 * parts are fewer than two or add up to fewer than 10 characters, until no relation needs it.
 */
function suppress(all: Cell[], relations: Relation[]): void {
  for (const c of all) c.hidden = !clears(c.characters, c.installs.size, c.reporters.size);
  for (let changed = true; changed;) {
    changed = false;
    for (const { margin, parts } of relations) {
      const hidden = parts.filter((p) => p.hidden);
      if (hidden.length === 0 && !margin?.hidden) continue;
      if (hidden.length >= 2 && hidden.reduce((s, p) => s + p.characters, 0) >= CENSUS_MIN_CHARACTERS) continue;
      let smallest: Cell | null = null;
      for (const p of parts) if (!p.hidden && (!smallest || p.characters < smallest.characters)) smallest = p;
      if (!smallest) continue;
      smallest.hidden = true;
      changed = true;
    }
  }
}

function windowOf(id: CensusWindow["id"], rows: readonly Dated[], from: number, to: number): CensusWindow {
  const characters = new Map<string, Character>();
  const installs = new Set<string>();
  const reporters = new Set<string>();
  for (const d of rows) {
    if (d.at < from || d.at > to) continue;
    installs.add(d.row.installId);
    if (d.row.reporter) reporters.add(d.row.reporter);
    const c = characters.get(d.row.characterKey);
    if (!c) {
      characters.set(d.row.characterKey, { latest: d, installs: new Set([d.row.installId]), reporters: new Set(d.row.reporter ? [d.row.reporter] : []), own: d.row.kind === "census_self" });
      continue;
    }
    c.installs.add(d.row.installId);
    if (d.row.reporter) c.reporters.add(d.row.reporter);
    if (d.row.kind === "census_self") c.own = true;
    if (keeps(d, c.latest)) c.latest = d;
  }

  const total = new Cell();
  const own = new Cell();
  const seen = new Cell();
  const factions = cells(FACTIONS);
  const races = cells(CENSUS_RACES.map((r) => `${r.faction}/${r.token}`));
  const classes = cells<string>(CENSUS_CLASSES.map((c) => c.token));
  const grid = cells(CENSUS_RACES.flatMap((r) => r.classes.map((c) => `${r.faction}/${r.token}/${c}`)));
  const levels = cells(LEVEL_BANDS.map((b) => b.id));
  for (const c of characters.values()) {
    const r = c.latest.row;
    total.add(c);
    (c.own ? own : seen).add(c);
    factions.get(r.faction)!.add(c);
    races.get(`${r.faction}/${r.race}`)!.add(c);
    classes.get(r.class)!.add(c);
    grid.get(`${r.faction}/${r.race}/${r.class}`)!.add(c);
    levels.get(bandOf(r.level))!.add(c);
  }

  const collecting = !clears(total.characters, total.installs.size, total.reporters.size);
  const relations: Relation[] = [
    { margin: null, parts: [...factions.values()] },
    { margin: null, parts: [own, seen] },
    { margin: null, parts: [...classes.values()] },
    { margin: null, parts: [...levels.values()] },
    ...FACTIONS.map((f) => ({ margin: factions.get(f)!, parts: CENSUS_RACES.filter((r) => r.faction === f).map((r) => races.get(`${f}/${r.token}`)!) })),
    ...CENSUS_RACES.map((r) => ({ margin: races.get(`${r.faction}/${r.token}`)!, parts: r.classes.map((c) => grid.get(`${r.faction}/${r.token}/${c}`)!) })),
    ...CENSUS_CLASSES.map((c) => ({
      margin: classes.get(c.token)!,
      parts: CENSUS_RACES.filter((r) => (r.classes as readonly string[]).includes(c.token)).map((r) => grid.get(`${r.faction}/${r.token}/${c.token}`)!),
    })),
  ];
  suppress([own, seen, ...factions.values(), ...races.values(), ...classes.values(), ...grid.values(), ...levels.values()], relations);

  const shown = (c: Cell): CensusCount => (collecting || c.hidden ? null : roundCount(c.characters));
  return {
    id,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    collecting,
    characters: collecting ? null : roundCount(total.characters),
    installs: installs.size,
    bias: { own: shown(own), seen: shown(seen) },
    factions: FACTIONS.map((faction) => ({ faction, count: shown(factions.get(faction)!) })),
    races: CENSUS_RACES.map((r) => ({ faction: r.faction, race: r.token, count: shown(races.get(`${r.faction}/${r.token}`)!) })),
    classes: CENSUS_CLASSES.map((c) => ({ class: c.token, count: shown(classes.get(c.token)!) })),
    raceClass: CENSUS_RACES.flatMap((r) => r.classes.map((cls) => ({
      faction: r.faction, race: r.token, class: cls, count: shown(grid.get(`${r.faction}/${r.token}/${cls}`)!),
    }))),
    levels: LEVEL_BANDS.map((b) => ({ band: b.id, count: shown(levels.get(b.id)!) })),
  };
}

/** Characters active on each UTC day of the week window that ends after launch, each day under the same thresholds. */
function trendOf(rows: readonly Dated[], firstDay: number, from: number, to: number, launch: number): CensusView["trend"] {
  const days = Array.from({ length: CENSUS_WEEK_DAYS }, (_, i) => ({ start: firstDay + i * DAY_MS, characters: new Set<string>(), installs: new Set<string>(), reporters: new Set<string>() }))
    .filter((d) => d.start + DAY_MS > launch && d.start <= to);
  for (const d of rows) {
    if (d.at < from || d.at > to) continue;
    const day = days.find((x) => d.at >= x.start && d.at < x.start + DAY_MS);
    if (!day) continue;
    day.characters.add(d.row.characterKey);
    day.installs.add(d.row.installId);
    if (d.row.reporter) day.reporters.add(d.row.reporter);
  }
  return days.map((d) => ({
    day: new Date(d.start).toISOString().slice(0, 10),
    count: clears(d.characters.size, d.installs.size, d.reporters.size) ? roundCount(d.characters.size) : null,
  }));
}

export interface CensusOptions {
  /** When the corpus was current; rows dated after it are ignored. */
  asOf: string | Date;
  /** Rows before this are the beta and are ignored. */
  launch?: string;
  scope?: { id: string; label: string };
}

export function rollupCensus(rows: readonly CensusRow[], options: CensusOptions): CensusView {
  const to = new Date(options.asOf).getTime();
  const launch = Date.parse(options.launch ?? CENSUS_LAUNCH);
  const launched = to >= launch;
  const dated: Dated[] = [];
  for (const row of rows) {
    const at = Date.parse(row.capturedAt);
    if (Number.isFinite(at) && at >= launch && at <= to && playable(row)) dated.push({ row, at });
  }
  const today = Math.floor(to / DAY_MS) * DAY_MS;
  const firstDay = today - (CENSUS_WEEK_DAYS - 1) * DAY_MS;
  // Before launch both windows are empty, from and to both the corpus time, never a range that runs backwards.
  const weekFrom = launched ? Math.max(firstDay, launch) : to;
  const launchFrom = launched ? launch : to;
  return {
    scope: options.scope ?? GLOBAL_SCOPE,
    asOf: new Date(to).toISOString(),
    launch: new Date(launch).toISOString(),
    launched,
    rule: { minCharacters: CENSUS_MIN_CHARACTERS, minInstalls: CENSUS_MIN_INSTALLS, minReporters: CENSUS_MIN_REPORTERS, roundTo: CENSUS_ROUND_TO },
    windows: { week: windowOf("week", dated, weekFrom, to), launch: windowOf("launch", dated, launchFrom, to) },
    trend: launched ? trendOf(dated, firstDay, weekFrom, to, launch) : [],
  };
}

/** The published census from stored census rows (what uploadStore.loadCensus reads). `asOf` is when the data was current. */
export function censusFromRows(rows: readonly CensusRow[], asOf: string | Date = new Date(), launch: string = CENSUS_LAUNCH): CensusView {
  return rollupCensus(rows, { asOf, launch });
}
