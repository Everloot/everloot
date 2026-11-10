import { itemFactsFromRecords, recheckLootRecords, lootWindowsFromRecords, rollupDrops } from "../../../kb/src/drop-rollup";
import { agreedItemNames } from "../../../kb/src/item-page";
import { agreedObjectNames } from "../../../kb/src/object-spawns";
import { agreedNpcNames, agreedQuestTitles, npcPage, questPage, questScope, worldFactsFromRecords, zonesFor } from "../../../kb/src/world-pages";
import { recheckRows } from "../../../kb/src/fact-states";
import { scopeSince } from "../../../kb/src/recheck-scopes";
import { confirmedEntrances, instanceBosses, instanceFactsFromRecords } from "../../../kb/src/instances";
import { RECHECK_SCOPES } from "./recheck-scopes";
import type { Corpus } from "./upload-store";

export interface PublicFact {
  kind: "item" | "npc" | "quest" | "object" | "boss" | "entrance";
  id: number;
  name: string;
  path: string;
  installs: number;
  publicAt: string;
  /** Historical corpus rows have capture times, not the time the server first published them. */
  estimated?: boolean;
}
// Bump whenever publication gates widen or a new entity kind is added.
export const DATABASE_ACTIVITY_CODE_VERSION = 1;
export interface DatabaseActivity {
  codeVersion?: number;
  everPublic?: string[];
  version: 1;
  generatedAt: string;
  dataAsOf: string | null;
  entries: PublicFact[];
  /** Current public entity ids, used to date a late upload's crossing at publication rather than capture time. */
  publicKeys: string[];
}
export const recentFacts = (entries: PublicFact[], now = new Date()) => entries.filter((e) => Date.parse(e.publicAt) >= +now - 30 * 86400_000 && Date.parse(e.publicAt) <= +now).slice(0, 500);
type Candidate = Omit<PublicFact, "publicAt" | "estimated">;
const key = (e: Candidate) => `${e.kind}:${e.id}`;

