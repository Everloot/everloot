// Raid builder logic: slots, coverage math and the share code. No React, no browser calls,
// so the tests run it as plain functions. The rules come from a BuffTable (data/raid-buffs.ts).
import { CLASSES } from "@/design/tokens";
import type { BuffEntry, BuffTable, Family } from "@/data/game-data/raid";

export const SIZES = [10, 20, 40] as const;
export type Size = (typeof SIZES)[number];
export const GROUP_SIZE = 5;

export type ClassName = (typeof CLASSES)[number];

/** Tree names for a class, in the client's order, from the build's game file extract. Tree 0 in a slot means "any". */
export const treeNames = (table: BuffTable, c: ClassName): string[] => table.trees[c] ?? [];

export interface Slot {
  class: ClassName;
  /** 0 = any tree. */
  tree: 0 | 1 | 2 | 3;
}
export type Slots = (Slot | null)[];

export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function emptySlots(size: Size): Slots {
  return Array.from({ length: size }, () => null);
}

/** Keep the first `size` slots and pad with empty ones. */
export function resize(slots: Slots, size: Size): Slots {
  return [...slots.slice(0, size), ...emptySlots(size).slice(slots.length)];
}

export function groupsOf(slots: Slots): Slots[] {
  const groups: Slots[] = [];
  for (let i = 0; i < slots.length; i += GROUP_SIZE) groups.push(slots.slice(i, i + GROUP_SIZE));
  return groups;
}

const inSlots = (slots: Slots, i: number) => Number.isInteger(i) && i >= 0 && i < slots.length;

/**
 * Swap two slots, or move a member into an empty one. Out-of-range indexes, the same index and two
 * empty slots return the array unchanged (same reference), so callers can skip the history entry.
 */
export function swapSlots(slots: Slots, from: number, to: number): Slots {
  if (!inSlots(slots, from) || !inSlots(slots, to) || from === to) return slots;
  if (!slots[from] && !slots[to]) return slots;
  const next = [...slots];
  next[from] = slots[to];
  next[to] = slots[from];
  return next;
}

/**
 * Put a class in a slot, replacing whoever is there. The same class keeps its tree; another class starts
 * on any tree. Returns the array unchanged (same reference) when nothing changes.
 */
export function placeClass(slots: Slots, index: number, c: ClassName): Slots {
  if (!inSlots(slots, index) || slots[index]?.class === c) return slots;
  const next = [...slots];
  next[index] = { class: c, tree: 0 };
  return next;
}

/** Empty a slot. Returns the array unchanged (same reference) when it is already empty or out of range. */
export function removeSlot(slots: Slots, index: number): Slots {
  if (!inSlots(slots, index) || !slots[index]) return slots;
  const next = [...slots];
  next[index] = null;
  return next;
}

/** What is being dragged: a class from the palette, or the member in a slot. */
export type DragSource = { kind: "class"; class: ClassName } | { kind: "slot"; index: number };
/** Where it lands: a slot, or the trash (anywhere off the groups). */
export type DropTarget = { kind: "slot"; index: number } | { kind: "trash" };

/**
 * One drop, as a pure step: a class on a slot fills or replaces it, a member on another slot moves or
 * swaps, a member on the trash leaves the raid. A class on the trash, or a drop that changes nothing,
 * returns the array unchanged (same reference), so callers can skip the history entry.
 */
export function applyDrop(slots: Slots, source: DragSource, target: DropTarget): Slots {
  if (source.kind === "class") return target.kind === "slot" ? placeClass(slots, target.index, source.class) : slots;
  return target.kind === "slot" ? swapSlots(slots, source.index, target.index) : removeSlot(slots, source.index);
}

/* ---------- Roles ---------- */

export type Role = "tank" | "healer" | "damage" | "unknown";

