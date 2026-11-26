/**
 * Compares the committed game data with a new build and says what changed, in the shape of a
 * changelog entry. Pure: no files, no network. Both sides are `SiteData`, the files the site reads.
 */
import { isDeepStrictEqual } from "node:util";
import type { WorldMapData } from "../world-map-data.js";
import { LABEL } from "../talents/catalog.js";
import { CHANGE_SCHEMA, ReadSet, type BuildRef, type ChangeEntry, type MapChanges, type RaidBuffChanges, type TalentChanges } from "./changes.js";
import { diffClientDigests, type ClientDigests } from "./client-digests.js";
import { siteBuild, type SiteData, type SpellValueTable, type TrimmedClass, type WebRaid } from "./site-data.js";

type Node = TrimmedClass["trees"][number]["nodes"][number];
interface Located { cls: TrimmedClass; tree: string | null; node: Node }

const nameOf = (n: Node) => n.entries.map((e) => e.name ?? `spell ${e.spellId}`).join(" / ") || `node ${n.id}`;

function locate(classes: TrimmedClass[]): Map<number, Located> {
  const out = new Map<number, Located>();
  for (const cls of classes) for (const t of cls.trees) for (const node of t.nodes) out.set(node.id, { cls, tree: t.name, node });
  return out;
}

const where = (l: Located, spoiler: boolean) => ({
  classId: l.cls.classId, className: l.cls.className, tree: l.tree, nodeId: l.node.id, name: nameOf(l.node), spoiler,
  spellIds: l.node.entries.map((e) => e.spellId),
});
const position = (l: Located) => ({ tree: l.tree, x: l.node.x, y: l.node.y, row: l.node.row, col: l.node.col });
const sortPrereqs = (p: Node["prereqs"]) => [...p].sort((a, b) => a.nodeId - b.nodeId || a.rule.localeCompare(b.rule));
const order = <T extends { classId: number; nodeId: number }>(a: T, b: T) => a.classId - b.classId || a.nodeId - b.nodeId;

export function diffTalents(before: TrimmedClass[], after: TrimmedClass[], spoiler: boolean): TalentChanges {
  const out: TalentChanges = {
    classesAdded: [], classesRemoved: [], added: [], removed: [], moved: [], ranks: [], gates: [], prereqs: [], replaced: [], spellValues: [], pointLevels: [],
  };
  const ref = (c: TrimmedClass) => ({ classId: c.classId, className: c.className, spoiler });
  const byId = (x: { classId: number }, y: { classId: number }) => x.classId - y.classId;
  const was = new Map(before.map((c) => [c.classId, c]));
  const now = new Map(after.map((c) => [c.classId, c]));
  out.classesAdded = [...now.values()].filter((c) => !was.has(c.classId)).map(ref).sort(byId);
  out.classesRemoved = [...was.values()].filter((c) => !now.has(c.classId)).map(ref).sort(byId);
  for (const c of after) {
    const old = was.get(c.classId);
    if (old && !isDeepStrictEqual(old.pointLevels, c.pointLevels)) {
      out.pointLevels.push({ classId: c.classId, className: c.className, before: old.pointLevels, after: c.pointLevels, spoiler });
    }
  }

  const a = locate(before);
  const b = locate(after);
  for (const [id, l] of b) {
    const old = a.get(id);
    if (!old) {
      out.added.push({ ...where(l, spoiler), kind: l.node.kind, maxRanks: l.node.maxRanks });
      continue;
    }
    const n = l.node;
    const o = old.node;
    if (o.x !== n.x || o.y !== n.y || old.tree !== l.tree) out.moved.push({ ...where(l, spoiler), from: position(old), to: position(l) });
    if (o.maxRanks !== n.maxRanks) out.ranks.push({ ...where(l, spoiler), before: o.maxRanks, after: n.maxRanks });
    if (!isDeepStrictEqual(o.unlock, n.unlock)) out.gates.push({ ...where(l, spoiler), before: o.unlock, after: n.unlock });
    if (!isDeepStrictEqual(sortPrereqs(o.prereqs), sortPrereqs(n.prereqs))) {
      out.prereqs.push({ ...where(l, spoiler), before: sortPrereqs(o.prereqs), after: sortPrereqs(n.prereqs) });
    }
    const oldSpells = o.entries.map((e) => e.spellId);
    const newSpells = n.entries.map((e) => e.spellId);
    if (!isDeepStrictEqual(oldSpells, newSpells)) out.replaced.push({ ...where(l, spoiler), before: oldSpells, after: newSpells });
  }
  for (const [id, l] of a) if (!b.has(id)) out.removed.push({ ...where(l, spoiler), maxRanks: l.node.maxRanks });
  for (const key of ["added", "removed", "moved", "ranks", "gates", "prereqs", "replaced"] as const) out[key].sort(order as never);
  return out;
}

