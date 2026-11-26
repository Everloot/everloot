/**
 * One entity's changes across builds, read from the build watch's change entries (changes.ts): the rows a database
 * page shows in its Changes section. The entries already hold id-level rows for what the pages read (spell values by
 * spell id, talent nodes with the spells they hold, map zones by map id), so this only picks and words them.
 *
 * Spoilers stay out: an entry from a build players cannot play yet, and any item marked as a spoiler, gives no row.
 * The pages have no spoiler switch of their own, so this is the default the /changes timeline shows. Tooltip text is
 * compared by hash in the entries and is only ever said to have changed.
 */
import type { ChangeEntry } from "./changes.js";

export type EntityRef = { kind: "spell"; id: number } | { kind: "zone"; id: number };

/** A row: `label` alone is the whole sentence; with `before`/`after` it names the field that went from one to the other. */
export interface EntityChangeRow { label: string; before: string | null; after: string | null }
/** One build's rows; `id` is the entry id (`<product>-<buildId>`), `build` its version. */
export interface EntityBuildChanges { id: string; build: string; rows: EntityChangeRow[] }

const said = (label: string): EntityChangeRow => ({ label, before: null, after: null });
const num = (v: number) => String(Math.round(v * 100) / 100);
const seconds = (v: number | string | null) => (v === null ? "none" : typeof v === "number" ? `${num(v / 1000)} s` : v);
const plain = (v: number | string | null) => (v === null ? "none" : typeof v === "number" ? num(v) : v);

const EFFECT_FIELDS: Record<string, [string, (v: number | string | null) => string]> = {
  basePoints: ["base points", plain], dieSides: ["die sides", plain], periodMs: ["period", seconds],
  chainTargets: ["chain targets", plain], miscValue: ["misc value", plain], radiusYards: ["radius (yards)", plain],
};

/** A spell value change in words: "Effect 2 base points", "Duration"; the tooltip only as changed. */
function valueRow(c: { field: string; before: number | string | null; after: number | string | null }): EntityChangeRow {
  if (c.field === "text") return said("Tooltip text changed");
  if (c.field === "durationMs") return { label: "Duration", before: seconds(c.before), after: seconds(c.after) };
  const m = /^effect (\d+) (\w+)$/.exec(c.field);
  const f = m ? EFFECT_FIELDS[m[2]!] : undefined;
  if (m && f) return { label: `Effect ${m[1]} ${f[0]}`, before: f[1](c.before), after: f[1](c.after) };
  return { label: c.field, before: plain(c.before), after: plain(c.after) };
}

const at = (p: { tree: string | null; row: number; col: number }) => `${p.tree ? `${p.tree}, ` : ""}row ${p.row + 1}, column ${p.col + 1}`;
const gate = (u: { spentRequired?: { amount: number } }) => (u.spentRequired ? `${u.spentRequired.amount} points` : "none");
const spells = (ids: number[]) => ids.map((id) => `spell ${id}`).join(", ") || "none";

function spellRows(e: ChangeEntry, id: number): EntityChangeRow[] {
  const rows: EntityChangeRow[] = [];
  const t = e.talents;
  if (t) {
    const holds = (x: { spellIds?: number[]; spoiler: boolean }) => !x.spoiler && (x.spellIds?.includes(id) ?? false);
    for (const x of t.added) if (holds(x)) rows.push(said("Talent added"));
    for (const x of t.removed) if (holds(x)) rows.push(said("Talent removed"));
    for (const x of t.moved) if (holds(x)) rows.push({ label: "Talent position", before: at(x.from), after: at(x.to) });
    for (const x of t.ranks) if (holds(x)) rows.push({ label: "Talent ranks", before: String(x.before), after: String(x.after) });
    for (const x of t.gates) if (holds(x)) {
      const [b, a] = [gate(x.before), gate(x.after)];
      rows.push(b === a ? said("Talents needed first changed") : { label: "Points spent first", before: b, after: a });
    }
    for (const x of t.prereqs) if (holds(x)) rows.push(said("Talents needed first changed"));
    // A swap names the spell on both sides, so it shows on the page of either.
    for (const x of t.replaced) if (!x.spoiler && (x.before.includes(id) || x.after.includes(id))) rows.push({ label: "Talent spell", before: spells(x.before), after: spells(x.after) });
    for (const x of t.spellValues) if (!x.spoiler && x.spellId === id) rows.push(...x.changes.map(valueRow));
  }
  for (const x of e.raidBuffs?.spellChanges ?? []) if (!x.spoiler && x.spellId === id) rows.push(said(`Raid buff ${x.label}: ${x.change}`));
  return rows;
}

function zoneRows(e: ChangeEntry, id: number): EntityChangeRow[] {
  return (e.mapChanges ?? []).filter((x) => x.kind === "zone" && x.id === id && !x.spoiler).map((x) => {
    if (x.change === "added") return said("Zone added to the map");
    if (x.change === "removed") return said("Zone removed from the map");
    const m = /^bounds (\S+) -> (\S+)$/.exec(x.change);
    return m ? { label: "Map bounds", before: m[1]!, after: m[2]! } : said(x.change);
  });
}

/** The entity's changes, newest build first; empty when it never changed in a build players can play. */
export function entityChanges(entries: readonly ChangeEntry[], ref: EntityRef): EntityBuildChanges[] {
  return entries
    .filter((e) => e.live && !e.spoiler)
    .map((e) => ({ id: e.id, build: e.build.version, buildId: e.build.buildId, rows: ref.kind === "spell" ? spellRows(e, ref.id) : zoneRows(e, ref.id) }))
    .filter((b) => b.rows.length)
    .sort((a, b) => b.buildId - a.buildId)
    .map(({ id, build, rows }) => ({ id, build, rows }));
}