function byId<T>(rows: T[], id: (row: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const key = id(row), group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}
/** Uses the same public gates as the entity pages. Named/player records never enter the groups below. */
function candidates(records: Corpus["records"], now: Date): Candidate[] {
  const out: Candidate[] = [];
  const items = itemFactsFromRecords(records, RECHECK_SCOPES);
  const itemNames = agreedItemNames(items);
  const itemInstalls = new Map<number, Set<string>>();
  for (const r of items.names) if (r.name === itemNames.get(r.itemId)) {
    const installs = itemInstalls.get(r.itemId) ?? new Set<string>();
    installs.add(r.installId);
    itemInstalls.set(r.itemId, installs);
  }
  for (const [id, name] of itemNames) out.push({ kind: "item", id, name, path: `/database/items/${id}`, installs: itemInstalls.get(id)!.size });
  const world = { ...worldFactsFromRecords(records), recheck: RECHECK_SCOPES };
  const names = agreedNpcNames(world);
  for (const [id, rows] of byId(world.npcs, (r) => r.npcId)) {
    const pins = npcPage(id, { ...world, npcs: rows }).pins;
    if (pins.length) out.push({ kind: "npc", id, name: names.get(id) ?? `NPC #${id}`, path: `/database/npcs/${id}`, installs: Math.max(...pins.map((p) => p.reporters)) });
  }
  const questNames = agreedQuestTitles(world), zones = zonesFor(world.npcs);
  for (const [id, rows] of byId(world.quests, (r) => r.questId)) {
    const giver = questPage(id, { ...world, quests: rows }, zones).giverNpcId;
    const since = scopeSince(RECHECK_SCOPES, questScope(id, rows, zones));
    if (giver !== null) out.push({ kind: "quest", id, name: questNames.get(id) ?? `Quest #${id}`, path: `/database/quests/${id}`, installs: new Set(recheckRows(rows, since).rows.filter((r) => r.giverNpcId === giver).map((r) => r.installId)).size });
  }
  const drops = rollupDrops(lootWindowsFromRecords(recheckLootRecords(records, RECHECK_SCOPES)));
  const objectNames = agreedObjectNames(items.objects);
  for (const r of drops.rates.filter((r) => r.public)) {
    const id = r.sourceNpcId ?? r.sourceObjectId!;
    const kind = r.sourceNpcId ? "npc" : "object";
    out.push({ kind, id, name: (kind === "npc" ? names : objectNames).get(id) ?? `${kind === "npc" ? "NPC" : "Object"} #${id}`, path: `/database/${kind === "npc" ? "npcs" : "objects"}/${id}`, installs: r.reporters });
    out.push({ kind: "item", id: r.itemId, name: itemNames.get(r.itemId) ?? `Item #${r.itemId}`, path: `/database/items/${r.itemId}`, installs: r.reporters });
  }
  for (const r of drops.measuredZeros.filter((r) => r.public)) {
    const id = r.sourceNpcId ?? r.sourceObjectId!;
    const kind = r.sourceNpcId ? "npc" : "object";
    out.push({ kind, id, name: (kind === "npc" ? names : objectNames).get(id) ?? `${kind === "npc" ? "NPC" : "Object"} #${id}`, path: `/database/${kind === "npc" ? "npcs" : "objects"}/${id}`, installs: r.reporters });
  }
  const instances = instanceFactsFromRecords(records);
  for (const e of confirmedEntrances(instances.entrances, now, RECHECK_SCOPES)) out.push({ kind: "entrance", id: e.instanceMapId, name: e.name ?? `Instance #${e.instanceMapId}`, path: `/database/instances/${e.instanceMapId}`, installs: e.reporters });
  for (const [instance, bosses] of instanceBosses(instances.encounters, now, RECHECK_SCOPES, instances.entrances)) {
    for (const b of bosses) out.push({ kind: "boss", id: b.encounterId, name: b.name ?? `Encounter #${b.encounterId}`, path: `/database/instances/${instance}`, installs: b.reporters });
  }
  return out;
}

/**
 * Small independent groups keep historical threshold checks off the full corpus. Each group is evaluated at most
 * once per capture day in the window, plus the older baseline. Rechecks use the entity pages' own functions.
 * On backfill the third-report capture day is an estimate; subsequent crossings use this snapshot's time.
 */
export function buildDatabaseActivity(corpus: Corpus, now = new Date(), previous?: DatabaseActivity | null): DatabaseActivity {
  if (corpus.unreachable) throw new Error("corpus unreachable");
  const current = new Map<string, Candidate>();
  // The whole corpus is authoritative for labels and zone-scoped rechecks. Groups only date those public entities.
  for (const e of candidates(corpus.records, now)) {
    const old = current.get(key(e));
    current.set(key(e), old ? { ...old, installs: Math.max(old.installs, e.installs) } : e);
  }
  // The inventory dates actual publication, including old captures arriving in a new upload. It also means ongoing
  // runs never replay history. Facts that aged out or fell beyond the 500-row limit are not announced again.
  if (current.size > 100_000) throw new Error("database activity inventory exceeds 100000 entities");
  const publicKeys = [...current.keys()].sort();
  const everPublic = [...new Set([...(previous?.everPublic ?? previous?.publicKeys ?? []), ...publicKeys])].sort();
  if (everPublic.length > 100_000) throw new Error("database activity inventory exceeds 100000 entities");
  const inventory = { codeVersion: DATABASE_ACTIVITY_CODE_VERSION, everPublic, publicKeys };
  if (previous) {
    // A gate change establishes a new baseline rather than announcing existing facts as new.
    const known = new Set(previous.codeVersion === DATABASE_ACTIVITY_CODE_VERSION ? previous.everPublic ?? previous.publicKeys : everPublic);
    const old = new Map(previous.entries.map((e) => [key(e), e]));
    const entries = [...current].flatMap(([id, e]): PublicFact[] => {
      const saved = old.get(id);
      if (saved) return [{ ...e, publicAt: saved.publicAt, ...(saved.estimated ? { estimated: true } : {}) }];
      return known.has(id) ? [] : [{ ...e, publicAt: now.toISOString() }];
    });
    entries.sort((a, b) => b.publicAt.localeCompare(a.publicAt) || key(a).localeCompare(key(b)));
    return { version: 1, generatedAt: now.toISOString(), dataAsOf: corpus.dataAsOf ?? null, ...inventory, entries: recentFacts(entries, now) };
  }
  const groups = new Map<string, Corpus["records"]>();
  const add = (id: string, r: Corpus["records"][number]) => { const rows = groups.get(id) ?? []; rows.push(r); groups.set(id, rows); };
  for (const r of corpus.records) {
    if (r.kind === "item_seen") add(`item:${r.itemId}`, r);
    if (r.kind === "npc_sighting") add(`npc:${r.npcId}`, r);
    if (r.kind === "quest") add(`quest:${r.questId}`, r);
    if (r.kind === "loot") add(`loot:${r.sourceNpcId ? `npc:${r.sourceNpcId}` : `object:${r.sourceObjectId}`}`, r);
    if (r.kind === "instance_entrance" || r.kind === "encounter") add(`instance:${r.instanceMapId}`, r);
  }
  // These subsets lack other groups' zone context (for example a quest giver's sightings).
  // Their capture-day crossings are estimates only; the full corpus above decides publication.
  const dates = new Map<string, string>();
  const cutoff = +now - 30 * 86400_000;
  for (const rows of groups.values()) {
    const timed = rows.map((r) => ({ r, t: Date.parse(r.capturedAt) })).filter(({ t }) => Number.isFinite(t) && t <= +now).sort((a, b) => a.t - b.t);
    const days = new Set([cutoff, ...timed.filter(({ t }) => t >= cutoff).map(({ t }) => Math.min(+now, Date.parse(new Date(t).toISOString().slice(0, 10)) + 86400_000 - 1))]);
    for (const day of days) {
      for (const e of candidates(timed.filter(({ t }) => t <= day).map(({ r }) => r), now)) {
        // Find the first capture day on which this public entity existed. Baseline entries are already old.
        const at = day === cutoff ? cutoff - 1 : Date.parse(new Date(day).toISOString().slice(0, 10));
        const old = dates.get(key(e));
        if (!old || at < Date.parse(old)) dates.set(key(e), new Date(at).toISOString());
      }
    }
  }
  const entries: PublicFact[] = [];
  for (const [id, e] of current) {
    const inferred = dates.get(id);
    if (!inferred) continue;
    entries.push({ ...e, publicAt: inferred, estimated: true });
  }
  entries.sort((a, b) => b.publicAt.localeCompare(a.publicAt) || key(a).localeCompare(key(b)));
  return { version: 1, generatedAt: now.toISOString(), dataAsOf: corpus.dataAsOf ?? null, ...inventory, entries: recentFacts(entries, now) };
}