type Change = TalentChanges["spellValues"][number]["changes"][number];

/**
 * Numbers of the spells talents show, between two builds. Only spells in both tables are compared (a spell
 * that came or went with its talent is already an added or removed talent). Each is placed at the node
 * that holds it in the new talent files.
 */
export function diffSpellValues(before: SpellValueTable, after: SpellValueTable, talents: TrimmedClass[], spoiler: boolean): TalentChanges["spellValues"] {
  const at = new Map<number, Located>();
  for (const l of locate(talents).values()) for (const e of l.node.entries) if (!at.has(e.spellId)) at.set(e.spellId, l);
  const out: TalentChanges["spellValues"] = [];
  for (const id of Object.keys(after.spells).sort((x, y) => Number(x) - Number(y))) {
    const o = before.spells[id], n = after.spells[id], l = at.get(Number(id));
    if (!o || !l) continue;
    const changes: Change[] = [];
    const check = (field: string, x: number | string | null | undefined, y: number | string | null | undefined) => {
      if ((x ?? null) !== (y ?? null)) changes.push({ field, before: x ?? null, after: y ?? null });
    };
    check("durationMs", o.durationMs, n.durationMs);
    check("text", o.textHash, n.textHash);
    const indexes = [...new Set([...o.effects, ...n.effects].map((x) => x.index))].sort((p, q) => p - q);
    for (const idx of indexes) {
      const x = o.effects.find((f) => f.index === idx);
      const y = n.effects.find((f) => f.index === idx);
      for (const f of ["basePoints", "dieSides", "periodMs", "chainTargets", "miscValue", "radiusYards"] as const) check(`effect ${idx + 1} ${f}`, x?.[f], y?.[f]);
    }
    if (changes.length) out.push({ ...where(l, spoiler), spellId: Number(id), spellName: n.name, changes });
  }
  return out.sort(order as never);
}

const ranksOf = (e: WebRaid["entries"][number] | undefined): string => (e?.byRank ?? []).map((r) => `${r.rank ?? "-"}:${r.scope}`).join(" ");

/** Scope per entry (and per rank where ranks differ), spell ids added or removed, and the talent tree an effect needs. */
export function diffRaid(before: WebRaid, after: WebRaid, spoiler: boolean): Pick<RaidBuffChanges, "scopeChanges" | "spellChanges"> {
  const a = new Map(before.entries.map((e) => [e.id, e]));
  const b = new Map(after.entries.map((e) => [e.id, e]));
  const scopeChanges: RaidBuffChanges["scopeChanges"] = [];
  const spellChanges: RaidBuffChanges["spellChanges"] = [];
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(id), y = b.get(id), label = (y ?? x)!.label;
    const [rx, ry] = [ranksOf(x), ranksOf(y)];
    if ((x?.scope ?? null) !== (y?.scope ?? null) || rx !== ry) {
      scopeChanges.push({ id, label, before: (x?.scope ?? null) as never, after: (y?.scope ?? null) as never, beforeRanks: rx, afterRanks: ry, spoiler });
    }
    if (!x || !y) continue;
    const add = (spellId: number | null, change: string) => spellChanges.push({ id, label, spellId, name: null, change, spoiler });
    for (const s of y.spellIds) if (!x.spellIds.includes(s)) add(s, "added");
    for (const s of x.spellIds) if (!y.spellIds.includes(s)) add(s, "removed");
    if (x.tree !== y.tree) add(null, `talent tree ${x.tree} -> ${y.tree}`);
  }
  return { scopeChanges, spellChanges };
}

const rect = (r: { left: number; top: number; right: number; bottom: number }) => `${r.left},${r.top},${r.right},${r.bottom}`;