// Per class, the role of each talent tree in the client's order (trees 1-3). A class with one entry
// has the same role in every tree, so "any tree" is not a guess for it.
const TREE_ROLES: Record<ClassName, Role[]> = {
  warrior: ["damage", "damage", "tank"],
  paladin: ["healer", "tank", "damage"],
  hunter: ["damage"],
  rogue: ["damage"],
  priest: ["healer", "healer", "damage"],
  shaman: ["damage", "damage", "healer"],
  mage: ["damage"],
  warlock: ["damage"],
  // Feral tanks or deals damage depending on the gear and the fight, so the tree does not settle it.
  druid: ["damage", "unknown", "healer"],
};

/** The role a slot fills, from its class and tree. Tree 0 ("any") is unknown unless the class has one role. */
export function roleOf(slot: Slot): Role {
  const roles = TREE_ROLES[slot.class];
  if (roles.length === 1) return roles[0];
  return slot.tree === 0 ? "unknown" : roles[slot.tree - 1] ?? "unknown";
}

/**
 * A talent tree's role (tree index 0 to 2, in the client's order) for a label beside its name: null when every tree of
 * the class has the same role, which the label would only repeat, or when the tree does not settle it (Feral).
 */
export function treeRole(cls: ClassName, index: number): Exclude<Role, "unknown"> | null {
  const roles = TREE_ROLES[cls];
  const role = roles.length > 1 ? roles[index] : undefined;
  return !role || role === "unknown" ? null : role;
}

export interface Roster {
  filled: number;
  classes: Record<ClassName, number>;
  roles: Record<Role, number>;
}

export function roster(slots: Slots): Roster {
  const classes = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<ClassName, number>;
  const roles: Record<Role, number> = { tank: 0, healer: 0, damage: 0, unknown: 0 };
  let filled = 0;
  for (const s of slots) {
    if (!s) continue;
    filled++;
    classes[s.class]++;
    roles[roleOf(s)]++;
  }
  return { filled, classes, roles };
}

/** A raid in one line for a page title or a link preview: "20-player raid", "2 tanks, 5 healers, 10 damage". */
export function describeRaid(size: Size, slots: Slots): { title: string; roles: string; filled: number } {
  const r = roster(slots);
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const roles = [n(r.roles.tank, "tank"), n(r.roles.healer, "healer"), `${r.roles.damage} damage`, ...(r.roles.unknown ? [`${r.roles.unknown} not known`] : [])].join(", ");
  return { title: `${size}-player raid`, roles, filled: r.filled };
}

/* ---------- Coverage ---------- */

/**
 * covered: the scope reaches this group and a picked class brings it.
 * cast: a picked class brings it, but it is cast on one player at a time (or a group of nearby players).
 * unknown: someone brings it, but how far it reaches is not known for this build.
 * missing: no picked class brings it.
 */
export type State = "covered" | "cast" | "possible" | "unknown" | "missing";

const RANK: Record<State, number> = { covered: 4, cast: 3, possible: 2, unknown: 1, missing: 0 };
const best = (a: State, b: State): State => (RANK[a] >= RANK[b] ? a : b);

type Provides = "yes" | "maybe" | "unsure" | "no";

/** Whether a slot brings an effect: its class must match, and so must its tree when a talent gives it. */
function provides(slot: Slot | null, entry: BuffEntry): Provides {
  if (!slot || slot.class !== entry.class) return "no";
  if (entry.tree === "baseline") return "yes";
  if (entry.tree === "unknown") return "unsure";
  if (slot.tree === entry.tree) return "yes";
  return slot.tree === 0 ? "maybe" : "no";
}

function bestProvides(slots: Slots, entry: BuffEntry): Provides {
  let result: Provides = "no";
  for (const s of slots) {
    const p = provides(s, entry);
    if (p === "yes") return "yes";
    if (p === "maybe" || (p === "unsure" && result === "no")) result = p;
  }
  return result;
}

/** How one entry stands for a set of slots it could reach. `group` is the slots of one group. */
function entryState(entry: BuffEntry, everyone: Slots, group: Slots): State {
  // Who can bring it: a party effect needs a provider in the group, anything else needs one in the raid.
  const p = bestProvides(entry.scope === "party" ? group : everyone, entry);
  if (p === "no") return "missing";
  if (p === "maybe") return "possible";
  if (p === "unsure") return "unknown";
  switch (entry.scope) {
    case "raid":
    case "party":
    case "enemy":
      return "covered";
    case "single":
    case "area":
      return "cast";
    default:
      return "unknown";
  }
}

export interface FamilyCoverage {
  family: Family;
  /** One state per group, in group order. Debuffs are raid-wide, so every group shows the same. */
  groups: State[];
  /** The raid as a whole: covered only when every group is covered, otherwise the weakest group. */
  raid: State;
  /** The entries behind the best state, for the label and the build's evidence. */
  entries: BuffEntry[];
}

export interface Coverage {
  buffs: FamilyCoverage[];
  debuffs: FamilyCoverage[];
  /** Counts for the headline, over buffs. */
  summary: Record<State, number>;
}

const entriesIn = (table: BuffTable, family: string) => table.entries.filter((e) => e.family === family && e.scope !== "self");

export function coverage(slots: Slots, table: BuffTable): Coverage {
  const groups = groupsOf(slots);
  const compute = (family: Family): FamilyCoverage => {
    const entries = entriesIn(table, family.id);
    const perGroup = groups.map((group) =>
      entries.reduce<State>((state, e) => best(state, entryState(e, slots, group)), "missing"),
    );
    const raid = perGroup.reduce<State>((weakest, s) => (RANK[s] < RANK[weakest] ? s : weakest), perGroup[0] ?? "missing");
    return { family, groups: perGroup, raid, entries };
  };
  const all = table.families.filter((f) => entriesIn(table, f.id).length > 0).map(compute);
  const buffs = all.filter((f) => f.family.kind === "buff");
  const summary: Record<State, number> = { covered: 0, cast: 0, possible: 0, unknown: 0, missing: 0 };
  for (const b of buffs) summary[b.raid]++;
  return { buffs, debuffs: all.filter((f) => f.family.kind === "debuff"), summary };
}

/**
 * The class that would help most with what the raid is missing: each class is tried (any tree) in the first empty slot
 * of each group with room, and scores the missing buffs and debuffs it would bring to at least one more group. Every
 * class on the best score is named, in class order; none when nothing is missing or there is no room.
 */
export function suggestNext(slots: Slots, table: BuffTable): { classes: ClassName[]; count: number } {
  const missingGroups = (c: Coverage) => new Map([...c.buffs, ...c.debuffs].filter((f) => f.raid === "missing").map((f) => [f.family.id, f.groups.filter((s) => s === "missing").length]));
  const now = missingGroups(coverage(slots, table));
  const rooms = groupsOf(slots).flatMap((group, g) => {
    const i = group.indexOf(null);
    return i < 0 ? [] : [g * GROUP_SIZE + i];
  });
  let classes: ClassName[] = [];
  let count = 0;
  if (now.size === 0) return { classes, count };
  for (const cls of CLASSES) {
    const score = Math.max(0, ...rooms.map((room) => {
      const next = [...slots];
      next[room] = { class: cls, tree: 0 };
      const after = coverage(next, table);
      return [...after.buffs, ...after.debuffs].filter((f) => now.has(f.family.id) && f.groups.filter((s) => s === "missing").length < now.get(f.family.id)!).length;
    }));
    if (score > count) { classes = [cls]; count = score; } else if (score > 0 && score === count) classes.push(cls);
  }
  return { classes, count };
}

export const STATE_LABEL: Record<State, string> = {
  covered: "Yes",
  cast: "By cast",
  possible: "If talented",
  unknown: "Unknown reach",
  missing: "Missing",
};

/* ---------- Share code ---------- */