/** Continents, zones and entrances that appeared, vanished or moved. */
export function diffMap(before: WorldMapData, after: WorldMapData, spoiler: boolean): MapChanges {
  const out: MapChanges = [];
  const compare = <T extends { name: string }>(kind: MapChanges[number]["kind"], x: T[], y: T[], id: (t: T) => number, moved: (p: T, q: T) => string | null) => {
    const was = new Map(x.map((t) => [id(t), t])), now = new Map(y.map((t) => [id(t), t]));
    for (const [k, t] of now) {
      const o = was.get(k);
      if (!o) out.push({ kind, id: k, name: t.name, change: "added", spoiler });
      else {
        const m = moved(o, t);
        if (m) out.push({ kind, id: k, name: t.name, change: m, spoiler });
      }
    }
    for (const [k, t] of was) if (!now.has(k)) out.push({ kind, id: k, name: t.name, change: "removed", spoiler });
  };
  const bounds = (p: { bounds: Parameters<typeof rect>[0] }, q: { bounds: Parameters<typeof rect>[0] }) => (rect(p.bounds) === rect(q.bounds) ? null : `bounds ${rect(p.bounds)} -> ${rect(q.bounds)}`);
  compare("continent", before.continents, after.continents, (t) => t.id, bounds);
  compare("zone", before.zones, after.zones, (t) => t.uiMapId, bounds);
  compare("entrance", before.entrances, after.entrances, (t) => t.mapId, (p, q) =>
    p.worldX === q.worldX && p.worldY === q.worldY && p.continentId === q.continentId ? null : `position ${p.continentId}:${p.worldX},${p.worldY} -> ${q.continentId}:${q.worldX},${q.worldY}`);
  return out;
}

export interface DiffInput {
  product: string;
  live: boolean;
  detectedAt: string;
  /** What is committed now; null for the first entry. */
  before: SiteData | null;
  /** The newly generated files. */
  after: SiteData;
  /** Digests committed with the current data; null when the file is absent (entries before the read set). */
  beforeDigests?: ClientDigests | null;
  afterDigests?: ClientDigests | null;
  /** Tables the extractor asked for and did not read, with the reason; an absence is a warning, not a removal. */
  missingTables?: { table: string; reason: string }[];
  encryptedTables: { table: string; blocks: number }[];
  source: { definitions: string | null; library: string; extractedAt: string };
  warnings: string[];
}

export function buildChangeEntry(input: DiffInput): ChangeEntry {
  const spoiler = !input.live;
  const { before, after } = input;
  const ref = (b: { version: string; buildId: number; buildConfig: string }): BuildRef => ({ version: b.version, buildId: b.buildId, buildConfig: b.buildConfig });
  const build = siteBuild(after);
  const blocks = input.encryptedTables.filter((t) => t.blocks > 0).sort((x, y) => x.table.localeCompare(y.table));
  const warnings = [...input.warnings];
  if (before && siteBuild(before).definitions !== build.definitions) {
    warnings.push(`table definitions differ (WoWDBDefs ${siteBuild(before).definitions ?? "unknown"} vs ${build.definitions ?? "unknown"}): a change may come from the layouts, not the game`);
  }
  const talents = before ? diffTalents(before.talents, after.talents, spoiler) : null;
  if (talents && before?.spellValues && after.spellValues) talents.spellValues = diffSpellValues(before.spellValues, after.spellValues, after.talents, spoiler);
  else if (before && !before.spellValues) warnings.push("no committed spell values to compare with, so spell number changes are not listed");

  let readSet: ReadSet | null = null;
  if (before && input.beforeDigests && input.afterDigests) {
    const diff = diffClientDigests(input.beforeDigests, input.afterDigests, input.missingTables ?? []);
    readSet = diff.readSet;
    warnings.push(...diff.warnings);
  } else if (before && !input.beforeDigests) {
    warnings.push("no committed client digests to compare with, so client table changes are not listed");
  }
  return {
    schema: CHANGE_SCHEMA,
    label: LABEL,
    id: `${input.product}-${build.buildId}`,
    product: input.product,
    live: input.live,
    spoiler,
    detectedAt: input.detectedAt,
    build: ref(build),
    previous: before ? ref(siteBuild(before)) : null,
    initial: !before,
    encryptedBlocks: { total: blocks.reduce((n, t) => n + t.blocks, 0), tables: blocks },
    source: input.source,
    catalog: { classes: after.talents.length, nodes: after.talents.reduce((n, c) => n + c.trees.reduce((m, t) => m + t.nodes.length, 0), 0) },
    talents,
    raidBuffs: after.raid ? {
      comparedTo: before?.raid?.build ?? null,
      ...(before?.raid ? diffRaid(before.raid, after.raid, spoiler) : { scopeChanges: [], spellChanges: [] }),
    } : null,
    mapChanges: before?.map && after.map ? diffMap(before.map, after.map, spoiler) : null,
    readSet,
    warnings,
  };
}