/**
 * ELR1-<size>-<build>-<payload>
 *   size     10, 20 or 40
 *   build    game build the rules were read for, e.g. 1.60.1.70450
 *   payload  base64url, no padding, of two digits per slot: class (1-9) then tree (0-3); "00" is empty.
 *            Trailing empty slots are left out.
 * Class numbers follow CLASSES (tokens.ts): warrior 1, paladin 2, hunter 3, rogue 4, priest 5, shaman 6,
 * mage 7, warlock 8, druid 9. Changing that order, or the digits, needs ELR2.
 * It is separate from the talent code (EL1-...), so each reader refuses the other's codes.
 */
export const SHARE_VERSION = 1;
const PREFIX = `ELR${SHARE_VERSION}`;

export interface RaidCode {
  size: Size;
  build: string;
  slots: Slots;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encode64(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i), b = text.charCodeAt(i + 1), c = text.charCodeAt(i + 2);
    const n = a * 65536 + (b || 0) * 256 + (c || 0);
    const chars = [(n >> 18) & 63, (n >> 12) & 63, (n >> 6) & 63, n & 63];
    const keep = i + 2 < text.length ? 4 : i + 1 < text.length ? 3 : 2;
    for (let k = 0; k < keep; k++) out += B64[chars[k]];
  }
  return out;
}

function decode64(text: string): string | null {
  if (text.length % 4 === 1) return null;
  let out = "";
  for (let i = 0; i < text.length; i += 4) {
    let n = 0, count = 0;
    for (let k = i; k < Math.min(i + 4, text.length); k++) {
      const v = B64.indexOf(text[k]);
      if (v < 0) return null;
      n = n * 64 + v;
      count++;
    }
    for (let k = count; k < 4; k++) n *= 64;
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let k = 0; k < count - 1; k++) out += String.fromCharCode(bytes[k]);
  }
  return out;
}

const BUILD_SHAPE = /^\d+\.[\d.]*\d$/;
export const validBuild = (build: string) => BUILD_SHAPE.test(build) && !build.includes("..");

export function encodeRaid({ size, build, slots }: RaidCode): string {
  let text = slots
    .slice(0, size)
    .map((s) => (s ? `${CLASSES.indexOf(s.class) + 1}${s.tree}` : "00"))
    .join("");
  text = text.replace(/(?:00)+$/, "");
  return `${PREFIX}-${size}-${build}-${encode64(text)}`;
}

/** Pull a raid code out of pasted text: a bare code, or a link that carries one in its fragment. */
export function findCode(text: string): string {
  return /ELR\d+-\d+-[\d.]+-[\w-]*/.exec(text)?.[0] ?? text.trim();
}

export type Decoded = { ok: true; value: RaidCode } | { ok: false; error: string };

export function decodeRaid(input: string): Decoded {
  const code = input.trim().replace(/=+$/, "");
  const m = /^ELR(\d+)-(\d+)-([\d.]+)-([\w-]*)$/.exec(code);
  if (!m) return { ok: false, error: "That is not an Everloot raid code (ELR1-size-build-slots)." };
  if (Number(m[1]) !== SHARE_VERSION) {
    return { ok: false, error: `Raid code version ${m[1]} is newer than this page reads (version ${SHARE_VERSION}).` };
  }
  const size = Number(m[2]);
  if (!(SIZES as readonly number[]).includes(size)) return { ok: false, error: "The raid size in the code is not 10, 20 or 40." };
  if (!validBuild(m[3])) return { ok: false, error: "The build in the code is damaged." };
  const text = decode64(m[4]);
  if (text === null || text.length % 2 !== 0 || text.length > size * 2 || !/^\d*$/.test(text)) {
    return { ok: false, error: "The slots in the code are damaged." };
  }
  const slots = emptySlots(size as Size);
  for (let i = 0; i < text.length / 2; i++) {
    const c = Number(text[i * 2]);
    const t = Number(text[i * 2 + 1]);
    if (c === 0 && t === 0) continue;
    if (c < 1 || c > CLASSES.length || t > 3) return { ok: false, error: "The slots in the code are damaged." };
    slots[i] = { class: CLASSES[c - 1], tree: t as Slot["tree"] };
  }
  return { ok: true, value: { size: size as Size, build: m[3], slots } };
}
